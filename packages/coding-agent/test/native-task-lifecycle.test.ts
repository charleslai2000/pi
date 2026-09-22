import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import { assignTaskToSession, readAssociations } from "../src/core/control/associations.ts";
import { readExecutionAttempts } from "../src/core/control/execution-attempts.ts";
import { readTask } from "../src/core/control/read-model.ts";
import { setPiRoot } from "../src/core/pi-root.ts";
import { getDefaultSessionDir } from "../src/core/session-manager.ts";
import { SessionRegistry, setSessionRegistryForTesting } from "../src/core/session-registry.ts";

function fixture(status = "READY"): {
	root: string;
	taskPath: string;
	session: FakeSession;
	runtime: AgentSessionRuntime;
} {
	const root = mkdtempSync(join("/tmp", "pi-native-task-lifecycle-"));
	const taskDir = join(root, "control", "goal-a", "tasks");
	mkdirSync(taskDir, { recursive: true });
	const taskPath = join(taskDir, "T001-work.md");
	writeFileSync(join(root, "control", "goal-a", "goal.md"), "# Goal A\n");
	writeFileSync(taskPath, `Status: ${status}\nObjective: test native lifecycle\nResult: old\nRemaining: later\n`);
	setPiRoot(root, "legacy");
	const registry = new SessionRegistry(root);
	setSessionRegistryForTesting(registry);
	const session = new FakeSession();
	const sessionFile = join(getDefaultSessionDir(root), "s1.jsonl");
	mkdirSync(getDefaultSessionDir(root), { recursive: true });
	writeFileSync(
		sessionFile,
		`${JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: new Date().toISOString(), cwd: root })}\n`,
	);
	registry.upsert({ id: "s1", file: sessionFile, cwd: root, name: "S1" });
	const pool = {
		findBySessionId: (id: string) => (id === "s1" ? { session } : undefined),
		getForeground: () => ({ session }),
	};
	const runtime = Object.assign(Object.create(AgentSessionRuntime.prototype) as AgentSessionRuntime, {
		_sessionPool: pool,
		taskSessionBindings: new Map(),
		taskSessionAdmission: new Map(),
	});
	return { root, taskPath, session, runtime };
}

class FakeSession {
	readonly sessionManager = { getSessionId: () => "s1", getSessionName: () => "S1" };
	private listeners = new Set<(event: { type: string }) => void>();
	private tools = new Map<string, { execute: (id: string, params: unknown) => Promise<unknown> }>();
	activeTools: string[] = [];
	promptCount = 0;
	promptText = "";

