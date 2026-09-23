import { constants, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { basename, join, parse, resolve } from "node:path";
import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { resolvePath } from "../utils/paths.ts";
import type { AgentSession } from "./agent-session.ts";
import type { AgentSessionRuntimeDiagnostic, AgentSessionServices } from "./agent-session-services.ts";
import {
	type AssociationMutationResult,
	type AssociationRecord,
	assignTaskToSession,
	type CurrentAssignment,
	readAssociations,
	reassignTaskToSession,
	unassignTask,
	unassignTaskLocked,
	withAssociationMutationLock,
} from "./control/associations.ts";
import { listGoals, listTasks, readGoal, readTask } from "./control/read-model.ts";
import { createGoal, createTask, reviseGoal, reviseTask } from "./control/task-definitions.ts";
import {
	dependencySatisfied,
	listDerivedFrontier,
	setTaskDependencies,
	type TaskIdentity,
} from "./control/task-dependencies.ts";
import {
	type CompleteTaskOptions,
	cancelTask,
	completeTask,
	updateTaskMemory,
	updateTaskStatus,
} from "./control/task-mutations.ts";
import { isTerminalTaskStatus, parseTaskStatus } from "./control/task-status.ts";
import { type ControlTaskView, getTaskControlView, listFrontierControlViews } from "./control/view.ts";
import type {
	ProjectTrustContext,
	ReplacedSessionContext,
	SessionShutdownEvent,
	SessionStartEvent,
} from "./extensions/index.ts";
import { emitSessionShutdownEvent } from "./extensions/runner.ts";
import { assertCwdInsidePiRoot, assertSessionCwdInsidePiRoot, getPiRoot, getPiRootRuntimeDir } from "./pi-root.ts";
import type { CreateAgentSessionResult } from "./sdk.ts";
import { assertSessionCwdExists } from "./session-cwd.ts";
import { SessionManager } from "./session-manager.ts";
import { SessionPool, type SessionSlot } from "./session-pool.ts";
import { getSessionRegistry, PiRootUnavailableError } from "./session-registry.ts";

/**
 * Result returned by runtime creation.
 *
 * The caller gets the created session, its cwd-bound services, and all
 * diagnostics collected during setup.
 */
type ExecutorStopReason =
	| "completed"
	| "waiting_user"
	| "waiting_approval"
	| "blocked_external"
	| "terminated"
	| "continue_possible";

type ExecutorStopEnvelope = {
	reason: ExecutorStopReason;
	result?: string;
	remaining?: string;
	evidence?: string[];
	reasonDetail?: string;
};

const EXECUTOR_STOP_OPEN = "<pi-executor-stop>";
const EXECUTOR_STOP_CLOSE = "</pi-executor-stop>";

function textOfAssistant(message: AssistantMessage): string {
	return Array.isArray(message.content)
		? message.content
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("")
		: message.content;
}

function parseExecutorStopEnvelope(messages: readonly AgentMessage[]): ExecutorStopEnvelope | undefined {
	const last = [...messages].reverse().find((message): message is AssistantMessage => message.role === "assistant");
	if (!last) return undefined;
	const text = textOfAssistant(last).trim();
	if (!text.startsWith(EXECUTOR_STOP_OPEN) || !text.endsWith(EXECUTOR_STOP_CLOSE)) return undefined;
	const json = text.slice(EXECUTOR_STOP_OPEN.length, -EXECUTOR_STOP_CLOSE.length).trim();
	try {
		const value = JSON.parse(json) as Record<string, unknown>;
		const reasons: ExecutorStopReason[] = [
			"completed",
			"waiting_user",
			"waiting_approval",
			"blocked_external",
			"terminated",
			"continue_possible",
		];
		if (typeof value.reason !== "string" || !reasons.includes(value.reason as ExecutorStopReason)) return undefined;
		if (value.result !== undefined && typeof value.result !== "string") return undefined;
		if (value.remaining !== undefined && typeof value.remaining !== "string") return undefined;
		if (value.reasonDetail !== undefined && typeof value.reasonDetail !== "string") return undefined;
		if (
			value.evidence !== undefined &&
			(!Array.isArray(value.evidence) || value.evidence.some((item) => typeof item !== "string"))
		)
			return undefined;
		return value as unknown as ExecutorStopEnvelope;
	} catch {
		return undefined;
	}
}

const CONTROLLER_SESSION_PROTOCOL = [
	"You are the canonical Controller Session for this PiRoot.",
	"Controller is a policy LLM: runtime delivers factual Task/Executor notices and atomic tools, but never chooses orchestration policy for you.",
	"When a Task-change notice arrives, inspect facts with inspect_task and, when useful, inspect_frontier before deciding.",
	"Use notice_executor to continue or correct an existing Executor only when the facts justify it.",
	"Use switch_executor_model only when an explicit model change is justified; it preserves the same Executor Session and is unavailable while that Session is running.",
	"Context budget exhausted is only an observation, not proof that capability is insufficient. First inspect the Task, Executor state, active model, context snapshot, and any waiting-user or external-condition reason.",
	"If the Task has clear remaining work and a larger-context or stronger available model has a concrete expected benefit, you may explicitly switch the settled Executor in the same Session and then use notice_executor to continue it.",
	"Do not switch models merely because an exhausted notice arrived. Do not switch when the Executor is BLOCKED waiting for a user or external condition.",
	"Do not escalate indefinitely: if no better justified model is available, the Task has no clear next action, or another switch would be speculative, stop and wait naturally. Runtime never performs this decision for you.",
	"A completed Task remains DONE. Review is conditional: do not review every Task by default; create an ordinary review Task only when the Task type, risk, result, evidence, or model makes a concrete quality benefit worthwhile.",
	"Create a review Task with create_task, include the reviewed Task identity and result, review objective, acceptance criteria, and evidence or risk checks, then use set_task_dependencies so it depends on the completed Task. Dispatch it with the ordinary frontier and dispatch_task tools.",
	"A reviewer is an ordinary Executor with only task_gate and task_memory. A passing review completes the review Task through the Executor stop envelope and never modifies or reopens the original Task.",
	"If review findings require work, record findings in the review Task, complete it, and create an ordinary remediation Task with create_task and explicit DAG prerequisites. Do not reopen the original Task.",
	"Avoid duplicate review Tasks for the same completed result: inspect existing Tasks and their durable memory before creating one. Do not create a review/remediation loop without a new concrete result or finding.",
	"There is no ReviewExecution or reviewer-specific runtime; review and remediation are normal Tasks and must settle when no clear next action exists.",
	"A rejected or terminated Task may be dispatched again with dispatch_task when its current state and frontier eligibility justify that decision.",
	"A newly eligible frontier Task may be dispatched with dispatch_task; multiple frontier Tasks may be dispatched separately to separate Executor Sessions.",
	"A BLOCKED Task may be waiting for a user or external condition. Do not mechanically send continue notices, and do not repeatedly prompt a non-terminal Task without a concrete reason.",
	"If there is no clear next action, naturally settle this Controller Session. Do not implement a scheduler, polling loop, hardcoded dispatch loop, or hidden orchestration state.",
	"Controller close_task is an explicit lifecycle mutation and does not require a self-notification; Executor-originated reject, BLOCKED, DONE, and DEFERRED notices remain factual inputs.",
].join("\n");

export interface ExecutorContextSnapshot {
	readonly currentContextUsage: number | null;
	readonly effectiveContextLimit: number | null;
	readonly remainingHeadroom: number | null;
	readonly contextPercent: number | null;
	readonly budgetState: "available" | "compacting" | "unknown" | "exhausted";
	readonly compaction: {
		readonly active: boolean;
		readonly usageKnown: boolean;
	};
}

export interface CreateAgentSessionRuntimeResult extends CreateAgentSessionResult {
	services: AgentSessionServices;
	diagnostics: AgentSessionRuntimeDiagnostic[];
}

/**
 * Creates a full runtime for a target cwd and session manager.
 *
 * The factory closes over process-global fixed inputs, recreates cwd-bound
 * services for the effective cwd, resolves session options against those
 * services, and finally creates the AgentSession.
 */
export type CreateAgentSessionRuntimeFactory = (options: {
	cwd: string;
	agentDir: string;
	sessionManager: SessionManager;
	sessionStartEvent?: SessionStartEvent;
	projectTrustContext?: ProjectTrustContext;
}) => Promise<CreateAgentSessionRuntimeResult>;

/**
 * Thrown when /import references a JSONL file path that does not exist.
 */
export class ControllerSessionAlreadyExistsError extends Error {
	constructor() {
		super("The control session already exists. Switch to it with /sessions.");
		this.name = "ControllerSessionAlreadyExistsError";
	}
}

export class SessionImportFileNotFoundError extends Error {
	readonly filePath: string;

	constructor(filePath: string) {
		super(`File not found: ${filePath}`);
		this.name = "SessionImportFileNotFoundError";
		this.filePath = filePath;
	}
}

function extractUserMessageText(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") {
		return content;
	}

	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("");
}

