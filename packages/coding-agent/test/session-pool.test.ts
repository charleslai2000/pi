import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentSessionFromServices, createAgentSessionServices } from "../src/core/agent-session-services.ts";
import type { ExtensionFactory } from "../src/core/extensions/types.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SessionPool } from "../src/core/session-pool.ts";

function textContent(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((item): item is { type: "text"; text: string } => item.type === "text" && item.text !== undefined)
		.map((item) => item.text)
		.join("");
}

async function createSlotRuntime(cwd: string, agentDir: string, extensionFactory: ExtensionFactory) {
	const services = await createAgentSessionServices({
		cwd,
		agentDir,
		resourceLoaderOptions: {
			extensionFactories: [extensionFactory],
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
		},
	});
	const { session } = await createAgentSessionFromServices({
		services,
		sessionManager: SessionManager.inMemory(cwd),
	});
	await session.bindExtensions({});
	return { session, services };
}

describe("SessionPool", () => {
	const tempDirs: string[] = [];
	const sessions: Array<{ dispose: () => void }> = [];

	afterEach(() => {
		for (const session of sessions.splice(0)) session.dispose();
		for (const dir of tempDirs.splice(0)) {
			if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
		}
	});

	it("switches foreground without changing live slots and closes one slot independently", async () => {
		const root = join(tmpdir(), `pi-session-pool-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const cwdA = join(root, "a");
		const cwdB = join(root, "b");
		const agentDir = join(root, "agent");
		tempDirs.push(root);
		mkdirSync(cwdA, { recursive: true });
		mkdirSync(cwdB, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(cwdA, "AGENTS.md"), "pool-context-A\n");
		writeFileSync(join(cwdB, "AGENTS.md"), "pool-context-B\n");
		writeFileSync(join(cwdA, "sentinel.txt"), "pool-A\n");
		writeFileSync(join(cwdB, "sentinel.txt"), "pool-B\n");

		let shutdownCount = 0;
		const extensionFactory: ExtensionFactory = (pi) => {
			pi.on("session_shutdown", () => {
				shutdownCount++;
			});
		};
		const runtimeA = await createSlotRuntime(cwdA, agentDir, extensionFactory);
		const runtimeB = await createSlotRuntime(cwdB, agentDir, extensionFactory);
		sessions.push(runtimeA.session, runtimeB.session);

		const pool = new SessionPool();
		const slotA = pool.adopt(runtimeA.session, runtimeA.services);
		const slotB = pool.adopt(runtimeB.session, runtimeB.services);
		pool.setForeground(slotA.id);
		pool.setForeground(slotB.id);
		pool.setForeground(slotA.id);

		expect(pool.list()).toHaveLength(2);
		expect(pool.getForeground()).toBe(slotA);
		expect(pool.get(slotA.id)?.session).toBe(runtimeA.session);
		expect(pool.get(slotB.id)?.session).toBe(runtimeB.session);
		expect(runtimeA.session.sessionManager.getCwd()).toBe(cwdA);
		expect(runtimeB.session.sessionManager.getCwd()).toBe(cwdB);
		expect(runtimeA.session.resourceLoader.getAgentsFiles().agentsFiles[0]?.content).toBe("pool-context-A\n");
		expect(runtimeB.session.resourceLoader.getAgentsFiles().agentsFiles[0]?.content).toBe("pool-context-B\n");
		expect(() => runtimeA.services.resourceLoader.getExtensions().runtime.assertActive()).not.toThrow();
		expect(() => runtimeB.services.resourceLoader.getExtensions().runtime.assertActive()).not.toThrow();
		expect(shutdownCount).toBe(0);

		const readA = runtimeA.session.agent.state.tools.find((tool) => tool.name === "read")!;
		const readB = runtimeB.session.agent.state.tools.find((tool) => tool.name === "read")!;
		expect(textContent(await readA.execute("pool-read-a", { path: "sentinel.txt" }))).toBe("pool-A\n");
		expect(textContent(await readB.execute("pool-read-b", { path: "sentinel.txt" }))).toBe("pool-B\n");

		runtimeB.session.dispose();
		pool.removeClosed(slotB.id);
		expect(pool.has(slotB.id)).toBe(false);
		expect(pool.get(slotA.id)?.session).toBe(runtimeA.session);
		expect(() => runtimeA.services.resourceLoader.getExtensions().runtime.assertActive()).not.toThrow();
		expect(textContent(await readA.execute("pool-read-a-after-b", { path: "sentinel.txt" }))).toBe("pool-A\n");
		expect(shutdownCount).toBe(0);
		expect(readFileSync(join(cwdA, "sentinel.txt"), "utf8")).toBe("pool-A\n");
	});
});
