import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import {
	assignTaskToSession,
	readAssociations,
	unassignTask,
	withAssociationMutationLock,
} from "../src/core/control/associations.ts";
import { readExecutionAttempts } from "../src/core/control/execution-attempts.ts";
import { readTask } from "../src/core/control/read-model.ts";
import { completeTask } from "../src/core/control/task-mutations.ts";
import { setPiRoot } from "../src/core/pi-root.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SessionRegistry, setSessionRegistryForTesting } from "../src/core/session-registry.ts";

function fixture(status = "READY"): {
	root: string;
	taskPath: string;
	session: FakeSession;
	runtime: AgentSessionRuntime;
	sessionId: string;
} {
	const root = mkdtempSync(join("/tmp", "pi-native-task-lifecycle-"));
	mkdirSync(join(root, ".pi"), { recursive: true });
	const taskDir = join(root, ".pi", "goal-a");
	mkdirSync(taskDir, { recursive: true });
	const taskPath = join(taskDir, "T001-work.md");
	writeFileSync(join(root, ".pi", "goal-a", "goal.md"), "# Goal A\n");
	writeFileSync(taskPath, `Status: ${status}\nObjective: test native lifecycle\nResult: old\nRemaining: later\n`);
	setPiRoot(root);
	const registry = new SessionRegistry(root);
	setSessionRegistryForTesting(registry);
	const sessionManager = SessionManager.create(root);
	const sessionFile = sessionManager.getSessionFile();
	if (!sessionFile) throw new Error("Fixture Session was not persisted");
	const sessionId = sessionManager.getSessionId();
	const session = new FakeSession(sessionId);
	const controllerManager = SessionManager.create(root);
	const controllerFile = controllerManager.getSessionFile();
	if (!controllerFile) throw new Error("Fixture Controller Session was not persisted");
	registry.upsert({ id: controllerManager.getSessionId(), file: controllerFile, cwd: root, name: "Controller" });
	registry.setCanonicalControlSessionId(controllerManager.getSessionId());
	registry.upsert({ id: sessionId, file: sessionFile, cwd: root, name: "S1" });
	const pool = {
		findBySessionId: (id: string) => (id === sessionId ? { session } : undefined),
		getForeground: () => ({ session }),
	};
	const runtime = Object.assign(Object.create(AgentSessionRuntime.prototype) as AgentSessionRuntime, {
		taskSessionBindings: new Map(),
		taskSessionAdmission: new Map(),
		taskRunGenerations: new Map(),
		controllerNoticeKeys: new Set<string>(),
		suppressExecutorSettlement: new Set<string>(),
		_sessionPool: {
			...pool,
			findBySessionId: (id: string) => (id === sessionId ? { session } : undefined),
		},
		notifyController: vi.fn(async () => {}),
	});
	return { root, taskPath, session, runtime, sessionId };
}

class FakeSession {
	readonly sessionManager: { getSessionId: () => string; getSessionName: () => string };
	private readonly id: string;
	constructor(id: string) {
		this.id = id;
		this.sessionManager = { getSessionId: () => this.id, getSessionName: () => "S1" };
	}
	private listeners = new Set<(event: { type: string }) => void>();
	private tools = new Map<string, { execute: (id: string, params: unknown) => Promise<unknown> }>();
	activeTools: string[] = [];
	messages: AgentMessage[] = [];
	isIdle = true;
	promptCount = 0;
	promptText = "";
	nextPromptResolver?: () => void;

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
		if (text === "deferNextPrompt") {
			this.nextPromptResolver?.();
			await new Promise<void>((resolve) => {
				this.nextPromptResolver = resolve;
			});
			return;
		}
		if (text.startsWith("<pi-executor-stop>"))
			this.messages.push({
				role: "assistant",
				content: [{ type: "text", text }],
				stopReason: "stop",
			} as AgentMessage);
	}
}

afterEach(() => {
	setSessionRegistryForTesting(undefined);
	setPiRoot(undefined);
});