/**
 * Owns the current AgentSession plus its cwd-bound services.
 *
 * Session replacement methods tear down the current runtime first, then create
 * and apply the next runtime. If creation fails, the error is propagated to the
 * caller. The caller is responsible for user-facing error handling.
 */
export class AgentSessionRuntime {
	private rebindSession?: (session: AgentSession) => Promise<void>;
	private beforeForegroundSwitch?: () => void;
	private beforeSessionInvalidate?: () => void;
	private readonly _sessionPool: SessionPool;
	private readonly createRuntime: CreateAgentSessionRuntimeFactory;
	private _diagnostics: AgentSessionRuntimeDiagnostic[];
	private _modelFallbackMessage?: string;
	private replacementSlot?: SessionSlot;
	private readonly taskSessionBindings = new Map<string, () => void>();
	private taskRunGenerations = new Map<string, number>();
	private readonly taskSessionAdmission = new Map<string, { accepted: boolean; resulted: boolean; active: boolean }>();
	private controllerNoticeKeys = new Set<string>();
	private suppressExecutorSettlement = new Set<string>();

	constructor(
		_session: AgentSession,
		_services: AgentSessionServices,
		createRuntime: CreateAgentSessionRuntimeFactory,
		_diagnostics: AgentSessionRuntimeDiagnostic[] = [],
		_modelFallbackMessage?: string,
		_sessionPool = new SessionPool(),
	) {
		this._sessionPool = _sessionPool;
		const initialSlot = this._sessionPool.adopt(_session, _services);
		this._sessionPool.setForeground(initialSlot.id);
		this.createRuntime = createRuntime;
		this._diagnostics = _diagnostics;
		this._modelFallbackMessage = _modelFallbackMessage;
		if (getSessionRegistry()?.canonicalControlSessionId() === _session.sessionManager.getSessionId()) {
			this.installControllerTools(_session);
			_session.setTaskSessionProtocol(CONTROLLER_SESSION_PROTOCOL);
		}
	}

	get sessionPool(): SessionPool {
		return this._sessionPool;
	}

	subscribeActivity(listener: Parameters<SessionPool["subscribeActivity"]>[0]): () => void {
		return this._sessionPool.subscribeActivity(listener);
	}

	get services(): AgentSessionServices {
		return this._sessionPool.getForeground().services;
	}

	get session(): AgentSession {
		return this._sessionPool.getForeground().session;
	}

	get cwd(): string {
		return this._sessionPool.getForeground().cwd;
	}

	get diagnostics(): readonly AgentSessionRuntimeDiagnostic[] {
		return this._diagnostics;
	}

	get modelFallbackMessage(): string | undefined {
		return this._modelFallbackMessage;
	}

	private associationRoot(): string {
		const registry = getSessionRegistry();
		if (!registry) throw new PiRootUnavailableError();
		return registry.getRoot();
	}

	getExecutorContextSnapshot(sessionId: string): ExecutorContextSnapshot | undefined {
		const slot = this._sessionPool.findBySessionId(sessionId);
		if (!slot) return undefined;
		if (typeof slot.session.getContextUsage !== "function") return undefined;
		const usage = slot.session.getContextUsage();
		const compacting = slot.session.isCompacting === true;
		const budgetState = compacting
			? "compacting"
			: usage?.tokens === null || usage === undefined
				? "unknown"
				: usage.tokens >= usage.contextWindow
					? "exhausted"
					: "available";
		return {
			currentContextUsage: usage?.tokens ?? null,
			effectiveContextLimit: usage?.contextWindow ?? null,
			remainingHeadroom:
				usage?.tokens === null || usage === undefined ? null : Math.max(0, usage.contextWindow - usage.tokens),
			contextPercent: usage?.percent ?? null,
			budgetState,
			compaction: {
				active: compacting,
				usageKnown: usage?.tokens !== null && usage !== undefined,
			},
		};
	}

	private async notifyController(factKey: string, message: string): Promise<void> {
		if (!this.controllerNoticeKeys) this.controllerNoticeKeys = new Set<string>();
		const noticeKeys = this.controllerNoticeKeys;
		if (noticeKeys.has(factKey)) return;
		noticeKeys.add(factKey);
		const controllerId = getSessionRegistry()?.canonicalControlSessionId();
		if (!controllerId) return;
		const controller = this._sessionPool.findBySessionId(controllerId);
		if (!controller) return;
		await controller.session.sendCustomMessage(
			{ customType: "control_event", content: message, display: true, details: { factKey } },
			{ triggerTurn: true, deliverAs: controller.session.isStreaming ? "followUp" : undefined },
		);
	}

	private async notifyTaskChange(
		goalId: string,
		taskId: string,
		status: string,
		executor: string,
		reason: string,
	): Promise<void> {
		await this.notifyController(
			`${goalId}/${taskId}:${status}:${executor}:${reason}`,
			`Task ${goalId}/${taskId} changed:\nstatus=${status}\nexecutor=${executor}\nreason=${reason}`,
		);
	}

	private tryAssociationRecord(): AssociationRecord | undefined {
		const registry = getSessionRegistry();
		return registry ? readAssociations(registry.getRoot()) : undefined;
	}

	listCurrentAssignments(): Array<
		CurrentAssignment & { sessionName?: string; cwd?: string; runtimeState: "active" | "inactive" }
	> {
		const registry = getSessionRegistry();
		const record = this.tryAssociationRecord();
		if (!record) return [];
		return record.current.map((assignment) => {
			const row = registry?.rows().find((candidate) => candidate.session_id === assignment.sessionId);
			return {
				...assignment,
				sessionName: row?.name ?? undefined,
				cwd: row?.cwd,
				runtimeState: row?.runtime_state ?? "inactive",
			};
		});
	}

	getTaskAssignment(goalId: string, taskId: string) {
		const root = this.associationRoot();
		readGoal(root, goalId);
		readTask(root, goalId, taskId);
		return this.listCurrentAssignments().find(
			(assignment) => assignment.goalId === goalId && assignment.taskId === taskId,
		);
	}

	getSessionAssignment(sessionId: string) {
		return this.listCurrentAssignments().find((assignment) => assignment.sessionId === sessionId);
	}

