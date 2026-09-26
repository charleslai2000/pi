import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentSessionEvent } from "../src/core/agent-session.ts";
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
		const ma4GoalId = "ma4-autonomous-fixture";
		mkdirSync(join(agentDir, "agents"), { recursive: true });
		mkdirSync(join(root, ".pi"), { recursive: true });
		mkdirSync(join(root, ".pi", "agents"), { recursive: true });
		mkdirSync(join(root, ".pi", "control", "goal-a"), { recursive: true });
		mkdirSync(join(root, ".pi", "control", ma4GoalId), { recursive: true });
		writeFileSync(join(root, ".pi", "AGENTS.md"), "PiRoot-local control instructions.\n");
		writeFileSync(join(root, "AGENTS.md"), "PiRoot instructions.\n");
		mkdirSync(join(root, ".pi", "agents"), { recursive: true });
		mkdirSync(join(root, "src"), { recursive: true });
		writeFileSync(join(root, ".pi", "agents", "orchestrator.md"), "You are the canonical task orchestrator.\n");
		writeFileSync(
			join(root, ".pi", "agents", "reviewer-deep.md"),
			"---\nvariant: high\n---\nIndependently review evidence in depth.\n",
		);
		writeFileSync(
			join(root, ".pi", "agents", "tester.md"),
			"---\ndescription: Test assigned changes.\n---\nVerify the requested behavior.\n",
		);
		writeFileSync(
			join(root, ".pi", "agents", "test-runner.md"),
			"---\ndescription: Run focused tests.\n---\nRun and report relevant tests.\n",
		);
		writeFileSync(join(root, "src", "AGENTS.md"), "Custom execution cwd instructions.\n");
		writeFileSync(
			join(root, ".pi", "agents", "coder.md"),
			"---\nagentSlug: coder\nmodel: faux/model\nvariant: high\n---\nUse coding conventions from coder profile.\n",
		);
		writeFileSync(
			join(root, ".pi", "agents", "reviewer.md"),
			"---\nagentSlug: reviewer\ndescription: Independent review of assigned evidence.\n---\nIndependently review the requested Task evidence.\n",
		);
		writeFileSync(
			join(root, ".pi", "agents", "debugger-deep.md"),
			"---\nagentSlug: debugger-deep\ndescription: Diagnose difficult failures.\nvariant: high\n---\nReconstruct failure causes from evidence.\n",
		);
		writeFileSync(
			join(root, ".pi", "control", "goal-a", "goal.md"),
			"# Goal A\nGoal memory: durable shared context.\n",
		);
		writeFileSync(
			join(root, ".pi", "control", "goal-a", "plan.md"),
			"Plan strategy: complete implementation, then review.\n",
		);
		writeFileSync(
			join(root, ".pi", "control", ma4GoalId, "goal.md"),
			"# Autonomous fixture\nGoal memory: qualify Controller tool plumbing.\n",
		);
		writeFileSync(
			join(root, ".pi", "control", ma4GoalId, "plan.md"),
			"Use separate Tasks for implementation, review, remediation, and verification.\n",
		);
		const faux = registerFauxProvider({
			tokenSize: { min: 1, max: 1 },
			models: [
				{ id: "model", name: "Faux", reasoning: true },
				{ id: "model-large", name: "Faux Large", reasoning: true, contextWindow: 256000 },
			],
		});
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
					id: "model-large",
					name: "Faux Large",
					api: model.api,
					reasoning: true,
					input: model.input,
					cost: model.cost,
					contextWindow: 256000,
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
		const executorFor = (taskId: string) => {
			const assignment = readAssociations(root).current.find((item) => item.taskId === taskId);
			if (!assignment) throw new Error(`Missing assignment for ${taskId}`);
			const slot = app.runtimeHost.sessionPool.findBySessionId(assignment.sessionId);
			if (!slot) throw new Error(`Missing live Session for ${taskId}`);
			return slot;
		};
		const autonomousChoices: Array<{ taskId: string; agent: string | undefined; cwd: string | undefined }> = [];
		const observedToolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
		const unsubscribeController = controller.subscribe((event) => {
			if (event.type === "tool_execution_start") {
				observedToolCalls.push({ name: event.toolName, arguments: event.args as Record<string, unknown> });
			}
		});
		cleanups.push(async () => unsubscribeController());
		const queuedControllerTool = (name: string, params: Parameters<typeof fauxToolCall>[1]) => {
			expect(faux.getPendingResponseCount()).toBe(0);
			faux.appendResponses([fauxAssistantMessage(fauxToolCall(name, params), { stopReason: "toolUse" })]);
		};
		const autonomous = async (name: string, params: Parameters<typeof fauxToolCall>[1]) => {
			const start = observedToolCalls.length;
			await controller.prompt(`Continue the orchestration policy for ${name}.`);
			const matchingCall = observedToolCalls.slice(start).find((part) => part.name === name);
			expect(faux.getPendingResponseCount()).toBe(0);
			if (!matchingCall) throw new Error(`No ${name} tool execution observed`);
			if (name === "dispatch_task") {
				autonomousChoices.push({
					taskId: String(matchingCall.arguments.taskId),
					agent: typeof matchingCall.arguments.agent === "string" ? matchingCall.arguments.agent : undefined,
					cwd: typeof matchingCall.arguments.cwd === "string" ? matchingCall.arguments.cwd : undefined,
				});
			}
			expect(matchingCall.arguments).toEqual(params);
		};
		const call = async (name: string, params: unknown) => tool(controller, name, params);

		queuedControllerTool("list_agents", {});
		await autonomous("list_agents", {});
		expect(faux.getPendingResponseCount()).toBe(0);
		const catalogResult = [...controller.messages].reverse().find((message) => message.role === "toolResult");
		const catalog = JSON.parse(text(catalogResult as { content: Array<{ type: string; text?: string }> })) as Array<{
			agentSlug: string;
			source: string;
			model?: string;
			variant?: string;
		}>;
		expect(catalog.map((agent) => agent.agentSlug)).toEqual(
			expect.arrayContaining(["coder", "reviewer", "reviewer-deep", "debugger-deep", "tester", "test-runner"]),
		);
		expect(catalog.map((agent) => agent.agentSlug)).not.toContain("orchestrator");
		expect(catalog.find((agent) => agent.agentSlug === "coder")).toMatchObject({
			source: "project",
			model: "faux/model",
			variant: "high",
		});
		queuedControllerTool("inspect_agent", { agentSlug: "coder" });
		await autonomous("inspect_agent", { agentSlug: "coder" });
		expect(faux.getPendingResponseCount()).toBe(0);
		const inspectResult = [...controller.messages].reverse().find((message) => message.role === "toolResult");
		expect(text(inspectResult as { content: Array<{ type: string; text?: string }> })).toContain(
			"Use coding conventions from coder profile.",
		);
		expect(controller.systemPrompt).toContain("PiRoot-local control instructions.");
		expect(controller.systemPrompt).toContain("Controller scheduling policy: decide whether a specialized Agent");
		queuedControllerTool("create_task", {
			goalId: ma4GoalId,
			taskId: "T001",
			slug: "implementation",
			objective: "Implement parser for bounded recipe files",
			constraints: "Reject duplicate keys and malformed delimiters",
			completion: "Valid fixture parses; invalid delimiter has regression evidence",
		});
		await autonomous("create_task", {
			goalId: ma4GoalId,
			taskId: "T001",
			slug: "implementation",
			objective: "Implement parser for bounded recipe files",
			constraints: "Reject duplicate keys and malformed delimiters",
			completion: "Valid fixture parses; invalid delimiter has regression evidence",
		});
		queuedControllerTool("dispatch_task", {
			goalId: ma4GoalId,
			taskId: "T001",
			agent: "coder",
			cwd: join(root, "src"),
		});
		await autonomous("dispatch_task", {
			goalId: ma4GoalId,
			taskId: "T001",
			agent: "coder",
			cwd: join(root, "src"),
		});
		const autoImplementation = executorFor("T001");
		expect(autoImplementation.session.sessionManager.getSessionName()).toBe("coder");
		expect(autoImplementation.session.model?.id).toBe("model");
		expect(autoImplementation.session.thinkingLevel).toBe("high");
		expect(autoImplementation.cwd).toBe(join(root, "src"));
		expect(autoImplementation.session.systemPrompt).toContain("Custom execution cwd instructions.");
		expect(
			app.registry.rows().find((row) => row.session_id === autoImplementation.session.sessionManager.getSessionId()),
		).toMatchObject({
			agent_slug: "coder",
			task_id: "T001",
			cwd: join(root, "src"),
			assignment_generation: 1,
		});
		expect(autonomousChoices.at(-1)).toEqual({ taskId: "T001", agent: "coder", cwd: join(root, "src") });
		await tool(autoImplementation.session, "task_gate", { decision: "accept" });
		expect(
			text(
				await tool(autoImplementation.session, "task_memory", {
					memory: "Valid fixture parses; implementation evidence committed.",
				}),
			),
		).toContain("Updated durable memory");
		queueEnvelope("completed", "Implementation complete");
		await autoImplementation.session.prompt("Implement the parser.");
		expect(faux.getPendingResponseCount()).toBe(0);
		await expect.poll(() => readTask(root, ma4GoalId, "T001").status).toBe("DONE");
		queuedControllerTool("create_task", {
			goalId: ma4GoalId,
			taskId: "T007",
			slug: "simple",
			objective: "Report project file count",
			completion: "Record count",
		});
		await autonomous("create_task", {
			goalId: ma4GoalId,
			taskId: "T007",
			slug: "simple",
			objective: "Report project file count",
			completion: "Record count",
		});
		queuedControllerTool("dispatch_task", { goalId: ma4GoalId, taskId: "T007" });
		await autonomous("dispatch_task", { goalId: ma4GoalId, taskId: "T007" });
		const genericSlot = executorFor("T007");
		expect(genericSlot.session.sessionManager.getSessionName()).toBe("execution");
		expect(genericSlot.cwd).toBe(root);
		expect(genericSlot.session.getActiveToolNames()).toEqual(["task_gate"]);
		expect(autonomousChoices.at(-1)).toEqual({ taskId: "T007", agent: undefined, cwd: undefined });
		expect(
			app.registry.rows().find((row) => row.session_id === genericSlot.session.sessionManager.getSessionId()),
		).toMatchObject({
			agent_slug: null,
			task_id: "T007",
			cwd: root,
			assignment_generation: 1,
		});
		await call("close_task", { goalId: ma4GoalId, taskId: "T007", outcome: "cancelled" });
		expect(faux.getPendingResponseCount()).toBe(0);
		await queuedControllerTool("create_task", {
			goalId: ma4GoalId,
			taskId: "T002",
			slug: "review",
			objective: "Review T001 parser implementation",
			inputs: "Assess parser behavior, malformed delimiters, tests and evidence",
			completion: "Record PASS or concrete findings",
		});
		await autonomous("create_task", {
			goalId: ma4GoalId,
			taskId: "T002",
			slug: "review",
			objective: "Review T001 parser implementation",
			inputs: "Assess parser behavior, malformed delimiters, tests and evidence",
			completion: "Record PASS or concrete findings",
		});
		await call("set_task_dependencies", {
			goalId: ma4GoalId,
			taskId: "T002",
			prerequisites: [{ goalId: ma4GoalId, taskId: "T001" }],
		});
		queuedControllerTool("dispatch_task", {
			goalId: ma4GoalId,
			taskId: "T002",
			agent: "reviewer-deep",
			cwd: join(root, "src"),
		});
		await autonomous("dispatch_task", {
			goalId: ma4GoalId,
			taskId: "T002",
			agent: "reviewer-deep",
			cwd: join(root, "src"),
		});
		const autoReview = executorFor("T002");
		expect(autoReview.session.sessionManager.getSessionName()).toBe("reviewer-deep");
		expect(autoReview.cwd).toBe(join(root, "src"));
		expect(autoReview.session.systemPrompt).toContain("Valid fixture parses; implementation evidence committed.");
		expect(autonomousChoices.at(-1)).toEqual({ taskId: "T002", agent: "reviewer-deep", cwd: join(root, "src") });
		await tool(autoReview.session, "task_gate", { decision: "accept" });
		await tool(autoReview.session, "task_memory", {
			memory: "Finding: parser accepts malformed trailing delimiter; reject it.",
		});
		queueEnvelope("completed", "Concrete parser finding");
		await autoReview.session.prompt("Review T001 and record findings.");
		expect(faux.getPendingResponseCount()).toBe(0);
		await expect.poll(() => readTask(root, ma4GoalId, "T002").status).toBe("DONE");
		queuedControllerTool("create_task", {
			goalId: ma4GoalId,
			taskId: "T003",
			slug: "remediation",
			objective: "Fix the malformed-delimiter finding",
			inputs: "Address T002 finding and add a regression test",
			completion: "Malformed trailing delimiters are rejected",
		});
		await autonomous("create_task", {
			goalId: ma4GoalId,
			taskId: "T003",
			slug: "remediation",
			objective: "Fix the malformed-delimiter finding",
			inputs: "Address T002 finding and add a regression test",
			completion: "Malformed trailing delimiters are rejected",
		});
		await call("set_task_dependencies", {
			goalId: ma4GoalId,
			taskId: "T003",
			prerequisites: [{ goalId: ma4GoalId, taskId: "T002" }],
		});
		queuedControllerTool("dispatch_task", { goalId: ma4GoalId, taskId: "T003", agent: "debugger-deep" });
		await autonomous("dispatch_task", { goalId: ma4GoalId, taskId: "T003", agent: "debugger-deep" });
		const autoRemediation = executorFor("T003");
		expect(autoRemediation.session.sessionManager.getSessionName()).toBe("debugger-deep");
		expect(autoRemediation.session.thinkingLevel).toBe("high");
		expect(autoRemediation.session.systemPrompt).toContain("Finding: parser accepts malformed trailing delimiter");
		expect(
			readAssociations(root).current.find((item) => item.goalId === ma4GoalId && item.taskId === "T003")?.generation,
		).toBe(1);
		expect(autonomousChoices.at(-1)).toEqual({ taskId: "T003", agent: "debugger-deep", cwd: undefined });
		await tool(autoRemediation.session, "task_gate", { decision: "accept" });
		await tool(autoRemediation.session, "task_memory", {
			memory: "Root cause: closing delimiter was optional. Made it mandatory; regression rejects suffix.",
		});
		queueEnvelope("completed", "Finding remediated");
		await autoRemediation.session.prompt("Fix T002 finding.");
		expect(faux.getPendingResponseCount()).toBe(0);
		await expect.poll(() => readTask(root, ma4GoalId, "T003").status).toBe("DONE");
		queuedControllerTool("create_task", {
			goalId: ma4GoalId,
			taskId: "T004",
			slug: "verification",
			objective: "Verify remediation and evidence",
			inputs: "Run focused parser tests; inspect T003 evidence and T001 implementation",
			completion: "Record verification result and evidence",
		});
		await autonomous("create_task", {
			goalId: ma4GoalId,
			taskId: "T004",
			slug: "verification",
			objective: "Verify remediation and evidence",
			inputs: "Run focused parser tests; inspect T003 evidence and T001 implementation",
			completion: "Record verification result and evidence",
		});
		await call("set_task_dependencies", {
			goalId: ma4GoalId,
			taskId: "T004",
			prerequisites: [{ goalId: ma4GoalId, taskId: "T003" }],
		});
		queuedControllerTool("dispatch_task", {
			goalId: ma4GoalId,
			taskId: "T004",
			agent: "tester",
			cwd: join(root, "tests"),
		});
		await autonomous("dispatch_task", {
			goalId: ma4GoalId,
			taskId: "T004",
			agent: "tester",
			cwd: join(root, "tests"),
		});
		const autoVerification = executorFor("T004");
		expect(autoVerification.session.sessionManager.getSessionName()).toBe("tester");
		expect(autoVerification.cwd).toBe(join(root, "tests"));
		expect(autoVerification.session.systemPrompt).toContain("Root cause: closing delimiter was optional");
		expect(autonomousChoices.at(-1)).toEqual({ taskId: "T004", agent: "tester", cwd: join(root, "tests") });
		await tool(autoVerification.session, "task_gate", { decision: "accept" });
		await tool(autoVerification.session, "task_memory", {
			memory: "Focused parser regression suite passed against corrected delimiter handling.",
		});
		queueEnvelope("completed", "Verification PASS");
		await autoVerification.session.prompt("Verify T003 remediation and report.");
		expect(faux.getPendingResponseCount()).toBe(0);
		await expect.poll(() => readTask(root, ma4GoalId, "T004").status).toBe("DONE");
		expect(["T001", "T002", "T003", "T004"].map((taskId) => readTask(root, ma4GoalId, taskId).status)).toEqual([
			"DONE",
			"DONE",
			"DONE",
			"DONE",
		]);
		expect(readAssociations(root).current).toEqual([]);
		expect(readExecutionAttempts(root).attempts).toEqual([]);
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
			taskId: "T007",
			slug: "generic",
			objective: "Check generic execution tenure",
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
		expect(controller.getActiveToolNames()).toEqual(
			expect.arrayContaining(["create_task", "dispatch_task", "inspect_task"]),
		);
		await call("dispatch_task", { goalId: "goal-a", taskId: "T001", agent: "coder" });
		const firstT1 = executorFor("T001");
		expect(firstT1.session.sessionManager.getSessionName()).toBe("coder");
		expect(firstT1.session.model?.id).toBe("model");
		expect(firstT1.session.thinkingLevel).toBe("high");
		expect(firstT1.session.systemPrompt).toContain("Use coding conventions from coder profile.");
		expect(firstT1.session.systemPrompt).toContain("Goal memory: durable shared context.");
		expect(firstT1.session.systemPrompt).toContain("Plan strategy: complete implementation, then review.");
		expect(firstT1.session.systemPrompt).not.toContain("Second parallel task");
		expect(firstT1.session.systemPrompt).toContain('<project_instructions path="');
		expect(firstT1.session.systemPrompt.indexOf("PiRoot instructions.")).toBeLessThan(
			firstT1.session.systemPrompt.indexOf("Goal relevant context (goal-a):"),
		);
		await call("dispatch_task", { goalId: "goal-a", taskId: "T002", agent: "coder" });
		const firstT2 = executorFor("T002");
		expect(firstT1.session.sessionManager.getSessionId()).not.toBe(firstT2.session.sessionManager.getSessionId());
		for (const executor of [firstT1, firstT2]) {
			expect(executor.session.getActiveToolNames()).toContain("task_gate");
			expect(executor.session.getActiveToolNames()).not.toContain("create_task");
		}
		const switchedSessionId = firstT1.session.sessionManager.getSessionId();
		await call("switch_executor_model", { executor_id: switchedSessionId, model: `${model.provider}/model-large` });
		expect(firstT1.session.sessionManager.getSessionId()).toBe(switchedSessionId);
		await tool(firstT1.session, "task_gate", { decision: "accept" });
		const originalTaskFile = readTask(root, "goal-a", "T001").path;
		const executorLifecycle: string[] = [];
		const unsubscribeExecutor = firstT1.session.subscribe((event: AgentSessionEvent) =>
			executorLifecycle.push(event.type),
		);
		await tool(firstT1.session, "task_memory", { memory: "parallel evidence 0; user follow-up handled" });
		queueEnvelope("completed", "result-0");
		await firstT1.session.prompt('<pi-executor-stop>{"reason":"completed","result":"result-0"}</pi-executor-stop>');
		unsubscribeExecutor();
		expect(executorLifecycle).toEqual(expect.arrayContaining(["agent_start", "agent_settled"]));
		await expect.poll(() => readTask(root, "goal-a", "T001").status).toBe("DONE");
		await tool(firstT2.session, "task_gate", { decision: "accept" });
		await tool(firstT2.session, "task_memory", { memory: "parallel evidence 1" });
		queueEnvelope("completed", "result-1");
		await firstT2.session.prompt("Executor T002 work turn.");
		expect(faux.getPendingResponseCount()).toBe(0);
		expect(readFileSync(originalTaskFile, "utf8")).toContain("user follow-up handled");
		await expect.poll(() => readTask(root, "goal-a", "T002").status).toBe("DONE");
		expect(readAssociations(root).current).toEqual([]);
		faux.appendResponses([
			fauxAssistantMessage('<pi-executor-stop>{"reason":"completed","result":"joined"}</pi-executor-stop>'),
		]);
		expect(faux.getPendingResponseCount()).toBe(1);
		await call("dispatch_task", { goalId: "goal-a", taskId: "T003", agent: "coder" });
		const t3Slot = executorFor("T003");
		await tool(t3Slot.session, "task_gate", { decision: "accept" });
		queueEnvelope("completed", "joined");
		await t3Slot.session.prompt("Join T001 and T002.");
		expect(faux.getPendingResponseCount()).toBe(0);
		await expect.poll(() => readTask(root, "goal-a", "T003").status).toBe("DONE");
		expect(faux.getPendingResponseCount()).toBe(0);
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
		expect(faux.getPendingResponseCount()).toBe(1);
		mkdirSync(join(root, "src"), { recursive: true });
		await call("dispatch_task", { goalId: "goal-a", taskId: "T004", agent: "reviewer", cwd: join(root, "src") });
		const t4Slot = executorFor("T004");
		expect(t4Slot.cwd).toBe(join(root, "src"));
		expect(
			app.registry.rows().find((row) => row.session_id === t4Slot.session.sessionManager.getSessionId()),
		).toMatchObject({
			agent_slug: "reviewer",
			task_id: "T004",
			cwd: join(root, "src"),
			assignment_generation: 1,
		});
		expect(t4Slot.session.sessionManager.getSessionName()).toBe("reviewer");
		expect(t4Slot.session.systemPrompt).toContain("Custom execution cwd instructions.");
		expect(t4Slot.session.systemPrompt).toContain('<project_instructions path="');
		expect(t4Slot.session.systemPrompt.indexOf("Independently review the requested Task evidence.")).toBeLessThan(
			t4Slot.session.systemPrompt.indexOf("Custom execution cwd instructions."),
		);
		await tool(t4Slot.session, "task_gate", { decision: "accept" });
		faux.appendResponses([
			fauxAssistantMessage('<pi-executor-stop>{"reason":"completed","result":"PASS"}</pi-executor-stop>'),
		]);
		await t4Slot.session.prompt("Review T003 and report PASS.");
		expect(faux.getPendingResponseCount()).toBe(0);
		await expect.poll(() => readTask(root, "goal-a", "T003").status).toBe("DONE");
		await expect.poll(() => readTask(root, "goal-a", "T004").status).toBe("DONE");

		// MA2 separate-Task implementation → review → finding-driven remediation scenario.
		await call("create_task", {
			goalId: "goal-a",
			taskId: "T008",
			slug: "implementation",
			objective: "Implement the requested change",
			completion: "Implementation is complete with evidence",
		});
		await call("dispatch_task", { goalId: "goal-a", taskId: "T008", agent: "coder" });
		const implementation = executorFor("T008");
		expect(implementation.session.sessionManager.getSessionName()).toBe("coder");
		expect(implementation.session.model?.id).toBe("model");
		expect(implementation.session.thinkingLevel).toBe("high");
		await tool(implementation.session, "task_gate", { decision: "accept" });
		await tool(implementation.session, "task_memory", {
			memory: "Implementation evidence: changed parser; focused test passed.",
		});
		queueEnvelope("completed", "Implementation complete");
		await implementation.session.prompt("Implement T008.");
		expect(faux.getPendingResponseCount()).toBe(0);
		await expect.poll(() => readTask(root, "goal-a", "T008").status).toBe("DONE");

		await call("create_task", {
			goalId: "goal-a",
			taskId: "T009",
			slug: "review",
			objective: "Review T008 implementation and evidence",
			inputs:
				"Target goal-a/T008; Goal: durable shared context; Plan: complete implementation then review; identify concrete correctness findings",
			completion: "Record PASS or durable findings",
		});
		await call("set_task_dependencies", {
			goalId: "goal-a",
			taskId: "T009",
			prerequisites: [{ goalId: "goal-a", taskId: "T008" }],
		});
		faux.appendResponses([fauxAssistantMessage("Admission ready; call task_gate accept.")]);
		await call("dispatch_task", { goalId: "goal-a", taskId: "T009", agent: "reviewer", cwd: join(root, "src") });
		const reviewSlot = executorFor("T009");
		expect(reviewSlot.session.sessionManager.getSessionName()).toBe("reviewer");
		expect(reviewSlot.cwd).toBe(join(root, "src"));
		expect(reviewSlot.session.systemPrompt).toContain("Implementation evidence: changed parser");
		await tool(reviewSlot.session, "task_gate", { decision: "accept" });
		await tool(reviewSlot.session, "task_memory", {
			memory: "Finding: parser accepts malformed trailing delimiters; remediation required.",
		});
		queueEnvelope("completed", "Finding recorded; remediation required");
		await reviewSlot.session.prompt("Review T008 independently; record concrete finding.");
		expect(faux.getPendingResponseCount()).toBe(0);
		await expect.poll(() => readTask(root, "goal-a", "T009").status).toBe("DONE");
		expect(readTask(root, "goal-a", "T008").status).toBe("DONE");

		await call("create_task", {
			goalId: "goal-a",
			taskId: "T010",
			slug: "remediation",
			objective: "Fix the finding from T009",
			inputs: "Address the review finding and provide regression evidence",
			completion: "Malformed trailing delimiters are rejected with a regression test",
		});
		await call("revise_task", {
			goalId: "goal-a",
			taskId: "T010",
			inputs:
				"Address the review finding and provide regression evidence; T008 evidence: changed parser; focused test passed",
		});
		await call("set_task_dependencies", {
			goalId: "goal-a",
			taskId: "T010",
			prerequisites: [{ goalId: "goal-a", taskId: "T009" }],
		});
		faux.appendResponses([fauxAssistantMessage("Admission ready; call task_gate accept.")]);
		await call("dispatch_task", { goalId: "goal-a", taskId: "T010", agent: "debugger-deep" });
		const remediation = executorFor("T010");
		expect(remediation.session.sessionManager.getSessionName()).toBe("debugger-deep");
		expect(remediation.session.thinkingLevel).toBe("high");
		expect(remediation.session.systemPrompt).toContain("Finding: parser accepts malformed trailing delimiters");
		expect(remediation.session.systemPrompt).toContain("T008 evidence: changed parser; focused test passed");
		expect(readAssociations(root).current.find((item) => item.taskId === "T010")?.generation).toBe(1);
		expect(
			app.registry.rows().find((row) => row.session_id === remediation.session.sessionManager.getSessionId()),
		).toMatchObject({
			agent_slug: "debugger-deep",
			task_id: "T010",
			assignment_generation: 1,
		});
		await tool(remediation.session, "task_gate", { decision: "accept" });
		await tool(remediation.session, "task_memory", {
			memory: "Remediated delimiter validation; regression test rejects malformed suffix.",
		});
		queueEnvelope("completed", "Finding remediated");
		await remediation.session.prompt("Fix the T009 finding and verify the regression.");
		expect(faux.getPendingResponseCount()).toBe(0);
		await expect.poll(() => readTask(root, "goal-a", "T010").status).toBe("DONE");
		expect(readTask(root, "goal-a", "T008").status).toBe("DONE");
		expect(readTask(root, "goal-a", "T009").status).toBe("DONE");
		expect(readAssociations(root).current).toEqual([]);
		expect(readExecutionAttempts(root).attempts).toEqual([]);
		await call("create_task", {
			goalId: "goal-a",
			taskId: "T005",
			slug: "handoff",
			objective: "Continue from durable handoff",
			completion: "done",
		});
		await call("dispatch_task", { goalId: "goal-a", taskId: "T005", agent: "coder" });
		const t5First = executorFor("T005");
		await tool(t5First.session, "task_gate", { decision: "accept" });
		await tool(t5First.session, "task_memory", { memory: "handoff evidence before termination" });
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
		const stopTracing = t5First.session.subscribe((event: AgentSessionEvent) => {
			if (event.type === "agent_start" || event.type === "agent_settled") {
				const lastAssistant = [...t5First.session.messages]
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
		await t5First.session.prompt("This Executor must terminate and hand off.");
		expect(faux.getPendingResponseCount()).toBe(0);
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
		await call("dispatch_task", { goalId: "goal-a", taskId: "T005", agent: "reviewer" });
		const t5Second = executorFor("T005");
		expect(t5Second.session.sessionManager.getSessionId()).not.toBe(t5First.session.sessionManager.getSessionId());
		expect(readAssociations(root).current.find((item) => item.taskId === "T005")?.generation).toBe(2);
		expect(
			app.registry.rows().find((row) => row.session_id === t5Second.session.sessionManager.getSessionId()),
		).toMatchObject({
			agent_slug: "reviewer",
			task_id: "T005",
			assignment_generation: 2,
		});
		expect(t5Second.session.sessionManager.getSessionName()).toBe("reviewer");
		expect(t5Second.session.systemPrompt).toContain("handoff evidence before termination");
		await tool(t5Second.session, "task_gate", { decision: "accept" });
		faux.appendResponses([
			fauxAssistantMessage(
				'<pi-executor-stop>{"reason":"completed","result":"handoff complete"}</pi-executor-stop>',
			),
		]);
		expect(readFileSync(readTask(root, "goal-a", "T005").path, "utf8")).toContain(
			"handoff evidence before termination",
		);
		await t5Second.session.prompt("Complete the reassigned Task.");
		expect(faux.getPendingResponseCount()).toBe(0);
		await expect.poll(() => readTask(root, "goal-a", "T005").status).toBe("DONE");
		expect(readAssociations(root).current).toEqual([]);
		expect(readExecutionAttempts(root).attempts).toEqual([]);
		expect(controller.getActiveToolNames()).toContain("switch_executor_model");
		expect(readFileSync(readTask(root, "goal-a", "T003").path, "utf8")).toContain("Status: DONE");

		await call("create_task", {
			goalId: "goal-a",
			taskId: "T006",
			slug: "recovery",
			objective: "Remain assigned across restart",
			completion: "continue after recovery",
		});
		queueEnvelope("blocked_external", "restart checkpoint");
		await call("dispatch_task", { goalId: "goal-a", taskId: "T006", agent: "coder" });
		const t6Slot = executorFor("T006");
		await tool(t6Slot.session, "task_gate", { decision: "accept" });
		await tool(t6Slot.session, "task_memory", { memory: "recovery durable checkpoint" });
		await t6Slot.session.prompt("settle before process restart");
		expect(faux.getPendingResponseCount()).toBe(0);
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
		const recoveredId = t6Slot.session.sessionManager.getSessionId();
		const recoveredFile = t6Slot.session.sessionFile!;
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
	}, 120_000);
});
