import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import { readAssociations } from "../src/core/control/associations.ts";
import { readExecutionAttempts } from "../src/core/control/execution-attempts.ts";
import { readTask } from "../src/core/control/read-model.ts";
import { setPiRoot } from "../src/core/pi-root.ts";
import { getDefaultSessionDir } from "../src/core/session-manager.ts";
import { SessionRegistry, setSessionRegistryForTesting } from "../src/core/session-registry.ts";

class FakeSession {
	readonly sessionManager = { getSessionId: () => this.id, getSessionName: () => this.id };
	readonly tools = new Map<string, { execute: (id: string, params: unknown) => Promise<unknown> }>();
	activeTools: string[] = [];
	prompts: string[] = [];
	isStreaming = false;
	contextUsage: { tokens: number | null; contextWindow: number; percent: number | null } | undefined = {
		tokens: 120,
		contextWindow: 1000,
		percent: 12,
	};
	isCompacting = false;
	private readonly id: string;
	private readonly listeners = new Set<(event: { type: string }) => void>();
	constructor(id: string) {
		this.id = id;
	}
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
	setTaskSessionProtocol(): void {}
	getContextUsage() {
		return this.contextUsage;
	}
	subscribe(listener: (event: { type: string }) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	emit(type: string): void {
		for (const listener of this.listeners) listener({ type });
	}
	async prompt(message: string): Promise<void> {
		this.prompts.push(message);
	}
	async steer(message: string): Promise<void> {
		this.prompts.push(message);
	}
	async setModel(model: { id: string; contextWindow: number }): Promise<void> {
		this.contextUsage = { tokens: this.contextUsage?.tokens ?? 0, contextWindow: model.contextWindow, percent: 0 };
	}
	setThinkingLevel(): void {}
}

function setup(): {
	root: string;
	runtime: AgentSessionRuntime;
	controller: FakeSession;
	executor: FakeSession;
	executor2: FakeSession;
} {
	const root = mkdtempSync(join("/tmp", "pi-controller-tools-"));
	const taskDir = join(root, "control", "goal-a", "tasks");
	mkdirSync(taskDir, { recursive: true });
	writeFileSync(join(root, "control", "goal-a", "goal.md"), "# Goal A\n");
	setPiRoot(root, "legacy");
	const registry = new SessionRegistry(root);
	setSessionRegistryForTesting(registry);
	const sessionDir = getDefaultSessionDir(root);
	mkdirSync(sessionDir, { recursive: true });
	const sessions = [new FakeSession("controller"), new FakeSession("executor"), new FakeSession("executor2")];
	for (const session of sessions) {
		const file = join(sessionDir, `${session.sessionManager.getSessionId()}.jsonl`);
		writeFileSync(
			file,
			`${JSON.stringify({ type: "session", version: 3, id: session.sessionManager.getSessionId(), timestamp: new Date().toISOString(), cwd: root })}\n`,
		);
		registry.upsert({
			id: session.sessionManager.getSessionId(),
			file,
			cwd: root,
			name: session.sessionManager.getSessionName(),
		});
	}
	registry.setCanonicalControlSessionId("controller");
	const pool = {
		findBySessionId: (id: string) => {
			const session = sessions.find((candidate) => candidate.sessionManager.getSessionId() === id);
			return session
				? {
						session,
						activity: { busy: false },
						services: {
							modelRuntime: {
								getModel: (provider: string, modelId: string) =>
									provider === "faux" && modelId === "faster"
										? { id: modelId, contextWindow: 2000 }
										: undefined,
							},
						},
					}
				: undefined;
		},
	};
	const runtime = Object.assign(Object.create(AgentSessionRuntime.prototype) as AgentSessionRuntime, {
		_sessionPool: pool,
		taskSessionBindings: new Map(),
		taskSessionAdmission: new Map(),
		createRuntime: async () => {
			throw new Error("test does not create a new Executor");
		},
	});
	Object.defineProperty(runtime, "associationRoot", { value: () => root });
	return { root, runtime, controller: sessions[0]!, executor: sessions[1]!, executor2: sessions[2]! };
}

async function call(session: FakeSession, name: string, params: unknown): Promise<unknown> {
	const tool = session.tools.get(name);
	if (!tool) throw new Error(`missing ${name}`);
	return tool.execute("test", params);
}

afterEach(() => {
	setSessionRegistryForTesting(undefined);
	setPiRoot(undefined);
});

describe("Controller Task/Executor tools", () => {
	it("keeps tool sets separate and supports create, revise, inspect, dispatch, notice, and close", async () => {
		const value = setup();
		(value.runtime as unknown as { installControllerTools: (session: FakeSession) => void }).installControllerTools(
			value.controller,
		);
		expect(value.controller.activeTools).toEqual(
			expect.arrayContaining([
				"create_task",
				"revise_task",
				"inspect_task",
				"dispatch_task",
				"notice_executor",
				"close_task",
			]),
		);
		expect(value.executor.activeTools).toEqual([]);
		await call(value.controller, "create_task", {
			goalId: "goal-a",
			taskId: "T001",
			slug: "native",
			objective: "Do work",
			constraints: "No legacy execution",
			inputs: "input",
			completion: "done",
		});
		await call(value.controller, "create_task", {
			goalId: "goal-a",
			taskId: "T002",
			slug: "dependent",
			objective: "Dependent work",
			completion: "done",
		});
		await call(value.controller, "set_task_dependencies", {
			goalId: "goal-a",
			taskId: "T002",
			prerequisites: [{ goalId: "goal-a", taskId: "T001" }],
		});
		const frontierBefore = await call(value.controller, "inspect_frontier", {});
		expect(JSON.stringify(frontierBefore)).toContain("T001");
		expect(JSON.stringify(frontierBefore)).not.toContain("T002");
		await expect(
			call(value.controller, "dispatch_task", { goalId: "goal-a", taskId: "T002", sessionId: "executor2" }),
		).rejects.toThrow("prerequisites");
		expect(readAssociations(value.root).current).toEqual([]);
		await call(value.controller, "revise_task", { goalId: "goal-a", taskId: "T001", objective: "Do revised work" });
		const inspected = await call(value.controller, "inspect_task", { goalId: "goal-a", taskId: "T001" });
		expect(JSON.stringify(inspected)).toContain("Do revised work");
		expect(
			(
				value.runtime as unknown as { getExecutorContextSnapshot: (id: string) => unknown }
			).getExecutorContextSnapshot("executor"),
		).toMatchObject({
			currentContextUsage: 120,
			effectiveContextLimit: 1000,
			remainingHeadroom: 880,
			budgetState: "available",
			compaction: { active: false, usageKnown: true },
		});
		await call(value.controller, "dispatch_task", { goalId: "goal-a", taskId: "T001", sessionId: "executor" });
		expect(value.executor.activeTools).toEqual(["task_gate"]);
		value.executor.contextUsage = { tokens: 1000, contextWindow: 1000, percent: 100 };
		// Exhaustion is observation-only; switching is an explicit Controller choice below.
		expect(
			(
				value.runtime as unknown as { getExecutorContextSnapshot: (id: string) => { budgetState: string } }
			).getExecutorContextSnapshot("executor")?.budgetState,
		).toBe("exhausted");
		value.executor.contextUsage = { tokens: null, contextWindow: 1000, percent: null };
		expect(
			(
				value.runtime as unknown as { getExecutorContextSnapshot: (id: string) => { budgetState: string } }
			).getExecutorContextSnapshot("executor")?.budgetState,
		).toBe("unknown");
		expect(readTask(value.root, "goal-a", "T001").status).toBe("READY");
		await call(value.controller, "switch_executor_model", { executor_id: "executor", model: "faux/faster" });
		expect(value.executor.activeTools).toEqual(["task_gate"]);
		await call(value.controller, "notice_executor", { sessionId: "executor", message: "Continue and decide." });
		expect(value.executor.prompts.at(-1)).toContain("Continue and decide");
		await call(value.executor, "task_gate", { decision: "accept" });
		value.controller.isStreaming = true;
		await call(value.executor, "task_result", { outcome: "terminated", result: "partial", remaining: "continue" });
		expect(value.controller.prompts.at(-1)).toContain("status=DEFERRED");
		expect(readTask(value.root, "goal-a", "T001").status).toBe("DEFERRED");
		await call(value.controller, "dispatch_task", { goalId: "goal-a", taskId: "T001", sessionId: "executor2" });
		expect(value.executor2.activeTools).toEqual(["task_gate"]);
		await call(value.controller, "close_task", { goalId: "goal-a", taskId: "T001", outcome: "cancelled" });
		await call(value.controller, "create_task", {
			goalId: "goal-a",
			taskId: "T003",
			slug: "review",
			objective: "Review goal-a/T001 result and evidence",
			inputs: "Target: goal-a/T001; result: partial; check acceptance and risks",
			completion: "Record PASS or findings in this review Task",
		});
		await call(value.controller, "set_task_dependencies", {
			goalId: "goal-a",
			taskId: "T003",
			prerequisites: [{ goalId: "goal-a", taskId: "T001" }],
		});
		const reviewFrontier = await call(value.controller, "inspect_frontier", {});
		expect(JSON.stringify(reviewFrontier)).not.toContain("T003");
		expect(readTask(value.root, "goal-a", "T001").status).toBe("CANCELLED");
		expect(readAssociations(value.root).current).toEqual([]);
		expect(readExecutionAttempts(value.root).attempts).toEqual([]);
		rmSync(value.root, { recursive: true, force: true });
	});
});