	private isCurrentTaskBinding(
		goalId: string,
		taskId: string,
		sessionId: string,
		admission: { accepted: boolean; resulted: boolean; active: boolean; assignmentGeneration: number },
	): boolean {
		if (!admission.accepted || admission.resulted || this.taskSessionAdmission.get(sessionId) !== admission)
			return false;
		const assignment = this.getTaskAssignment(goalId, taskId);
		return assignment?.sessionId === sessionId && assignment.generation === admission.assignmentGeneration;
	}

	assignTask(goalId: string, taskId: string, sessionId: string): Promise<AssociationMutationResult> {
		return assignTaskToSession(this.associationRoot(), goalId, taskId, sessionId);
	}

	async unassignTask(goalId: string, taskId: string): Promise<AssociationMutationResult> {
		const current = this.getTaskAssignment(goalId, taskId);
		const result = await unassignTask(this.associationRoot(), goalId, taskId);
		getSessionRegistry()?.refreshRoles();
		if (result.changed && current) this.taskSessionBindings.get(current.sessionId)?.();
		if (result.changed && current) this.taskSessionBindings.delete(current.sessionId);
		return result;
	}

	async reassignTask(goalId: string, taskId: string, sessionId: string): Promise<AssociationMutationResult> {
		const current = this.getTaskAssignment(goalId, taskId);
		const result = await reassignTaskToSession(this.associationRoot(), goalId, taskId, sessionId);
		getSessionRegistry()?.refreshRoles();
		if (result.changed && current && current.sessionId !== sessionId) {
			this.taskSessionBindings.get(current.sessionId)?.();
			this.taskSessionBindings.delete(current.sessionId);
		}
		return result;
	}

	getTaskControlView(goalId: string, taskId: string): ControlTaskView {
		return getTaskControlView(this.associationRoot(), goalId, taskId);
	}

	listFrontierControlViews(): ControlTaskView[] {
		return listFrontierControlViews(this.associationRoot());
	}

	async completeTask(goalId: string, taskId: string, options?: CompleteTaskOptions) {
		const result = await completeTask(this.associationRoot(), goalId, taskId, options);
		if (result.changed) {
			const assignment = this.getTaskAssignment(goalId, taskId);
			if (assignment) {
				this.taskSessionBindings.get(assignment.sessionId)?.();
				await unassignTask(this.associationRoot(), goalId, taskId);
			}
		}
		return result;
	}

	async cancelTask(goalId: string, taskId: string) {
		const result = await cancelTask(this.associationRoot(), goalId, taskId);
		if (result.changed) {
			const assignment = this.getTaskAssignment(goalId, taskId);
			if (assignment) {
				this.taskSessionBindings.get(assignment.sessionId)?.();
				await unassignTask(this.associationRoot(), goalId, taskId);
			}
		}
		return result;
	}

	private controllerTool(
		session: AgentSession,
		name: string,
		description: string,
		parameters: AgentTool["parameters"],
		execute: AgentTool["execute"],
	): () => void {
		return session.installTemporaryTool({ name, label: name, description, parameters, execute });
	}

