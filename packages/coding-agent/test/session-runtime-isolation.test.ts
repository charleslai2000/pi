import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentSessionFromServices, createAgentSessionServices } from "../src/core/agent-session-services.ts";
import type { ExtensionFactory } from "../src/core/extensions/types.ts";
import { SessionManager } from "../src/core/session-manager.ts";

type RuntimeBundle = Awaited<ReturnType<typeof createRuntimeBundle>>;

function textContent(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((item): item is { type: "text"; text: string } => item.type === "text" && item.text !== undefined)
		.map((item) => item.text)
		.join("");
}

async function createRuntimeBundle(cwd: string, agentDir: string, extensionFactory: ExtensionFactory) {
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
	const sessionManager = SessionManager.inMemory(cwd);
	const { session } = await createAgentSessionFromServices({
		services,
		sessionManager,
	});
	await session.bindExtensions({});
	return { services, session };
}

describe("independent cwd-bound session runtimes", () => {
	const tempDirs: string[] = [];
	const bundles: RuntimeBundle[] = [];

	afterEach(() => {
		for (const bundle of bundles.splice(0)) bundle.session.dispose();
		for (const dir of tempDirs.splice(0)) {
			if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
		}
	});

	it("keeps two complete runtimes live, isolated, and independently disposable", async () => {
		const root = join(tmpdir(), `pi-session-isolation-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const cwdA = join(root, "project-a");
		const cwdB = join(root, "project-b");
		const agentDir = join(root, "agent");
		tempDirs.push(root);
		mkdirSync(cwdA, { recursive: true });
		mkdirSync(cwdB, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(join(cwdA, "AGENTS.md"), "context-A\n");
		writeFileSync(join(cwdB, "AGENTS.md"), "context-B\n");
		writeFileSync(join(cwdA, "sentinel.txt"), "sentinel-A\n");
		writeFileSync(join(cwdB, "sentinel.txt"), "sentinel-B\n");

		const extensionEvents = new Map<object, number>();
		const eventBuses: Array<{ emit: (channel: string, data: unknown) => void }> = [];
		const extensionFactory = (pi: Parameters<ExtensionFactory>[0]) => {
			eventBuses.push(pi.events);
			extensionEvents.set(pi.events, 0);
			pi.events.on("isolation-probe", () => {
				extensionEvents.set(pi.events, (extensionEvents.get(pi.events) ?? 0) + 1);
			});
		};

		const bundleA = await createRuntimeBundle(cwdA, agentDir, extensionFactory);
		bundles.push(bundleA);
		const bundleB = await createRuntimeBundle(cwdB, agentDir, extensionFactory);
		bundles.push(bundleB);
		const eventsA = eventBuses[0];
		const eventsB = eventBuses[1];
		expect(eventsA).toBeDefined();
		expect(eventsB).toBeDefined();

		// Identity and cwd-bound service ownership.
		expect(bundleA.session).not.toBe(bundleB.session);
		expect(bundleA.services).not.toBe(bundleB.services);
		expect(bundleA.services.modelRuntime).not.toBe(bundleB.services.modelRuntime);
		expect(bundleA.services.settingsManager).not.toBe(bundleB.services.settingsManager);
		expect(bundleA.services.resourceLoader).not.toBe(bundleB.services.resourceLoader);
		expect(bundleA.services.cwd).toBe(cwdA);
		expect(bundleB.services.cwd).toBe(cwdB);
		expect(bundleA.session.sessionManager.getCwd()).toBe(cwdA);
		expect(bundleB.session.sessionManager.getCwd()).toBe(cwdB);

		// Each ResourceLoader sees only its own project context chain.
		expect(bundleA.services.resourceLoader.getAgentsFiles().agentsFiles).toEqual([
			{ path: join(cwdA, "AGENTS.md"), content: "context-A\n" },
		]);
		expect(bundleB.services.resourceLoader.getAgentsFiles().agentsFiles).toEqual([
			{ path: join(cwdB, "AGENTS.md"), content: "context-B\n" },
		]);
		expect(bundleA.session.systemPrompt).toContain("context-A");
		expect(bundleA.session.systemPrompt).not.toContain("context-B");
		expect(bundleB.session.systemPrompt).toContain("context-B");
		expect(bundleB.session.systemPrompt).not.toContain("context-A");

		// The real per-session tool registries execute relative paths in their own cwd.
		const readA = bundleA.session.agent.state.tools.find((tool) => tool.name === "read");
		const readB = bundleB.session.agent.state.tools.find((tool) => tool.name === "read");
		expect(readA).toBeDefined();
		expect(readB).toBeDefined();
		const resultA1 = await readA!.execute("read-a-1", { path: "sentinel.txt" });
		const resultB = await readB!.execute("read-b", { path: "sentinel.txt" });
		const resultA2 = await readA!.execute("read-a-2", { path: "sentinel.txt" });
		expect(textContent(resultA1)).toBe("sentinel-A\n");
		expect(textContent(resultB)).toBe("sentinel-B\n");
		expect(textContent(resultA2)).toBe("sentinel-A\n");

		// Event buses and extension subscriptions are per ResourceLoader/runtime.
		eventsA?.emit("isolation-probe", undefined);
		eventsB?.emit("isolation-probe", undefined);
		expect(extensionEvents.get(eventsA)).toBe(1);
		expect(extensionEvents.get(eventsB)).toBe(1);

		// Disposing B must invalidate only B's extension runtime and leave A usable.
		bundleB.session.dispose();
		const assertBActive = bundleB.services.resourceLoader.getExtensions().runtime.assertActive;
		expect(() => assertBActive()).toThrow();
		const assertAActive = bundleA.services.resourceLoader.getExtensions().runtime.assertActive;
		expect(() => assertAActive()).not.toThrow();
		eventsA?.emit("isolation-probe", undefined);
		expect(extensionEvents.get(eventsA)).toBe(2);
		expect(extensionEvents.get(eventsB)).toBe(1);
		const resultA3 = await readA!.execute("read-a-3", { path: "sentinel.txt" });
		expect(textContent(resultA3)).toBe("sentinel-A\n");

		// Confirm the files themselves were not changed by the read-only probe.
		expect(readFileSync(join(cwdA, "sentinel.txt"), "utf8")).toBe("sentinel-A\n");
		expect(readFileSync(join(cwdB, "sentinel.txt"), "utf8")).toBe("sentinel-B\n");
	});
});