	getActiveToolNames(): string[] {
		return [...this.activeTools];
	}
	setActiveToolsByName(names: string[]): void {
		this.activeTools = names;
	}
	installTemporaryTool(tool: {
		name: string;
		execute: (id: string, params: unknown) => Promise<unknown>;
	}): () => void {
		this.tools.set(tool.name, tool);
		return () => this.tools.delete(tool.name);
	}
	getTool(name: string) {
		return this.tools.get(name);
	}
	taskProtocol = "";
	setTaskSessionProtocol(protocol: string): void {
		this.taskProtocol = protocol;
	}
	refreshTools(): void {}
	subscribe(listener: (event: { type: string }) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	emit(type: string): void {
		for (const listener of this.listeners) listener({ type });
	}
	async prompt(text: string): Promise<void> {
		this.promptCount++;
		this.promptText = text;
	}
}

afterEach(() => {
	setSessionRegistryForTesting(undefined);
	setPiRoot(undefined);
});

describe("native Task Session lifecycle", () => {
	it("publishes mandatory completion protocol for Task results", async () => {
		const value = fixture();
		await assignTaskToSession(value.root, "goal-a", "T001", "s1");
		await value.runtime.startAssignedTask("goal-a", "T001");
		const resultTool = value.session.getTool("task_result");
		expect(resultTool).toBeDefined();
		expect(value.session.taskProtocol).toContain("task_result is the only formal exit");
		expect(value.session.taskProtocol).toContain("MUST call task_result(outcome=complete");
		expect(value.session.taskProtocol).toContain("task_memory is optional durable memory");
		expect(value.session.activeTools).toEqual(["task_gate"]);
	});

	it("enforces admission, accepts, settles, resumes, and leaves no attempt history", async () => {
		const value = fixture();
		await assignTaskToSession(value.root, "goal-a", "T001", "s1");
		await value.runtime.startAssignedTask("goal-a", "T001");
		expect(value.session.activeTools).toEqual(["task_gate"]);
		await expect(value.session.getTool("task_memory")?.execute("1", { memory: "no" })).rejects.toThrow("gate");
		await value.session.getTool("task_gate")!.execute("1", { decision: "accept" });
		expect(readTask(value.root, "goal-a", "T001").status).toBe("ACTIVE");
		expect(value.session.activeTools).toEqual(["task_memory", "task_result"]);
		value.session.emit("agent_settled");
		await new Promise((resolve) => setImmediate(resolve));
		expect(readTask(value.root, "goal-a", "T001").status).toBe("BLOCKED");
		value.session.emit("agent_start");
		await new Promise((resolve) => setImmediate(resolve));
		expect(readTask(value.root, "goal-a", "T001").status).toBe("ACTIVE");
		expect(value.session.promptCount).toBe(1);
		expect(readExecutionAttempts(value.root).attempts).toEqual([]);
	});

	it("rebinds an admitted BLOCKED Task without reinstalling the gate", async () => {
		const value = fixture("BLOCKED");
		await assignTaskToSession(value.root, "goal-a", "T001", "s1");
		const rebind = (value.runtime as unknown as { rebindAssignedTask: (session: FakeSession) => Promise<void> })
			.rebindAssignedTask;
		await rebind.call(value.runtime, value.session);
		expect(value.session.activeTools).toEqual(["task_memory", "task_result"]);
		expect(value.session.activeTools).not.toContain("task_gate");
		expect(readTask(value.root, "goal-a", "T001").status).toBe("BLOCKED");
	});

	it("restores admitted lifecycle tools after host rebind resets active tools", async () => {
		const value = fixture("BLOCKED");
		await assignTaskToSession(value.root, "goal-a", "T001", "s1");
		(
			value.runtime as unknown as { setRebindSession: (callback: (session: FakeSession) => Promise<void>) => void }
		).setRebindSession(async (session) => session.setActiveToolsByName(["task_memory"]));
		await (value.runtime as unknown as { finishSessionReplacement: () => Promise<void> }).finishSessionReplacement();
		expect(value.session.activeTools).toEqual(["task_memory", "task_memory", "task_result"]);
		expect(value.session.activeTools).not.toContain("task_gate");
	});

	it("preserves admitted Task tools when the host refreshes its ordinary tool set", async () => {
		const value = fixture("BLOCKED");
		await assignTaskToSession(value.root, "goal-a", "T001", "s1");
		await (
			value.runtime as unknown as { rebindAssignedTask: (session: FakeSession) => Promise<void> }
		).rebindAssignedTask(value.session);
		value.session.setActiveToolsByName(["read", "bash", "task_memory", "task_result"]);
		expect(value.session.activeTools).toEqual(["read", "bash", "task_memory", "task_result"]);
		expect(value.session.activeTools).not.toContain("task_gate");
	});

	it("rejects and releases assignment without activating the Task", async () => {
		const value = fixture();
		await assignTaskToSession(value.root, "goal-a", "T001", "s1");
		await value.runtime.startAssignedTask("goal-a", "T001");
		await value.session.getTool("task_gate")!.execute("1", { decision: "reject", reason: "missing input" });
		expect(readAssociations(value.root).current).toEqual([]);
		expect(readTask(value.root, "goal-a", "T001").status).toBe("READY");
		expect(value.session.activeTools).toEqual(["task_gate"]);
	});

	it("writes memory only to the bound Task and completes or terminates through Task lifecycle", async () => {
		const value = fixture();
		await assignTaskToSession(value.root, "goal-a", "T001", "s1");
		await value.runtime.startAssignedTask("goal-a", "T001");
		await value.session.getTool("task_gate")!.execute("1", { decision: "accept" });
		await value.session.getTool("task_memory")!.execute("1", { memory: "Decision: keep Session-native execution." });
		expect(readFileSync(value.taskPath, "utf8")).toContain("Memory: Decision: keep Session-native execution.");
		await value.session
			.getTool("task_result")!
			.execute("1", { outcome: "terminated", result: "partial", remaining: "next" });
		expect(readTask(value.root, "goal-a", "T001")).toMatchObject({
			status: "DEFERRED",
			result: "partial",
			remaining: "next",
		});
		expect(readAssociations(value.root).current).toEqual([]);
		value.session.emit("agent_settled");
		expect(readTask(value.root, "goal-a", "T001").status).toBe("DEFERRED");
		rmSync(value.root, { recursive: true, force: true });
	});
});