	private installControllerTools(_session: AgentSession): void {
		const text = (value: string) => ({ content: [{ type: "text" as const, text: value }], details: undefined });
		this.controllerTool(
			_session,
			"create_goal",
			"Create a Goal authority directory with goal.md without raw file mutation.",
			{
				type: "object",
				properties: { goalId: { type: "string" }, title: { type: "string" }, status: { type: "string" } },
				required: ["goalId"],
				additionalProperties: false,
			} as AgentTool["parameters"],
			async (_id, raw) => {
				const p = raw as Record<string, unknown>;
				return text(
					`Created Goal ${String(p.goalId)} at ${createGoal(this.associationRoot(), String(p.goalId), { title: p.title as string | undefined, status: p.status as string | undefined })}`,
				);
			},
		);
		this.controllerTool(
			_session,
			"revise_goal",
			"Revise managed Goal fields without raw file mutation.",
			{
				type: "object",
				properties: { goalId: { type: "string" }, title: { type: "string" }, status: { type: "string" } },
				required: ["goalId"],
				additionalProperties: false,
			} as AgentTool["parameters"],
			async (_id, raw) => {
				const p = raw as Record<string, unknown>;
				return text(
					`Revised Goal ${String(p.goalId)} at ${reviseGoal(this.associationRoot(), String(p.goalId), { title: p.title as string | undefined, status: p.status as string | undefined })}`,
				);
			},
		);
		this.controllerTool(
			_session,
			"create_task",
			"Create a READY Task definition without dispatching it.",
			{
				type: "object",
				properties: {
					goalId: { type: "string" },
					taskId: { type: "string" },
					slug: { type: "string" },
					objective: { type: "string" },
					constraints: { type: "string" },
					inputs: { type: "string" },
					completion: { type: "string" },
				},
				required: ["goalId", "taskId", "slug", "objective", "completion"],
				additionalProperties: false,
			} as AgentTool["parameters"],
			async (_id, raw) => {
				const p = raw as Record<string, unknown>;
				const task = createTask(this.associationRoot(), String(p.goalId), String(p.taskId), String(p.slug), {
					objective: String(p.objective),
					constraints: p.constraints as string | undefined,
					inputs: p.inputs as string | undefined,
					completion: String(p.completion),
				});
				return text(`Created ${task.goalId}/${task.taskId}`);
			},
		);
		this.controllerTool(
			_session,
			"revise_task",
			"Revise non-terminal Task definition fields without changing runtime state.",
			{
				type: "object",
				properties: {
					goalId: { type: "string" },
					taskId: { type: "string" },
					objective: { type: "string" },
					constraints: { type: "string" },
					inputs: { type: "string" },
					completion: { type: "string" },
				},
				required: ["goalId", "taskId"],
				additionalProperties: false,
			} as AgentTool["parameters"],
			async (_id, raw) => {
				const p = raw as Record<string, unknown>;
				const task = await reviseTask(this.associationRoot(), String(p.goalId), String(p.taskId), {
					objective: p.objective as string | undefined,
					constraints: p.constraints as string | undefined,
					inputs: p.inputs as string | undefined,
					completion: p.completion as string | undefined,
				});
				return text(`Revised ${task.goalId}/${task.taskId}`);
			},
		);
		this.controllerTool(
			_session,
			"inspect_task",
			"Inspect Task definition, durable memory, assignment, and Executor runtime state.",
			{
				type: "object",
				properties: { goalId: { type: "string" }, taskId: { type: "string" } },
				required: ["goalId", "taskId"],
				additionalProperties: false,
			} as AgentTool["parameters"],
			async (_id, raw) => {
				const p = raw as Record<string, unknown>;
				const task = readTask(this.associationRoot(), String(p.goalId), String(p.taskId));
				const assignment = this.getTaskAssignment(task.goalId, task.taskId);
				const executor = assignment ? this._sessionPool.findBySessionId(assignment.sessionId) : undefined;
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({
								task,
								assignment,
								executor: executor
									? {
											sessionId: assignment?.sessionId,
											busy: executor.activity.busy,
											runtimeState: "active",
											context: this.getExecutorContextSnapshot(assignment!.sessionId),
										}
									: undefined,
							}),
						},
					],
					details: undefined,
				};
			},
		);
		this.controllerTool(
			_session,
			"set_task_dependencies",
			"Replace prerequisites for a non-terminal Task.",
			{
				type: "object",
				properties: {
					goalId: { type: "string" },
					taskId: { type: "string" },
					prerequisites: {
						type: "array",
						items: {
							type: "object",
							properties: { goalId: { type: "string" }, taskId: { type: "string" } },
							required: ["goalId", "taskId"],
							additionalProperties: false,
						},
					},
				},
				required: ["goalId", "taskId", "prerequisites"],
				additionalProperties: false,
			} as AgentTool["parameters"],
			async (_id, raw) => {
				const p = raw as { goalId: string; taskId: string; prerequisites: TaskIdentity[] };
				const task = await setTaskDependencies(
					this.associationRoot(),
					p.goalId,
					p.taskId,
					p.prerequisites,
					(goalId, taskId) => Boolean(this.getTaskAssignment(goalId, taskId)),
				);
				return text(`Updated prerequisites for ${task.goalId}/${task.taskId}`);
			},
		);
		this.controllerTool(
			_session,
			"inspect_frontier",
			"Compute the currently dispatchable derived Task frontier.",
			{ type: "object", properties: {}, additionalProperties: false } as AgentTool["parameters"],
			async () => {
				const root = this.associationRoot();
				const assignments = readAssociations(root);
				const tasks = listGoals(root).flatMap((goal) => listTasks(root, goal.goalId));
				const frontier = listDerivedFrontier(root, tasks, (task) =>
					assignments.current.some(
						(assignment) => assignment.goalId === task.goalId && assignment.taskId === task.taskId,
					),
				);
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
								frontier.map((task) => ({
									goalId: task.goalId,
									taskId: task.taskId,
									status: task.status,
									objective: task.objective,
									prerequisites: task.prerequisites,
									dependenciesSatisfied: dependencySatisfied(root, task),
								})),
							),
						},
					],
					details: undefined,
				};
			},
		);
		this.controllerTool(
			_session,
			"dispatch_task",
			"Assign a READY or DEFERRED Task to an Executor Session and start admission.",
			{
				type: "object",
				properties: { goalId: { type: "string" }, taskId: { type: "string" }, sessionId: { type: "string" } },
				required: ["goalId", "taskId"],
				additionalProperties: false,
			} as AgentTool["parameters"],
			async (_id, raw) => {
				const p = raw as Record<string, unknown>;
				const task = readTask(this.associationRoot(), String(p.goalId), String(p.taskId));
				if (task.status !== "READY" && task.status !== "DEFERRED")
					throw new Error(`Task is not dispatchable: ${task.goalId}/${task.taskId}`);
				if (!dependencySatisfied(this.associationRoot(), task))
					throw new Error(`Task prerequisites are not satisfied: ${task.goalId}/${task.taskId}`);
				if (this.getTaskAssignment(task.goalId, task.taskId))
					throw new Error(`Task already has a valid assignment: ${task.goalId}/${task.taskId}`);
				let target = typeof p.sessionId === "string" ? this._sessionPool.findBySessionId(p.sessionId) : undefined;
				if (p.sessionId !== undefined && !target)
					throw new Error(`Executor Session is not live: ${String(p.sessionId)}`);
				if (!target) {
					const runtimeDir = getPiRootRuntimeDir(this.associationRoot());
					if (!runtimeDir) throw new Error("PiRoot runtime directory is unavailable");
					const manager = SessionManager.create(this.cwd, join(runtimeDir, "sessions"));
					if (manager.getSessionFile() && !existsSync(manager.getSessionFile()!)) manager.persistSessionHeader();
					const result = await this.createRuntime({
						cwd: this.cwd,
						agentDir: this.services.agentDir,
						sessionManager: manager,
					});
					target = this._sessionPool.adopt(result.session, result.services);
				}
				await assignTaskToSession(
					this.associationRoot(),
					task.goalId,
					task.taskId,
					target.session.sessionManager.getSessionId(),
				);
				getSessionRegistry()?.refreshRoles();
				await this.startAssignedTask(task.goalId, task.taskId);
				return text(`Dispatched ${task.goalId}/${task.taskId} to ${target.session.sessionManager.getSessionId()}`);
			},
		);
		this.controllerTool(
			_session,
			"switch_executor_model",
			"Switch a settled Executor Session to another authenticated model without changing its Session or Task assignment.",
			{
				type: "object",
				properties: {
					executor_id: { type: "string" },
					model: { type: "string" },
					effort: { type: "string" },
				},
				required: ["executor_id", "model"],
				additionalProperties: false,
			} as AgentTool["parameters"],
			async (_id, raw) => {
				const params = raw as { executor_id?: unknown; model?: unknown; effort?: unknown };
				if (typeof params.executor_id !== "string" || typeof params.model !== "string")
					throw new Error("executor_id and model are required");
				const target = this._sessionPool.findBySessionId(params.executor_id);
				if (!target) throw new Error(`Executor Session is not live: ${params.executor_id}`);
				if (target.session.isStreaming) throw new Error("Cannot switch a running Executor Session");
				const separator = params.model.indexOf("/");
				if (separator <= 0 || separator === params.model.length - 1)
					throw new Error(`Invalid model identifier: ${params.model}`);
				const provider = params.model.slice(0, separator);
				const modelId = params.model.slice(separator + 1);
				const model = target.services.modelRuntime.getModel(provider, modelId);
				if (!model) throw new Error(`Model is not available: ${params.model}`);
				await target.session.setModel(model, { persist: false });
				if (params.effort !== undefined) {
					if (typeof params.effort !== "string") throw new Error("Invalid effort");
					target.session.setThinkingLevel(params.effort as Parameters<AgentSession["setThinkingLevel"]>[0], {
						persist: false,
					});
				}
				return text(`Switched ${params.executor_id} to ${params.model}`);
			},
		);
		this.controllerTool(
			_session,
			"notice_executor",
			"Send a native Session message to an Executor without changing Task lifecycle.",
			{
				type: "object",
				properties: { sessionId: { type: "string" }, message: { type: "string" } },
				required: ["sessionId", "message"],
				additionalProperties: false,
			} as AgentTool["parameters"],
			async (_id, raw) => {
				const p = raw as Record<string, unknown>;
				const target = this._sessionPool.findBySessionId(String(p.sessionId));
				if (!target) throw new Error(`Executor Session is not live: ${String(p.sessionId)}`);
				await target.session.prompt(String(p.message), { expandPromptTemplates: false, source: "extension" });
				return text(`Noticed ${String(p.sessionId)}`);
			},
		);
		this.controllerTool(
			_session,
			"close_task",
			"Explicitly complete or cancel a Task lifecycle.",
			{
				type: "object",
				properties: {
					goalId: { type: "string" },
					taskId: { type: "string" },
					outcome: { type: "string", enum: ["completed", "cancelled"] },
					result: { type: "string" },
					remaining: { type: "string" },
				},
				required: ["goalId", "taskId", "outcome"],
				additionalProperties: false,
			} as AgentTool["parameters"],
			async (_id, raw) => {
				const p = raw as Record<string, unknown>;
				if (p.outcome === "completed")
					await this.completeTask(String(p.goalId), String(p.taskId), {
						result: p.result as string | undefined,
						remaining: p.remaining as string | undefined,
					});
				else if (p.outcome === "cancelled") await this.cancelTask(String(p.goalId), String(p.taskId));
				else throw new Error("Invalid close_task outcome");
				return text(`Closed ${String(p.goalId)}/${String(p.taskId)} as ${String(p.outcome)}`);
			},
		);
		_session.setActiveToolsByName([
			..._session.getActiveToolNames(),
			"create_goal",
			"revise_goal",
			"create_task",
			"revise_task",
			"inspect_task",
			"set_task_dependencies",
			"inspect_frontier",
			"dispatch_task",
			"switch_executor_model",
			"notice_executor",
			"close_task",
		]);
	}

	/** Start Task work in its assigned long-lived Pi Session. */
	async startAssignedTask(goalId: string, taskId: string, options?: { admitted?: boolean }): Promise<void> {
		const piRoot = this.associationRoot();
		const task = readTask(piRoot, goalId, taskId);
		const status = parseTaskStatus(task.status);
		if (status === undefined) throw new Error(`Task has invalid Status: ${goalId}/${taskId}`);
		if (isTerminalTaskStatus(status)) throw new Error(`Task is terminal: ${goalId}/${taskId}`);
		const assignment = this.getTaskAssignment(goalId, taskId);
		if (!assignment) throw new Error(`Task is not assigned: ${goalId}/${taskId}`);
		const slot = this._sessionPool.findBySessionId(assignment.sessionId);
		if (!slot) throw new Error(`Assigned Session is not live: ${assignment.sessionId}`);
		this.taskSessionBindings.get(assignment.sessionId)?.();
		const admission = {
			accepted: options?.admitted === true,
			resulted: false,
			active: true,
			assignmentGeneration: assignment.generation,
		};
		const previousTools = slot.session.getActiveToolNames();
		let activateTaskTools = (): void => {};
		this.taskSessionAdmission.set(assignment.sessionId, admission);
		const sessionId = assignment.sessionId;
		const assignmentGeneration = assignment.generation;
		const runGenerations = this.taskRunGenerations ?? new Map<string, number>();
		this.taskRunGenerations = runGenerations;
		const runGeneration = (runGenerations.get(sessionId) ?? 0) + 1;
		runGenerations.set(sessionId, runGeneration);
		const removeLifecycleListener = slot.session.subscribe((event) => {
			if (!admission.active) return;
			if (event.type === "agent_start") {
				runGenerations.set(sessionId, (runGenerations.get(sessionId) ?? runGeneration) + 1);
				if (!this.isCurrentTaskBinding(goalId, taskId, sessionId, admission)) return;
				const startedGeneration = runGenerations.get(sessionId);
				void withAssociationMutationLock(piRoot, async () => {
					if (
						runGenerations.get(sessionId) !== startedGeneration ||
						!this.isCurrentTaskBinding(goalId, taskId, sessionId, admission) ||
						this.getTaskAssignment(goalId, taskId)?.generation !== assignmentGeneration
					)
						return;
					const current = readTask(piRoot, goalId, taskId);
					if (parseTaskStatus(current.status) === "BLOCKED")
						await updateTaskStatus(piRoot, goalId, taskId, { status: "ACTIVE" });
				});
				return;
			}
			if (event.type !== "agent_settled") return;
			const settleGeneration = runGenerations.get(sessionId) ?? runGeneration;
			if (!slot.session.isIdle) return;
			if (this.suppressExecutorSettlement.delete(sessionId)) return;
			const envelope = parseExecutorStopEnvelope(slot.session.messages);
			const result = envelope?.result;
			const remaining = envelope?.remaining ?? envelope?.reasonDetail;
			const reason = envelope?.reason ?? "premature_settle";
			const acceptedRun = admission.accepted;
			void withAssociationMutationLock(piRoot, async () => {
				if (
					runGenerations.get(sessionId) !== settleGeneration ||
					!acceptedRun ||
					!this.isCurrentTaskBinding(goalId, taskId, sessionId, admission) ||
					this.getTaskAssignment(goalId, taskId)?.generation !== assignmentGeneration ||
					!slot.session.isIdle ||
					slot.session.isCompacting === true
				)
					return;
				const latest = readTask(piRoot, goalId, taskId);
				const latestStatus = parseTaskStatus(latest.status);
				if (reason === "terminated" && latestStatus !== "ACTIVE") return;
				if (latestStatus !== "ACTIVE" && !(reason === "completed" && latestStatus === "BLOCKED")) return;
				if (reason === "completed") {
					await completeTask(piRoot, goalId, taskId, { result, remaining });
					admission.resulted = true;
					unassignTaskLocked(piRoot, goalId, taskId);
					getSessionRegistry()?.refreshRoles();
					return;
				} else if (reason === "terminated") {
					await updateTaskStatus(piRoot, goalId, taskId, { status: "DEFERRED", result, remaining });
					admission.resulted = true;
					unassignTaskLocked(piRoot, goalId, taskId);
					getSessionRegistry()?.refreshRoles();
					return { status: "DEFERRED", reason: "executor terminated by stop envelope" };
				} else if (reason === "continue_possible") {
					return;
				} else {
					await updateTaskStatus(piRoot, goalId, taskId, {
						status: "BLOCKED",
						result,
						remaining:
							remaining ??
							(envelope
								? `executor stop reason: ${reason}`
								: "protocol violation: missing or invalid stop envelope"),
					});
					return {
						status: "BLOCKED",
						reason: envelope ? `executor stop reason: ${reason}` : "protocol violation",
					};
				}
			}).then(async (notice) => {
				if (notice) await this.notifyTaskChange(goalId, taskId, notice.status, sessionId, notice.reason);
			});
		});
		const taskGate = slot.session.installTemporaryTool({
			name: "task_gate",
			label: "Task gate",
			description: "Accept or reject the current Task assignment before work begins.",
			parameters: {
				type: "object",
				properties: { decision: { type: "string", enum: ["accept", "reject"] }, reason: { type: "string" } },
				required: ["decision"],
				additionalProperties: false,
			} as AgentTool["parameters"],
			execute: async (_toolCallId: string, rawParams: unknown) => {
				const params = rawParams as { decision?: unknown; reason?: unknown };
				if (params.decision !== "accept" && params.decision !== "reject")
					throw new Error("Invalid task_gate decision");
				if (params.reason !== undefined && typeof params.reason !== "string")
					throw new Error("Invalid task_gate reason");
				if (params.decision === "accept") {
					if (admission.accepted)
						return {
							content: [{ type: "text", text: `Already accepted ${goalId}/${taskId}` }],
							details: undefined,
						};
					admission.accepted = true;
					await updateTaskStatus(piRoot, goalId, taskId, { status: "ACTIVE" });
					activateTaskTools();
					return { content: [{ type: "text", text: `Accepted ${goalId}/${taskId}` }], details: undefined };
				}
				if (admission.accepted) throw new Error("Cannot reject an accepted Task");
				await unassignTask(piRoot, goalId, taskId);
				admission.resulted = true;
				await this.notifyTaskChange(
					goalId,
					taskId,
					"READY",
					assignment.sessionId,
					`executor rejected assignment${params.reason ? `: ${params.reason}` : ""}`,
				);
				return { content: [{ type: "text", text: `Rejected ${goalId}/${taskId}` }], details: params.reason };
			},
		});
		const removeMemoryTool = slot.session.installTemporaryTool({
			name: "task_memory",
			label: "Task memory",
			description:
				"Save durable progress, decisions, evidence, blockers, or next steps to the currently assigned Task Markdown.",
			parameters: {
				type: "object",
				properties: { memory: { type: "string" } },
				required: ["memory"],
				additionalProperties: false,
			} as AgentTool["parameters"],
			execute: async (_toolCallId: string, rawParams: unknown) => {
				if (!admission.accepted) throw new Error("Task gate must be accepted before task_memory");
				if (typeof rawParams !== "object" || rawParams === null || Array.isArray(rawParams))
					throw new Error("Invalid Task memory parameters");
				const memory = (rawParams as { memory?: unknown }).memory;
				if (typeof memory !== "string" || memory.trim() === "")
					throw new Error("Task memory must be a non-empty string");
				const result = await updateTaskMemory(piRoot, goalId, taskId, { memory });
				return {
					content: [{ type: "text", text: `Updated durable memory for ${goalId}/${taskId}` }],
					details: result.task.path,
				};
			},
		});
		slot.session.setTaskSessionProtocol(
			[
				"This is a long-lived assigned Task Session.",
				"Task Markdown is the lifecycle SSOT and durable memory; chat history is working memory, not the only authority.",
				"Users may participate normally at any time. Settling does not complete or unassign the Task.",
				"First call task_gate with accept or reject. If accepted, the Task becomes ACTIVE.",
				'Before true quiescence, emit exactly one final stop envelope: <pi-executor-stop>{\\"reason\\":\\"completed|waiting_user|waiting_approval|blocked_external|terminated|continue_possible\\",\\"result\\":\\"...\\",\\"remaining\\":\\"...\\",\\"evidence\\":[\\"...\\"],\\"reasonDetail\\":\\"...\\"}</pi-executor-stop>.',
				"The runtime parses and validates the stop envelope at quiescence; ordinary prose is never used to guess lifecycle state.",
				"Executor lifecycle is determined only by the stop envelope validated by the runtime at quiescence; task_memory is optional durable memory.",
				"When durable information should survive compaction, restart, reassignment, or long pauses, decide whether to use task_memory; do not write transient reasoning or chat noise mechanically.",
			].join("\n"),
		);
		const payload = [
			"Begin work on the assigned Task below. Read the Task Markdown before acting.",
			"Task Markdown is the Task lifecycle authority and durable memory.",
			"Read the task file and work in this Session's cwd.",
			"Write important decisions, results, evidence, blockers, invariants, and next steps back to task.md.",
			"Settling this Session does not complete the Task until the runtime validates the final stop envelope.",
			"Continue this same Task and Session on later user messages or recovery.",
			"",
			`Goal: ${goalId}`,
			`Task: ${taskId}`,
			`Task file: ${task.path}`,
			`Status: ${task.status ?? "(unspecified)"}`,
			"",
			`Objective: ${task.objective ?? "(none)"}`,
			`Work area: ${task.workArea ?? "(unspecified)"}`,
			`Inputs: ${task.inputs ?? "(none)"}`,
			`Completion: ${task.completion ?? "(none)"}`,
			...(task.result === undefined ? [] : [`Current result: ${task.result}`]),
			...(task.remaining === undefined ? [] : [`Current remaining: ${task.remaining}`]),
		].join("\n");
		activateTaskTools = () => slot.session.setActiveToolsByName([...previousTools, "task_memory"]);
		if (options?.admitted) activateTaskTools();
		else slot.session.setActiveToolsByName(["task_gate"]);
		this.taskSessionBindings.set(assignment.sessionId, () => {
			admission.active = false;
			removeLifecycleListener();
			this.taskSessionAdmission.delete(assignment.sessionId);
			taskGate();
			removeMemoryTool();
		});
		if (!options?.admitted) await slot.session.prompt(payload, { expandPromptTemplates: false, source: "extension" });
	}

	private async rebindAssignedTask(session: AgentSession): Promise<void> {
		if (!getSessionRegistry()) return;
		const assignment = this.getSessionAssignment(session.sessionManager.getSessionId());
		if (!assignment) return;
		const task = readTask(this.associationRoot(), assignment.goalId, assignment.taskId);
		const status = parseTaskStatus(task.status);
		if (status === "ACTIVE" || status === "BLOCKED") {
			await this.startAssignedTask(assignment.goalId, assignment.taskId, { admitted: true });
		} else if (status === "READY" || status === "DEFERRED") {
			await this.startAssignedTask(assignment.goalId, assignment.taskId);
		}
	}

	setRebindSession(rebindSession?: (session: AgentSession) => Promise<void>): void {
		this.rebindSession = rebindSession;
	}

	/**
	 * Set a synchronous callback that runs after `session_shutdown` handlers finish
	 * but before the current session is invalidated.
	 *
	 * This is for host-owned UI teardown that must not yield to the event loop,
	 * such as detaching extension-provided TUI components before the old extension
	 * context becomes stale.
	 */
	setBeforeForegroundSwitch(beforeForegroundSwitch?: () => void): void {
		this.beforeForegroundSwitch = beforeForegroundSwitch;
	}

	setBeforeSessionInvalidate(beforeSessionInvalidate?: () => void): void {
		this.beforeSessionInvalidate = beforeSessionInvalidate;
	}

	private async emitBeforeSwitch(
		reason: "new" | "resume",
		targetSessionFile?: string,
	): Promise<{ cancelled: boolean }> {
		const runner = this.session.extensionRunner;
		if (!runner.hasHandlers("session_before_switch")) {
			return { cancelled: false };
		}

		const result = await runner.emit({
			type: "session_before_switch",
			reason,
			targetSessionFile,
		});
		return { cancelled: result?.cancel === true };
	}

	private async emitBeforeFork(
		entryId: string,
		options: { position: "before" | "at" },
	): Promise<{ cancelled: boolean }> {
		const runner = this.session.extensionRunner;
		if (!runner.hasHandlers("session_before_fork")) {
			return { cancelled: false };
		}

		const result = await runner.emit({
			type: "session_before_fork",
			entryId,
			...options,
		});
		return { cancelled: result?.cancel === true };
	}

	private async disposeSlot(
		slot: SessionSlot,
		reason: SessionShutdownEvent["reason"],
		targetSessionFile?: string,
		remove = true,
	): Promise<void> {
		// Settle any active response first so the aborted turn (including tool
		// results) is persisted to the outgoing session before it is replaced.
		this._sessionPool.suppressCompletion(slot.id);
		await slot.session.abort();
		this._sessionPool.deactivate(slot.id);
		const cleanupErrors: unknown[] = [];
		try {
			await emitSessionShutdownEvent(slot.session.extensionRunner, {
				type: "session_shutdown",
				reason,
				targetSessionFile,
			});
		} catch (error) {
			cleanupErrors.push(error);
		}
		try {
			if (slot.id === this._sessionPool.foregroundSlotId) this.beforeSessionInvalidate?.();
		} catch (error) {
			cleanupErrors.push(error);
		}
		try {
			slot.session.dispose();
		} catch (error) {
			cleanupErrors.push(error);
		}
		if (remove) {
			try {
				this._sessionPool.removeClosed(slot.id);
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
		if (cleanupErrors.length > 0)
			throw new AggregateError(
				cleanupErrors,
				`Session cleanup failed for ${slot.session.sessionManager.getSessionId()}`,
			);
	}

	async parkForeground(): Promise<void> {
		await this._sessionPool.getForeground().session.abort();
	}

	async switchForeground(slotId: string): Promise<void> {
		if (this._sessionPool.foregroundSlotId !== slotId) this.beforeForegroundSwitch?.();
		this._sessionPool.setForeground(slotId);
		await this.finishSessionReplacement();
	}

	private async teardownCurrent(reason: SessionShutdownEvent["reason"], targetSessionFile?: string): Promise<void> {
		this.replacementSlot = this._sessionPool.getForeground();
		await this.disposeSlot(this.replacementSlot, reason, targetSessionFile, false);
	}

	private apply(result: CreateAgentSessionRuntimeResult, setForeground = true): SessionSlot {
		const slot = this._sessionPool.adopt(result.session, result.services);
		if (setForeground) this._sessionPool.setForeground(slot.id);
		if (this.replacementSlot) {
			this._sessionPool.removeClosed(this.replacementSlot.id);
			this.replacementSlot = undefined;
		}
		this._diagnostics = result.diagnostics;
		this._modelFallbackMessage = result.modelFallbackMessage;
		return slot;
	}

	private async finishSessionReplacement(withSession?: (ctx: ReplacedSessionContext) => Promise<void>): Promise<void> {
		if (this.rebindSession) {
			await this.rebindSession(this.session);
		}
		// Host rebinds (for example RPC bindExtensions) may rebuild the active
		// tool set. Restore the durable Task binding last so lifecycle tools are
		// the final active set for the resumed Executor.
		await this.rebindAssignedTask(this.session);
		if (withSession) {
			await withSession(this.session.createReplacedSessionContext());
		}
	}

	async prepareSession(
		sessionPath: string,
		options?: {
			cwdOverride?: string;
			projectTrustContextFactory?: (cwd: string) => ProjectTrustContext;
		},
	): Promise<{ result: CreateAgentSessionRuntimeResult; sessionManager: SessionManager }> {
		const sessionManager = SessionManager.open(sessionPath, undefined, options?.cwdOverride);
		assertSessionCwdInsidePiRoot(sessionManager.getCwd(), `for resumed session ${sessionPath}`);
		assertSessionCwdExists(sessionManager, this.cwd);
		const result = await this.createRuntime({
			cwd: sessionManager.getCwd(),
			agentDir: this.services.agentDir,
			sessionManager,
			sessionStartEvent: { type: "session_start", reason: "resume", previousSessionFile: this.session.sessionFile },
			projectTrustContext: options?.projectTrustContextFactory?.(sessionManager.getCwd()),
		});
		return { result, sessionManager };
	}

	async resumePrepared(
		prepared: { result: CreateAgentSessionRuntimeResult; sessionManager: SessionManager },
		withSession?: (ctx: ReplacedSessionContext) => Promise<void>,
	): Promise<void> {
		const slot = this.apply(prepared.result, false);
		this.suppressExecutorSettlement.delete(slot.session.sessionManager.getSessionId());
		this._sessionPool.setForeground(slot.id);
		await this.finishSessionReplacement(withSession);
		if (withSession) await withSession(this.session.createReplacedSessionContext());
	}

	async switchSession(
		sessionPath: string,
		options?: {
			cwdOverride?: string;
			withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
			projectTrustContextFactory?: (cwd: string) => ProjectTrustContext;
		},
	): Promise<{ cancelled: boolean }> {
		const beforeResult = await this.emitBeforeSwitch("resume", sessionPath);
		if (beforeResult.cancelled) {
			return beforeResult;
		}

		const previousSessionFile = this.session.sessionFile;
		const sessionManager = SessionManager.open(sessionPath, undefined, options?.cwdOverride);
		assertSessionCwdInsidePiRoot(sessionManager.getCwd(), `for resumed session ${sessionPath}`);
		assertSessionCwdExists(sessionManager, this.cwd);
		await this.teardownCurrent("resume", sessionManager.getSessionFile());
		this.apply(
			await this.createRuntime({
				cwd: sessionManager.getCwd(),
				agentDir: this.services.agentDir,
				sessionManager,
				sessionStartEvent: { type: "session_start", reason: "resume", previousSessionFile },
				projectTrustContext: options?.projectTrustContextFactory?.(sessionManager.getCwd()),
			}),
		);
		await this.finishSessionReplacement(options?.withSession);
		return { cancelled: false };
	}

	async prepareNewSession(options?: {
		parentSession?: string;
		cwd?: string;
	}): Promise<{ result: CreateAgentSessionRuntimeResult; sessionManager: SessionManager }> {
		const targetCwd = options?.cwd ? resolvePath(options.cwd) : this.cwd;
		if (targetCwd === getPiRoot()) {
			throw new ControllerSessionAlreadyExistsError();
		}
		// Defense-in-depth: SessionManager.create also enforces this.
		assertCwdInsidePiRoot(targetCwd);
		const previousSessionFile = this.session.sessionFile;
		const piRoot = getPiRoot();
		const runtimeDir = piRoot ? getPiRootRuntimeDir(piRoot) : undefined;
		const sessionDir = runtimeDir ? join(runtimeDir, "sessions") : undefined;
		const sessionManager = SessionManager.create(targetCwd, sessionDir);
		if (options?.parentSession) sessionManager.newSession({ parentSession: options.parentSession });
		assertSessionCwdExists(sessionManager, this.cwd);
		const result = await this.createRuntime({
			cwd: targetCwd,
			agentDir: this.services.agentDir,
			sessionManager,
			sessionStartEvent: { type: "session_start", reason: "new", previousSessionFile },
		});
		return { result, sessionManager };
	}

	async newSession(options?: {
		parentSession?: string;
		cwd?: string;
		keepCurrent?: boolean;
		setup?: (sessionManager: SessionManager) => Promise<void>;
		withSession?: (ctx: ReplacedSessionContext) => Promise<void>;
	}): Promise<{ cancelled: boolean }> {
		// Warm new sessions stay live in the pool; replacement hooks such as
		// pi-mux must not intercept this path and swap in a separate process.
		if (!options?.keepCurrent) {
			const beforeResult = await this.emitBeforeSwitch("new");
			if (beforeResult.cancelled) {
				return beforeResult;
			}
		}

		const prepared = await this.prepareNewSession(options);
		if (options?.keepCurrent) {
			const slot = this.apply(prepared.result, false);
			await this.switchForeground(slot.id);
		} else {
			await this.teardownCurrent("new", prepared.sessionManager.getSessionFile());
			this.apply(prepared.result);
		}
		if (options?.setup) {
			await options.setup(this.session.sessionManager);
			this.session.agent.state.messages = this.session.sessionManager.buildSessionContext().messages;
		}
		if (options?.keepCurrent) {
			if (options.withSession) await options.withSession(this.session.createReplacedSessionContext());
		} else {
			await this.finishSessionReplacement(options?.withSession);
		}
		return { cancelled: false };
	}

	async fork(
		entryId: string,
		options?: { position?: "before" | "at"; withSession?: (ctx: ReplacedSessionContext) => Promise<void> },
	): Promise<{ cancelled: boolean; selectedText?: string }> {
		const position = options?.position ?? "before";
		const beforeResult = await this.emitBeforeFork(entryId, { position });
		if (beforeResult.cancelled) {
			return { cancelled: true };
		}
		let targetLeafId: string | null;
		let selectedText: string | undefined;

		const selectedEntry = this.session.sessionManager.getEntry(entryId);
		if (!selectedEntry) {
			throw new Error("Invalid entry ID for forking");
		}

		if (position === "at") {
			targetLeafId = selectedEntry.id;
		} else {
			if (selectedEntry.type !== "message" || selectedEntry.message.role !== "user") {
				throw new Error("Invalid entry ID for forking");
			}
			targetLeafId = selectedEntry.parentId;
			selectedText = extractUserMessageText(selectedEntry.message.content);
		}

		const previousSessionFile = this.session.sessionFile;
		if (this.session.sessionManager.isPersisted()) {
			if (this.sessionPool.getForeground().activity.busy)
				this.suppressExecutorSettlement.add(this.session.sessionManager.getSessionId());
			const currentSessionFile = this.session.sessionFile;
			if (!currentSessionFile) {
				throw new Error("Persisted session is missing a session file");
			}
			const sessionDir = this.session.sessionManager.getSessionDir();
			if (!targetLeafId) {
				const sessionManager = SessionManager.create(this.cwd, sessionDir);
				sessionManager.newSession({ parentSession: currentSessionFile });
				await this.teardownCurrent("fork", sessionManager.getSessionFile());
				this.apply(
					await this.createRuntime({
						cwd: this.cwd,
						agentDir: this.services.agentDir,
						sessionManager,
						sessionStartEvent: { type: "session_start", reason: "fork", previousSessionFile },
					}),
				);
				await this.finishSessionReplacement(options?.withSession);
				return { cancelled: false, selectedText };
			}

			if (!existsSync(currentSessionFile)) {
				throw new Error(
					"This session has not been saved yet. Wait for the first assistant response before cloning or forking it.",
				);
			}
			const sessionManager = SessionManager.open(currentSessionFile, sessionDir);
			const forkedSessionPath = sessionManager.createBranchedSession(targetLeafId);
			if (!forkedSessionPath) {
				throw new Error("Failed to create forked session");
			}
			await this.teardownCurrent("fork", sessionManager.getSessionFile());
			this.apply(
				await this.createRuntime({
					cwd: sessionManager.getCwd(),
					agentDir: this.services.agentDir,
					sessionManager,
					sessionStartEvent: { type: "session_start", reason: "fork", previousSessionFile },
				}),
			);
			await this.finishSessionReplacement(options?.withSession);
			return { cancelled: false, selectedText };
		}

		const sessionManager = this.session.sessionManager;
		await this.teardownCurrent("fork", sessionManager.getSessionFile());
		if (!targetLeafId) {
			sessionManager.newSession({ parentSession: previousSessionFile });
		} else {
			sessionManager.createBranchedSession(targetLeafId);
		}
		this.apply(
			await this.createRuntime({
				cwd: this.cwd,
				agentDir: this.services.agentDir,
				sessionManager,
				sessionStartEvent: { type: "session_start", reason: "fork", previousSessionFile },
			}),
		);
		await this.finishSessionReplacement(options?.withSession);
		return { cancelled: false, selectedText };
	}

	/**
	 * Import a session JSONL file and switch runtime state to the imported session.
	 *
	 * @returns `{ cancelled: true }` when cancelled by `session_before_switch`, otherwise `{ cancelled: false }`.
	 * @throws {SessionImportFileNotFoundError} When the input path does not exist.
	 * @throws {MissingSessionCwdError} When the imported session cwd cannot be resolved and no override is provided.
	 */
	async importFromJsonl(inputPath: string, cwdOverride?: string): Promise<{ cancelled: boolean }> {
		const resolvedPath = resolvePath(inputPath);
		if (!existsSync(resolvedPath)) {
			throw new SessionImportFileNotFoundError(resolvedPath);
		}

		const sessionDir = this.session.sessionManager.getSessionDir();
		if (!existsSync(sessionDir)) {
			mkdirSync(sessionDir, { recursive: true });
		}

		let destinationPath = join(sessionDir, basename(resolvedPath));
		const sourceAlreadyStored = resolve(destinationPath) === resolvedPath;
		if (!sourceAlreadyStored) {
			const { name, ext } = parse(destinationPath);
			let suffix = 1;
			while (existsSync(destinationPath)) {
				destinationPath = join(sessionDir, `${name}-${suffix++}${ext}`);
			}
		}
		const beforeResult = await this.emitBeforeSwitch("resume", destinationPath);
		if (beforeResult.cancelled) {
			return beforeResult;
		}

		const previousSessionFile = this.session.sessionFile;
		if (!sourceAlreadyStored) {
			copyFileSync(resolvedPath, destinationPath, constants.COPYFILE_EXCL);
		}

		const sessionManager = SessionManager.open(destinationPath, sessionDir, cwdOverride);
		assertSessionCwdInsidePiRoot(sessionManager.getCwd(), `for imported session ${destinationPath}`);
		assertSessionCwdExists(sessionManager, this.cwd);
		await this.teardownCurrent("resume", sessionManager.getSessionFile());
		this.apply(
			await this.createRuntime({
				cwd: sessionManager.getCwd(),
				agentDir: this.services.agentDir,
				sessionManager,
				sessionStartEvent: { type: "session_start", reason: "resume", previousSessionFile },
			}),
		);
		await this.finishSessionReplacement();
		return { cancelled: false };
	}

	listActiveSessions(): Array<{
		row?: import("./session-registry.ts").RegistryRow;
		slot: SessionSlot;
		task?: { goalId: string; taskId: string; status?: string };
	}> {
		const registry = getSessionRegistry();
		if (!registry) return this._sessionPool.list().map((slot) => ({ slot }));
		return registry.activeRows().map((row) => {
			const slot = this._sessionPool.findBySessionId(row.session_id);
			if (!slot) throw new Error(`Session registry active row has no live slot: ${row.session_id}`);
			const assignment = this.getSessionAssignment(row.session_id);
			return {
				row,
				slot,
				task: assignment
					? {
							goalId: assignment.goalId,
							taskId: assignment.taskId,
							status: readTask(this.associationRoot(), assignment.goalId, assignment.taskId).status,
						}
					: undefined,
			};
		});
	}

	listInactiveSessions() {
		const registry = getSessionRegistry();
		if (!registry) return [];
		return registry.inactiveRows().map((row) => {
			if (!row.session_file)
				throw new Error(`Session catalog entry is invalid: missing session file (${row.session_id})`);
			return row;
		});
	}

	assertSessionPoolRegistryConsistency(): void {
		const registry = getSessionRegistry();
		if (!registry) return;
		const active = registry.activeRows();
		for (const row of active) {
			if (!this._sessionPool.findBySessionId(row.session_id))
				throw new Error(`Session registry active row has no live slot: ${row.session_id}`);
		}
		for (const slot of this._sessionPool.list()) {
			const id = slot.session.sessionManager.getSessionId();
			if (!active.some((row) => row.session_id === id))
				throw new Error(`Live session slot has no active registry row: ${id}`);
		}
	}

	async abortSession(slotId: string): Promise<boolean> {
		const slot = this._sessionPool.get(slotId);
		if (!slot || !slot.activity.busy) return false;
		if (slot.session.sessionManager.getSessionId() === getSessionRegistry()?.canonicalControlSessionId())
			return false;
		this._sessionPool.suppressCompletion(slotId);
		await slot.session.abort();
		return true;
	}

	async closeSession(slotId: string, reason: SessionShutdownEvent["reason"] = "quit"): Promise<boolean> {
		const slot = this._sessionPool.get(slotId);
		if (!slot) return false;
		if (slot.session.sessionManager.getSessionId() === getSessionRegistry()?.canonicalControlSessionId())
			return false;
		if (slot.activity.busy) this.suppressExecutorSettlement.add(slot.session.sessionManager.getSessionId());
		if (this._sessionPool.list().length === 1) return false;
		const wasForeground = slot.id === this._sessionPool.foregroundSlotId;
		if (wasForeground) {
			const successor = this._sessionPool.list().find((candidate) => candidate.id !== slot.id);
			if (!successor) return false;
			await this.disposeSlot(slot, reason);
			this._sessionPool.setForeground(successor.id);
			await this.finishSessionReplacement();
			return true;
		}
		await this.disposeSlot(slot, reason);
		return true;
	}

	async closeSlot(slotId: string, reason: SessionShutdownEvent["reason"] = "quit"): Promise<void> {
		await this.closeSession(slotId, reason);
	}

	async dispose(): Promise<void> {
		for (const slot of this._sessionPool.list()) {
			await this.disposeSlot(slot, "quit");
		}
	}
}

/**
 * Create the initial runtime from a runtime factory and initial session target.
 *
 * The same factory is stored on the returned AgentSessionRuntime and reused for
 * later /new, /resume, /fork, and import flows.
 */
export async function createAgentSessionRuntime(
	createRuntime: CreateAgentSessionRuntimeFactory,
	options: {
		cwd: string;
		agentDir: string;
		sessionManager: SessionManager;
		sessionStartEvent?: SessionStartEvent;
	},
): Promise<AgentSessionRuntime> {
	assertSessionCwdExists(options.sessionManager, options.cwd);
	const result = await createRuntime(options);
	return new AgentSessionRuntime(
		result.session,
		result.services,
		createRuntime,
		result.diagnostics,
		result.modelFallbackMessage,
	);
}

export {
	type AgentSessionRuntimeDiagnostic,
	type AgentSessionServices,
	type CreateAgentSessionFromServicesOptions,
	type CreateAgentSessionServicesOptions,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "./agent-session-services.ts";
