import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { readAssociations } from "../src/core/control/associations.ts";
import { readExecutionAttempts } from "../src/core/control/execution-attempts.ts";
import { readTask } from "../src/core/control/read-model.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { setPiRoot } from "../src/core/pi-root.ts";
import { startPiRootApplication } from "../src/core/pi-root-application.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { setSessionRegistryForTesting } from "../src/core/session-registry.ts";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
	setPiRoot(undefined);
});

function text(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && part.text !== undefined)
		.map((part) => part.text)
		.join("");
}

async function tool(
	session: {
		agent: { state: { tools: Array<{ name: string; execute: (id: string, params: unknown) => Promise<unknown> }> } };
	},
	name: string,
	params: unknown,
) {
	const selected = session.agent.state.tools.find((candidate) => candidate.name === name);
	if (!selected) throw new Error(`Missing tool ${name}`);
	return selected.execute(`e2e-${name}`, params) as Promise<{ content: Array<{ type: string; text?: string }> }>;
}

describe("C4 integrated Session-native orchestration", () => {
	it("executes the DAG and preserves durable Task/Session authority", async () => {
		const base = mkdtempSync(join("/tmp", "pi-c4-integrated-e2e-"));
		const root = join(base, "project");
		const agentDir = join(base, "agent");
		const sessionDir = join(root, ".pi", "sessions");
		mkdirSync(join(root, ".pi"), { recursive: true });
		mkdirSync(join(root, "control", "goal-a", "tasks"), { recursive: true });
		writeFileSync(join(root, "control", "goal-a", "goal.md"), "# Goal A\n");
		const faux = registerFauxProvider();
		faux.setResponses([]);
		const queueEnvelope = (reason: string, result = "faux result") =>
			faux.appendResponses([
				fauxAssistantMessage(`<pi-executor-stop>{"reason":"${reason}","result":"${result}"}</pi-executor-stop>`),
			]);
		const auth = AuthStorage.inMemory();
		await auth.modify(faux.getModel().provider, async () => ({ type: "api_key", key: "e2e" }));
		const modelRuntime = await ModelRuntime.create({ credentials: auth, modelsPath: null, allowModelNetwork: false });
		const model = faux.getModel();
		modelRuntime.registerProvider(model.provider, {
			baseUrl: model.baseUrl,
			api: model.api,
			models: [
				{
					id: model.id,
					name: model.name,
					api: model.api,
					reasoning: model.reasoning,
					input: model.input,
					cost: model.cost,
					contextWindow: model.contextWindow,
					maxTokens: model.maxTokens,
					baseUrl: model.baseUrl,
				},
				{
					id: `${model.id}-large`,
					name: `${model.name} Large`,
					api: model.api,
					reasoning: model.reasoning,
					input: model.input,
					cost: model.cost,
					contextWindow: model.contextWindow * 2,
					maxTokens: model.maxTokens,
					baseUrl: model.baseUrl,
				},
			],
		});
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager }) => {
			const services = await createAgentSessionServices({
				cwd,
				agentDir,
				modelRuntime,
				resourceLoaderOptions: { noSkills: true, noPromptTemplates: true, noThemes: true },
			});
			return {
				...(await createAgentSessionFromServices({ services, sessionManager, model })),
				services,
				diagnostics: services.diagnostics,
			};
		};
		const app = await startPiRootApplication({ root, agentDir, createRuntime });
		let appClosed = false;
		cleanups.push(async () => {
			if (appClosed) return;
			await app.shutdown();
			appClosed = true;
			faux.unregister();
			rmSync(base, { recursive: true, force: true });
		});
		const controller = app.runtimeHost.session;
		const eventOrder: string[] = [];
		const call = async (name: string, params: unknown) => {
			eventOrder.push(name);
			return tool(controller, name, params);
		};

		await call("create_task", {
			goalId: "goal-a",
			taskId: "T001",
			slug: "one",
			objective: "First parallel task",
			completion: "done",
		});
		await call("create_task", {
			goalId: "goal-a",
			taskId: "T002",
			slug: "two",
			objective: "Second parallel task",
			completion: "done",
		});
		await call("create_task", {
			goalId: "goal-a",
			taskId: "T003",
			slug: "join",
			objective: "Join both results",
			completion: "done",
		});
		await call("set_task_dependencies", {
			goalId: "goal-a",
			taskId: "T003",
			prerequisites: [
				{ goalId: "goal-a", taskId: "T001" },
				{ goalId: "goal-a", taskId: "T002" },
			],
		});
		const executorSlots = [];
		for (let index = 0; index < 2; index++) {
			const manager = SessionManager.create(root, sessionDir);
			manager.persistSessionHeader();
			const result = await createRuntime({ cwd: root, agentDir, sessionManager: manager });
			executorSlots.push(app.runtimeHost.sessionPool.adopt(result.session, result.services));
		}
		const executors = executorSlots;
		expect(executors).toHaveLength(2);
		expect(controller.getActiveToolNames()).toEqual(
			expect.arrayContaining(["create_task", "dispatch_task", "inspect_task"]),
		);
		for (const executor of executors) {
			expect(executor.session.getActiveToolNames()).not.toContain("create_task");
			expect(executor.session.getActiveToolNames()).not.toContain("dispatch_task");
		}
		await call("dispatch_task", {
			goalId: "goal-a",
			taskId: "T001",
			sessionId: executors[0]!.session.sessionManager.getSessionId(),
		});
		await call("dispatch_task", {
			goalId: "goal-a",
			taskId: "T002",
			sessionId: executors[1]!.session.sessionManager.getSessionId(),
		});
		expect(new Set(executors.map((slot) => slot.session.sessionManager.getSessionId())).size).toBe(2);
		const switchedSessionId = executors[0]!.session.sessionManager.getSessionId();
		await call("switch_executor_model", {
			executor_id: switchedSessionId,
			model: `${model.provider}/${model.id}-large`,
		});
		expect(executors[0]!.session.sessionManager.getSessionId()).toBe(switchedSessionId);
		await tool(executors[0]!.session, "task_gate", { decision: "accept" });
		const originalExecutorId = executors[0]!.session.sessionManager.getSessionId();
		const originalTaskFile = readTask(root, "goal-a", "T001").path;
		const executorLifecycle: string[] = [];
		const unsubscribeExecutor = executors[0]!.session.subscribe((event) => executorLifecycle.push(event.type));
		await tool(executors[0]!.session, "task_memory", { memory: "parallel evidence 0; user follow-up handled" });
		queueEnvelope("completed", "result-0");
		await executors[0]!.session.prompt(
			'<pi-executor-stop>{"reason":"completed","result":"result-0"}</pi-executor-stop>',
		);
		unsubscribeExecutor();
		expect(executorLifecycle).toEqual(expect.arrayContaining(["agent_start", "agent_settled"]));
		await expect.poll(() => readTask(root, "goal-a", "T001").status).toBe("DONE");
		expect(executors[0]!.session.sessionManager.getSessionId()).toBe(originalExecutorId);
		expect(readAssociations(root).current.some((assignment) => assignment.taskId === "T001")).toBe(false);
		expect(readTask(root, "goal-a", "T001").status).toBe("DONE");
		expect(readAssociations(root).current.some((assignment) => assignment.taskId === "T001")).toBe(false);
		await tool(executors[1]!.session, "task_gate", { decision: "accept" });
		await tool(executors[1]!.session, "task_memory", { memory: "parallel evidence 1" });
		queueEnvelope("completed", "result-1");
		queueEnvelope("completed", "result-1");
		await executors[1]!.session.prompt("Executor T002 work turn.");
		expect(readFileSync(originalTaskFile, "utf8")).toContain("user follow-up handled");
		await expect.poll(() => readTask(root, "goal-a", "T001").status).toBe("DONE");
		await expect.poll(() => readTask(root, "goal-a", "T002").status).toBe("DONE");
		const tenureHistory = readAssociations(root).history.filter(
			(event) => event.goalId === "goal-a" && event.taskId === "T001" && event.type === "assigned",
		);
		expect(tenureHistory.map((event) => event.sessionId)).toEqual([
			executors[0]!.session.sessionManager.getSessionId(),
		]);
		expect(readAssociations(root).current).toEqual([]);
		const frontier = JSON.parse(text(await call("inspect_frontier", {}))) as Array<{ taskId: string }>;
		expect(frontier.map((task) => task.taskId)).toContain("T003");
		faux.appendResponses([
			fauxAssistantMessage('<pi-executor-stop>{"reason":"completed","result":"joined"}</pi-executor-stop>'),
		]);
		await call("dispatch_task", {
			goalId: "goal-a",
			taskId: "T003",
			sessionId: executors[0]!.session.sessionManager.getSessionId(),
		});
		await tool(executors[0]!.session, "task_gate", { decision: "accept" });
		queueEnvelope("completed", "joined");
		await executors[0]!.session.prompt("Join T001 and T002.");
		await expect.poll(() => readTask(root, "goal-a", "T003").status).toBe("DONE");
		const review = await call("create_task", {
			goalId: "goal-a",
			taskId: "T004",
			slug: "review",
			objective: "Review T003 result and evidence",
			inputs: "Target goal-a/T003; result joined; inspect evidence and risks",
			completion: "Record PASS or findings",
		});
		expect(text(review)).toContain("T004");
		await call("set_task_dependencies", {
			goalId: "goal-a",
			taskId: "T004",
			prerequisites: [{ goalId: "goal-a", taskId: "T003" }],
		});
		faux.appendResponses([
			fauxAssistantMessage('<pi-executor-stop>{"reason":"completed","result":"PASS"}</pi-executor-stop>'),
		]);
		await call("dispatch_task", {
			goalId: "goal-a",
			taskId: "T004",
			sessionId: executors[1]!.session.sessionManager.getSessionId(),
		});
		await tool(executors[1]!.session, "task_gate", { decision: "accept" });
		faux.appendResponses([
			fauxAssistantMessage('<pi-executor-stop>{"reason":"completed","result":"PASS"}</pi-executor-stop>'),
		]);
		queueEnvelope("completed", "PASS");
		await executors[1]!.session.prompt("Review T003 and report PASS.");
		await expect.poll(() => readTask(root, "goal-a", "T003").status).toBe("DONE");
		await expect.poll(() => readTask(root, "goal-a", "T004").status).toBe("DONE");
		await call("create_task", {
			goalId: "goal-a",
			taskId: "T005",
			slug: "handoff",
			objective: "Continue from durable handoff",
			completion: "done",
		});
		await call("dispatch_task", {
			goalId: "goal-a",
			taskId: "T005",
			sessionId: executors[0]!.session.sessionManager.getSessionId(),
		});
		await tool(executors[0]!.session, "task_gate", { decision: "accept" });
		await tool(executors[0]!.session, "task_memory", { memory: "handoff evidence before termination" });
		faux.setResponses([
			fauxAssistantMessage(
				'<pi-executor-stop>{"reason":"terminated","result":"needs another Executor"}</pi-executor-stop>',
			),
		]);
		const terminationEvents: Array<{
			type: string;
			taskStatus: string | undefined;
			assignment: string | undefined;
			assistantText?: string;
		}> = [];
		const stopTracing = executors[0]!.session.subscribe((event) => {
			if (event.type === "agent_start" || event.type === "agent_settled") {
				const lastAssistant = [...executors[0]!.session.messages]
					.reverse()
					.find((message) => message.role === "assistant");
				terminationEvents.push({
					type: event.type,
					taskStatus: readTask(root, "goal-a", "T005").status,
					assignment: readAssociations(root).current.find((item) => item.taskId === "T005")?.sessionId,
					assistantText:
						lastAssistant?.role === "assistant" && Array.isArray(lastAssistant.content)
							? lastAssistant.content
									.filter((part) => part.type === "text")
									.map((part) => part.text)
									.join("")
							: undefined,
				});
			}
		});
		await executors[0]!.session.prompt("This Executor must terminate and hand off.");
		await expect.poll(() => readTask(root, "goal-a", "T005").status).toBe("DEFERRED");
		stopTracing();
		expect(
			terminationEvents.some(
				(event) => event.type === "agent_settled" && event.assistantText?.includes('"reason":"terminated"'),
			),
		).toBe(true);
		expect(readAssociations(root).current).toEqual([]);
		faux.appendResponses([
			fauxAssistantMessage(
				'<pi-executor-stop>{"reason":"completed","result":"handoff complete"}</pi-executor-stop>',
			),
		]);
		await call("dispatch_task", {
			goalId: "goal-a",
			taskId: "T005",
			sessionId: executors[1]!.session.sessionManager.getSessionId(),
		});
		await tool(executors[1]!.session, "task_gate", { decision: "accept" });
		faux.appendResponses([
			fauxAssistantMessage(
				'<pi-executor-stop>{"reason":"completed","result":"handoff complete"}</pi-executor-stop>',
			),
		]);
		expect(readFileSync(readTask(root, "goal-a", "T005").path, "utf8")).toContain(
			"handoff evidence before termination",
		);
		await executors[1]!.session.prompt("Complete the reassigned Task.");
		await expect.poll(() => readTask(root, "goal-a", "T005").status).toBe("DONE");
		expect(readAssociations(root).current).toEqual([]);
		expect(readExecutionAttempts(root).attempts).toEqual([]);
		expect(eventOrder).toContain("switch_executor_model");
		expect(readFileSync(executors[0]!.session.sessionFile!, "utf8")).toContain(
			executors[0]!.session.sessionManager.getSessionId(),
		);
		expect(readFileSync(executors[1]!.session.sessionFile!, "utf8")).toContain(
			executors[1]!.session.sessionManager.getSessionId(),
		);
		expect(readFileSync(readTask(root, "goal-a", "T003").path, "utf8")).toContain("Status: DONE");

		await call("create_task", {
			goalId: "goal-a",
			taskId: "T006",
			slug: "recovery",
			objective: "Remain assigned across restart",
			completion: "continue after recovery",
		});
		queueEnvelope("blocked_external", "restart checkpoint");
		await call("dispatch_task", {
			goalId: "goal-a",
			taskId: "T006",
			sessionId: executors[0]!.session.sessionManager.getSessionId(),
		});
		await tool(executors[0]!.session, "task_gate", { decision: "accept" });
		await tool(executors[0]!.session, "task_memory", { memory: "recovery durable checkpoint" });
		await executors[0]!.session.prompt("settle before process restart");
		await expect.poll(() => readTask(root, "goal-a", "T006").status).toBe("BLOCKED");
		await expect
			.poll(() =>
				controller.sessionManager
					.getEntries()
					.some((entry) => entry.type === "custom_message" && entry.customType === "control_event"),
			)
			.toBe(true);
		expect(
			controller.sessionManager
				.getEntries()
				.filter((entry) => entry.type === "custom_message")
				.every((entry) => entry.customType === "control_event"),
		).toBe(true);
		const recoveredId = executors[0]!.session.sessionManager.getSessionId();
		const recoveredFile = executors[0]!.session.sessionFile!;
		const recoveredAssignmentGeneration = readAssociations(root).current.find(
			(assignment) => assignment.taskId === "T006",
		)?.generation;
		await app.shutdown();
		appClosed = true;
		setSessionRegistryForTesting(undefined);
		const recoveredApp = await startPiRootApplication({ root, agentDir, sessionDir, createRuntime });
		const recoveredSlot = recoveredApp.runtimeHost.sessionPool.findBySessionId(recoveredId);
		expect(recoveredApp.canonicalControlSessionId).toBe(controller.sessionManager.getSessionId());
		expect(recoveredSlot?.session.sessionManager.getSessionId()).toBe(recoveredId);
		expect(recoveredSlot?.session.sessionFile).toBe(recoveredFile);
		expect(readAssociations(root).current.find((assignment) => assignment.taskId === "T006")?.generation).toBe(
			recoveredAssignmentGeneration,
		);
		expect(readTask(root, "goal-a", "T006").status).toBe("BLOCKED");
		expect(readFileSync(readTask(root, "goal-a", "T006").path, "utf8")).toContain("recovery durable checkpoint");
		expect(recoveredSlot?.session.getActiveToolNames()).toContain("task_memory");
		await recoveredApp.shutdown();
		setSessionRegistryForTesting(undefined);
	});
});