describe("native Task Session lifecycle", () => {
	it("publishes mandatory completion protocol for Task results", async () => {
		const value = fixture();
		await assignTaskToSession(value.root, "goal-a", "T001", value.sessionId);
		await value.runtime.startAssignedTask("goal-a", "T001");
		expect(value.session.taskProtocol).toContain("pi-executor-stop");
		expect(value.session.taskProtocol).toContain("task_memory is optional durable memory");
		expect(value.session.activeTools).toEqual(["task_gate"]);
	});

	it("enforces admission, accepts, settles, resumes, and leaves no attempt history", async () => {
		const value = fixture();
		await assignTaskToSession(value.root, "goal-a", "T001", value.sessionId);
		await value.runtime.startAssignedTask("goal-a", "T001");
		expect(value.session.activeTools).toEqual(["task_gate"]);
		await expect(value.session.getTool("task_memory")?.execute("1", { memory: "no" })).rejects.toThrow("gate");
		await value.session.getTool("task_gate")!.execute("1", { decision: "accept" });
		expect(readTask(value.root, "goal-a", "T001").status).toBe("ACTIVE");
		expect(value.session.activeTools).toEqual(["task_memory"]);
		value.session.emit("agent_settled");
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(readTask(value.root, "goal-a", "T001").status).toBe("BLOCKED");
		value.session.emit("agent_start");
		await vi.waitFor(() => expect(readTask(value.root, "goal-a", "T001").status).toBe("ACTIVE"));
		expect(readTask(value.root, "goal-a", "T001").status).toBe("ACTIVE");
		expect(value.session.promptCount).toBe(1);
		expect(readExecutionAttempts(value.root).attempts).toEqual([]);
	});

	it("drops an old settle after a new user run starts, without changing Task or notifying Controller", async () => {
		const value = fixture();
		await assignTaskToSession(value.root, "goal-a", "T001", value.sessionId);
		await value.runtime.startAssignedTask("goal-a", "T001");
		await value.session.getTool("task_gate")!.execute("1", { decision: "accept" });
		value.session.messages.push({
			role: "assistant",
			content: [
				{ type: "text", text: '<pi-executor-stop>{"reason":"completed","result":"stale"}</pi-executor-stop>' },
			],
			stopReason: "stop",
		} as AgentMessage);
		const assignment = readAssociations(value.root).current[0]!;
		const { generation: staleGeneration } = assignment;
		let releaseMutation!: () => void;
		const locked = new Promise<void>((resolve) => {
			releaseMutation = resolve;
		});
		const hold = withAssociationMutationLock(value.root, () => locked);
		value.session.emit("agent_settled");
		value.session.emit("agent_start");
		const release = unassignTask(value.root, "goal-a", "T001");
		const redispatch = release.then(() => assignTaskToSession(value.root, "goal-a", "T001", value.sessionId));
		releaseMutation();
		await hold;
		await redispatch;
		expect(readAssociations(value.root).current[0]?.generation).toBe(staleGeneration + 1);
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(readTask(value.root, "goal-a", "T001").status).toBe("ACTIVE");
		expect(readAssociations(value.root).current).toHaveLength(1);
		expect(
			(value.runtime as unknown as { notifyController: ReturnType<typeof vi.fn> }).notifyController,
		).not.toHaveBeenCalled();
	});

	it("does not let a late terminated envelope overwrite terminal Task state", async () => {
		const value = fixture();
		await assignTaskToSession(value.root, "goal-a", "T001", value.sessionId);
		await value.runtime.startAssignedTask("goal-a", "T001");
		await value.session.getTool("task_gate")!.execute("1", { decision: "accept" });
		await completeTask(value.root, "goal-a", "T001", { result: "already complete" });
		value.session.messages.push({
			role: "assistant",
			content: [
				{ type: "text", text: '<pi-executor-stop>{"reason":"terminated","result":"late"}</pi-executor-stop>' },
			],
			stopReason: "stop",
		} as AgentMessage);
		value.session.emit("agent_settled");
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(readTask(value.root, "goal-a", "T001").status).toBe("DONE");
		expect(readTask(value.root, "goal-a", "T001").result).toBe("already complete");
		expect(readAssociations(value.root).current.map((assignment) => assignment.taskId)).toEqual(["T001"]);
		expect(
			(value.runtime as unknown as { notifyController: ReturnType<typeof vi.fn> }).notifyController,
		).not.toHaveBeenCalled();
	});

	it("keeps continue_possible active for the same Session until a later completion", async () => {
		const value = fixture();
		await assignTaskToSession(value.root, "goal-a", "T001", value.sessionId);
		await value.runtime.startAssignedTask("goal-a", "T001");
		await value.session.getTool("task_gate")!.execute("1", { decision: "accept" });
		await value.session.prompt('<pi-executor-stop>{"reason":"continue_possible"}</pi-executor-stop>');
		value.session.emit("agent_settled");
		await vi.waitFor(() => expect(value.session.isIdle).toBe(true));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(readTask(value.root, "goal-a", "T001").status).toBe("ACTIVE");
		expect(readAssociations(value.root).current).toHaveLength(1);
		expect(
			(value.runtime as unknown as { notifyController: ReturnType<typeof vi.fn> }).notifyController,
		).not.toHaveBeenCalled();
		value.session.emit("agent_start");
		await value.session.prompt('<pi-executor-stop>{"reason":"completed","result":"done"}</pi-executor-stop>');
		value.session.emit("agent_settled");
		await vi.waitFor(() => expect(readTask(value.root, "goal-a", "T001").status).toBe("DONE"));
		expect(readAssociations(value.root).current).toEqual([]);
	});

	it("rebinds an admitted BLOCKED Task without reinstalling the gate", async () => {
		const value = fixture("BLOCKED");
		await assignTaskToSession(value.root, "goal-a", "T001", value.sessionId);
		const rebind = (value.runtime as unknown as { rebindAssignedTask: (session: FakeSession) => Promise<void> })
			.rebindAssignedTask;
		await rebind.call(value.runtime, value.session);
		expect(value.session.activeTools).toEqual(["task_memory"]);
		expect(value.session.activeTools).not.toContain("task_gate");
		expect(readTask(value.root, "goal-a", "T001").status).toBe("BLOCKED");
	});

	it("restores admitted lifecycle tools after host rebind resets active tools", async () => {
		const value = fixture("BLOCKED");
		await assignTaskToSession(value.root, "goal-a", "T001", value.sessionId);
		(
			value.runtime as unknown as { setRebindSession: (callback: (session: FakeSession) => Promise<void>) => void }
		).setRebindSession(async (session) => session.setActiveToolsByName(["task_memory"]));
		await (value.runtime as unknown as { finishSessionReplacement: () => Promise<void> }).finishSessionReplacement();
		expect(value.session.activeTools).toEqual(["task_memory", "task_memory"]);
		expect(value.session.activeTools).not.toContain("task_gate");
	});

	it("preserves admitted Task tools when the host refreshes its ordinary tool set", async () => {
		const value = fixture("BLOCKED");
		await assignTaskToSession(value.root, "goal-a", "T001", value.sessionId);
		await (
			value.runtime as unknown as { rebindAssignedTask: (session: FakeSession) => Promise<void> }
		).rebindAssignedTask(value.session);
		value.session.setActiveToolsByName(["read", "bash", "task_memory"]);
		expect(value.session.activeTools).toEqual(["read", "bash", "task_memory"]);
		expect(value.session.activeTools).not.toContain("task_gate");
	});

	it("rejects and releases assignment without activating the Task", async () => {
		const value = fixture();
		await assignTaskToSession(value.root, "goal-a", "T001", value.sessionId);
		await value.runtime.startAssignedTask("goal-a", "T001");
		await value.session.getTool("task_gate")!.execute("1", { decision: "reject", reason: "missing input" });
		expect(readAssociations(value.root).current).toEqual([]);
		expect(readTask(value.root, "goal-a", "T001").status).toBe("READY");
		expect(value.session.activeTools).toEqual(["task_gate"]);
	});

	it("writes memory only to the bound Task and completes or terminates through Task lifecycle", async () => {
		const value = fixture();
		await assignTaskToSession(value.root, "goal-a", "T001", value.sessionId);
		await value.runtime.startAssignedTask("goal-a", "T001");
		await value.session.getTool("task_gate")!.execute("1", { decision: "accept" });
		await value.session.getTool("task_memory")!.execute("1", { memory: "Decision: keep Session-native execution." });
		expect(readFileSync(value.taskPath, "utf8")).toContain("Memory: Decision: keep Session-native execution.");
		await value.session.prompt(
			'<pi-executor-stop>{"reason":"terminated","result":"partial","remaining":"next"}</pi-executor-stop>',
		);
		value.session.emit("agent_settled");
		await vi.waitFor(() => expect(readTask(value.root, "goal-a", "T001").status).toBe("DEFERRED"));
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
