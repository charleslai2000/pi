import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSession } from "../src/core/agent-session.ts";
import { AgentSessionRuntime, type CreateAgentSessionRuntimeFactory } from "../src/core/agent-session-runtime.ts";
import { createAgentSessionFromServices, createAgentSessionServices } from "../src/core/agent-session-services.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { readAssociations } from "../src/core/control/associations.ts";
import { readExecutionAttempts } from "../src/core/control/execution-attempts.ts";
import { readGoal, readTask } from "../src/core/control/read-model.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { setPiRoot } from "../src/core/pi-root.ts";
import { getDefaultSessionDir, SessionManager } from "../src/core/session-manager.ts";
import { SessionRegistry, setSessionRegistryForTesting } from "../src/core/session-registry.ts";

class FakeSession {
	readonly sessionManager = { getSessionId: () => this.id, getSessionName: () => this.id };
	sessionFile: string | undefined;
	readonly tools = new Map<string, { execute: (id: string, params: unknown) => Promise<unknown> }>();
	activeTools: string[] = [];
	messages: AgentMessage[] = [];
	isIdle = true;
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
	taskProtocol = "";
	setTaskSessionProtocol(protocol: string): void {
		this.taskProtocol = protocol;
	}
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
	setSessionName(name: string): void {
		this.sessionManager.getSessionName = () => name;
	}
	appendSystemPrompt(prompt: string): void {
		this.prompts.push(prompt);
	}
	async sendCustomMessage(message: { content: string | unknown[] }): Promise<void> {
		this.prompts.push(typeof message.content === "string" ? message.content : JSON.stringify(message.content));
	}
	async steer(message: string): Promise<void> {
		this.prompts.push(message);
	}
	async setModel(model: { id: string; contextWindow: number }): Promise<void> {
		this.contextUsage = { tokens: this.contextUsage?.tokens ?? 0, contextWindow: model.contextWindow, percent: 0 };
	}
	setThinkingLevel(): void {}
}

async function setup(): Promise<{
	root: string;
	runtime: AgentSessionRuntime;
	controllerSession: AgentSession;
	cleanupFaux: () => void;
	faux: ReturnType<typeof registerFauxProvider>;
}> {
	const root = mkdtempSync(join("/tmp", "pi-controller-tools-"));
	mkdirSync(join(root, ".pi", "agents"), { recursive: true });
	writeFileSync(join(root, ".pi", "agents", "coder.md"), "Coding profile prompt.\n");
	writeFileSync(join(root, ".pi", "agents", "reviewer.md"), "Review profile prompt.\n");
	const taskDir = join(root, ".pi", "goal-a");
	mkdirSync(taskDir, { recursive: true });
	writeFileSync(join(taskDir, "goal.md"), "# Goal A\n");
	setPiRoot(root);
	const sessionDir = getDefaultSessionDir(root);
	mkdirSync(sessionDir, { recursive: true });
	const registry = new SessionRegistry(root);
	setSessionRegistryForTesting(registry);
	const faux = registerFauxProvider();
	faux.setResponses([fauxAssistantMessage("Accepted T001"), fauxAssistantMessage("continue")]);
	const cleanupFaux = () => faux.unregister();
	const auth = AuthStorage.inMemory();
	await auth.modify("faux", async () => ({ type: "api_key", key: "test-key" }));
	const modelRuntime = await ModelRuntime.create({ credentials: auth, modelsPath: join(root, "models.json") });
	const fauxModel = faux.getModel();
	modelRuntime.registerProvider(fauxModel.provider, {
		baseUrl: fauxModel.baseUrl,
		api: fauxModel.api,
		models: [
			{
				id: fauxModel.id,
				name: fauxModel.name,
				api: fauxModel.api,
				reasoning: fauxModel.reasoning,
				input: fauxModel.input,
				cost: fauxModel.cost,
				contextWindow: fauxModel.contextWindow,
				maxTokens: fauxModel.maxTokens,
				baseUrl: fauxModel.baseUrl,
			},
			{
				id: "faster",
				name: "faster",
				api: fauxModel.api,
				reasoning: fauxModel.reasoning,
				input: fauxModel.input,
				cost: fauxModel.cost,
				contextWindow: 2000,
				maxTokens: fauxModel.maxTokens,
				baseUrl: fauxModel.baseUrl,
			},
		],
	});
	const controllerManager = SessionManager.create(root, sessionDir);
	const controllerServices = await createAgentSessionServices({ cwd: root, agentDir: "/tmp/agent", modelRuntime });
	const controllerSession = (
		await createAgentSessionFromServices({ services: controllerServices, sessionManager: controllerManager })
	).session;
	registry.setCanonicalControlSessionId(controllerManager.getSessionId());
	registry.upsert({
		id: controllerManager.getSessionId(),
		file: controllerManager.getSessionFile(),
		cwd: root,
		name: "Controller",
	});
	const createRuntime = (async ({ cwd, agentDir, sessionManager }) => {
		const services = await createAgentSessionServices({ cwd, agentDir, modelRuntime });
		const created = await createAgentSessionFromServices({ services, sessionManager, model: fauxModel });
		return { ...created, services, diagnostics: [] };
	}) as CreateAgentSessionRuntimeFactory;
	const runtime = new AgentSessionRuntime(controllerSession, controllerServices, createRuntime);
	Object.assign(runtime, {
		_services: {
			agentDir: "/tmp/agent",
			cwd: root,
			modelRuntime,
			model: fauxModel,
			settingsManager: { getRetrySettings: () => ({}) },
		},
	});
	Object.defineProperty(runtime, "associationRoot", { value: () => root });
	return { root, runtime, controllerSession, cleanupFaux, faux };
}

function toolText(result: unknown): string {
	if (typeof result !== "object" || result === null || !("content" in result)) return "";
	const content = (result as { content: Array<{ type: string; text?: string }> }).content;
	return content
		.filter((part) => part.type === "text")
		.map((part) => part.text ?? "")
		.join("");
}

async function call(session: FakeSession | AgentSession, name: string, params: unknown): Promise<unknown> {
	const tool =
		session instanceof FakeSession
			? session.tools.get(name)
			: session.agent.state.tools.find((candidate) => candidate.name === name);
	if (!tool) throw new Error(`missing ${name}`);
	return tool.execute("test", params);
}

let cleanupFaux: (() => void) | undefined;

afterEach(() => {
	cleanupFaux?.();
	cleanupFaux = undefined;
	setSessionRegistryForTesting(undefined);
	setPiRoot(undefined);
});

describe("Controller Task/Executor tools", () => {
	it("keeps tool sets separate and supports create, revise, inspect, dispatch, notice, and close", async () => {
		const value = await setup();
		cleanupFaux = value.cleanupFaux;
		expect(value.controllerSession.getActiveToolNames()).toEqual(
			expect.arrayContaining([
				"create_task",
				"revise_task",
				"update_goal_memory",
				"update_plan_memory",
				"list_agents",
				"inspect_agent",
				"inspect_task",
				"dispatch_task",
				"notice_executor",
				"close_task",
			]),
		);
		expect(readAssociations(value.root).current).toEqual([]);
		await call(value.controllerSession, "update_goal_memory", { goalId: "goal-a", memory: "Cross-Task invariant" });
		await call(value.controllerSession, "update_plan_memory", { goalId: "goal-a", memory: "T001 before T002" });
		expect(readGoal(value.root, "goal-a").content).toContain("Memory: Cross-Task invariant");
		expect(readFileSync(join(value.root, ".pi", "goal-a", "plan.md"), "utf8")).toContain(
			"Coordination memory: T001 before T002",
		);
		const catalog = JSON.parse(toolText(await call(value.controllerSession, "list_agents", {}))) as Array<{
			agentSlug: string;
		}>;
		expect(catalog.map((agent) => agent.agentSlug)).toContain("coder");
		expect(catalog.map((agent) => agent.agentSlug)).not.toContain("orchestrator");
		const inspected = JSON.parse(
			toolText(await call(value.controllerSession, "inspect_agent", { agentSlug: "coder" })),
		) as { prompt: string };
		expect(inspected.prompt).toContain("Coding profile prompt.");
		await call(value.controllerSession, "create_task", {
			goalId: "goal-a",
			taskId: "T001",
			slug: "native",
			objective: "Do work",
			constraints: "No legacy execution",
			inputs: "input",
			completion: "done",
		});
		await call(value.controllerSession, "create_task", {
			goalId: "goal-a",
			taskId: "T002",
			slug: "dependent",
			objective: "Dependent work",
			completion: "done",
		});
		await call(value.controllerSession, "set_task_dependencies", {
			goalId: "goal-a",
			taskId: "T002",
			prerequisites: [{ goalId: "goal-a", taskId: "T001" }],
		});
		const frontierBefore = await call(value.controllerSession, "inspect_frontier", {});
		expect(JSON.stringify(frontierBefore)).toContain("T001");
		expect(JSON.stringify(frontierBefore)).not.toContain("T002");
		await expect(
			call(value.controllerSession, "dispatch_task", { goalId: "goal-a", taskId: "T002", agent: "coder" }),
		).rejects.toThrow("prerequisites");
		expect(readAssociations(value.root).current).toEqual([]);
		await call(value.controllerSession, "revise_task", {
			goalId: "goal-a",
			taskId: "T001",
			objective: "Do revised work",
		});
		const inspectedTask = await call(value.controllerSession, "inspect_task", { goalId: "goal-a", taskId: "T001" });
		expect(JSON.stringify(inspectedTask)).toContain("Do revised work");
		await call(value.controllerSession, "dispatch_task", { goalId: "goal-a", taskId: "T001", agent: "coder" });
		const executorId = readAssociations(value.root).current[0]!.sessionId;
		expect(value.runtime.sessionPool.getForeground().session.sessionManager.getSessionId()).toBe(executorId);
		expect(value.runtime.sessionPool.findBySessionId(executorId)?.cwd).toBe(value.root);
		const executor = value.runtime.sessionPool.findBySessionId(executorId)!.session;
		expect(executor.getActiveToolNames()).toEqual(["task_gate"]);
		expect(executor.getActiveToolNames()).not.toContain("create_task");
		expect(readTask(value.root, "goal-a", "T001").status).toBe("READY");
		await call(value.controllerSession, "switch_executor_model", {
			executor_id: executorId,
			model: "faux/faster",
		});
		expect(executor.getActiveToolNames()).toEqual(["task_gate"]);
		const gate = executor.agent.state.tools.find((tool) => tool.name === "task_gate")!;
		await gate.execute("test", { decision: "accept" });
		writeFileSync(
			join(value.root, ".pi", "goal-a", "T001-native.md"),
			readFileSync(join(value.root, ".pi", "goal-a", "T001-native.md"), "utf8").replace(
				"Remaining:",
				`Remaining: one\nRemaining: two`,
			),
		);
		const originalConsoleError = console.error;
		const consoleErrors: unknown[][] = [];
		console.error = (...args: unknown[]) => consoleErrors.push(args);
		try {
			value.faux.appendResponses([
				fauxAssistantMessage(
					'<pi-executor-stop>{"reason":"completed","result":"should not apply","remaining":"done"}</pi-executor-stop>',
				),
			]);
			await executor.prompt("settle current task");
			await executor.agent.waitForIdle();
			await new Promise((resolve) => setTimeout(resolve, 50));
		} finally {
			console.error = originalConsoleError;
		}
		expect(readTask(value.root, "goal-a", "T001").status).toBe("ACTIVE");
		expect(readAssociations(value.root).current).toHaveLength(1);
		expect(consoleErrors.length).toBeGreaterThan(0);
		expect(executor.getActiveToolNames()).toEqual(
			expect.arrayContaining(["task_memory", "read", "write", "edit", "bash"]),
		);
		expect(executor.getActiveToolNames()).not.toContain("create_task");
		await call(value.controllerSession, "create_task", {
			goalId: "goal-a",
			taskId: "T003",
			slug: "review",
			objective: "Review goal-a/T001 result and evidence",
			inputs: "Target: goal-a/T001; result: partial; check acceptance and risks",
			completion: "Record PASS or findings in this review Task",
		});
		// T001 remains ACTIVE/assigned after the rejected settlement mutation above.
		await call(value.controllerSession, "set_task_dependencies", {
			goalId: "goal-a",
			taskId: "T003",
			prerequisites: [{ goalId: "goal-a", taskId: "T001" }],
		});
		const reviewFrontier = await call(value.controllerSession, "inspect_frontier", {});
		expect(JSON.stringify(reviewFrontier)).toContain("[]");
		expect(readTask(value.root, "goal-a", "T001").status).toBe("ACTIVE");
		expect(readAssociations(value.root).current).toHaveLength(1);
		expect(readExecutionAttempts(value.root).attempts).toEqual([]);
		await value.runtime.dispose();
		value.controllerSession.dispose();
		rmSync(value.root, { recursive: true, force: true });
	});
});
