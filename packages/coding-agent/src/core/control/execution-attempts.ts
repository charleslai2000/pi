import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getPiRoot } from "../pi-root.ts";
import { SessionManager } from "../session-manager.ts";
import { readGoal, readTask, resolveControlDirectory } from "./read-model.ts";

export type ExecutionKind = "normal" | "escalation" | "review";

export interface AttemptStartedEvent {
	readonly version: 1 | 2;
	readonly type: "started";
	readonly attemptId: string;
	readonly goalId: string;
	readonly taskId: string;
	readonly sessionId: string;
	readonly at: string;
	readonly taskContentSha256: string;
	readonly executionSno?: number;
	readonly executionNo?: string;
	readonly kind?: ExecutionKind;
}

export interface AttemptResultReportedEvent {
	readonly version: 2;
	readonly type: "result_reported";
	readonly attemptId: string;
	readonly goalId: string;
	readonly taskId: string;
	readonly sessionId: string;
	readonly executionSno: number;
	readonly executionNo: string;
	readonly kind: ExecutionKind;
	readonly taskContentSha256: string;
	readonly disposition: "complete" | "incomplete";
	readonly summary?: string;
	readonly at: string;
}

export interface ExecutionUsageEvidence {
	readonly input: number;
	readonly output: number;
	readonly reasoning?: number;
	readonly cacheRead: number;
	readonly cacheWrite: number;
	readonly totalTokens: number;
	readonly budgetTokens: number;
	readonly usageKnown: boolean;
}

export interface ExecutionBudgetEvidence {
	readonly limit?: number;
	readonly used: number;
	readonly exhausted: boolean;
	readonly overshoot: number;
	readonly stopReason?: "budget_exhausted";
}

export interface AttemptTerminalEvent {
	readonly version: 1 | 2 | 3;
	readonly type: "settled" | "failed" | "aborted";
	readonly attemptId: string;
	readonly goalId: string;
	readonly taskId: string;
	readonly sessionId: string;
	readonly at: string;
	readonly detail?: string;
	readonly executionSno?: number;
	readonly executionNo?: string;
	readonly kind?: ExecutionKind;
	readonly usage?: ExecutionUsageEvidence;
	readonly budget?: ExecutionBudgetEvidence;
}

export type ExecutionAttemptEvent = AttemptStartedEvent | AttemptResultReportedEvent | AttemptTerminalEvent;

export interface ExecutionAttemptRecord {
	readonly attemptId: string;
	readonly goalId: string;
	readonly taskId: string;
	readonly sessionId: string;
	readonly taskContentSha256: string;
	readonly startedAt: string;
	readonly executionSno?: number;
	readonly executionNo?: string;
	readonly kind?: ExecutionKind;
	readonly completion?: "complete" | "incomplete";
	readonly completionSummary?: string;
	readonly completionReportedAt?: string;
	readonly settledAt?: string;
	readonly outcome?: "settled" | "failed" | "aborted";
	readonly detail?: string;
	readonly usage?: ExecutionUsageEvidence;
	readonly budget?: ExecutionBudgetEvidence;
}

export interface ExecutionAttemptsRecord {
	readonly path: string;
	readonly exists: boolean;
	readonly attempts: readonly ExecutionAttemptRecord[];
}

export interface RecordAttemptStartedInput {
	readonly goalId: string;
	readonly taskId: string;
	readonly sessionId: string;
	readonly attemptId?: string;
	readonly kind?: ExecutionKind;
	readonly at?: string;
}

export interface RecordAttemptTerminalInput {
	readonly attemptId: string;
	readonly type: "settled" | "failed" | "aborted";
	readonly at?: string;
	readonly detail?: string;
	readonly usage?: ExecutionUsageEvidence;
	readonly budget?: ExecutionBudgetEvidence;
}

export interface RecordAttemptResultInput {
	readonly attemptId: string;
	readonly disposition: "complete" | "incomplete";
	readonly summary?: string;
	readonly at?: string;
}

export class ExecutionAttemptError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ExecutionAttemptError";
	}
}

const appendQueues = new Map<string, Promise<unknown>>();
let mutationHooks: { failStarted?: boolean; failTerminal?: boolean } = {};
let idProvider = (): string => randomUUID();
let clock = (): string => new Date().toISOString();

export function setExecutionAttemptIdForTesting(provider: (() => string) | undefined): void {
	idProvider = provider ?? (() => randomUUID());
}

export function setExecutionAttemptClockForTesting(provider: (() => string) | undefined): void {
	clock = provider ?? (() => new Date().toISOString());
}

export function setExecutionAttemptMutationHooksForTesting(hooks: {
	failStarted?: boolean;
	failTerminal?: boolean;
}): void {
	mutationHooks = { ...hooks };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
	const allowed = new Set(keys);
	for (const key of Object.keys(value))
		if (!allowed.has(key)) throw new ExecutionAttemptError(`Unknown ${label} field: ${key}`);
	for (const key of keys) if (!(key in value)) throw new ExecutionAttemptError(`Missing ${label} field: ${key}`);
}

function stringField(value: Record<string, unknown>, key: string, label: string): string {
	if (typeof value[key] !== "string" || value[key] === "") throw new ExecutionAttemptError(`Invalid ${label}.${key}`);
	return value[key];
}

function timestampField(value: Record<string, unknown>, key: string, label: string): string {
	const timestamp = stringField(value, key, label);
	if (Number.isNaN(Date.parse(timestamp))) throw new ExecutionAttemptError(`Invalid timestamp ${label}.${key}`);
	return timestamp;
}

function executionFields(
	value: Record<string, unknown>,
	version: 1 | 2,
	index: number,
): Pick<AttemptStartedEvent, "executionSno" | "executionNo" | "kind"> {
	if (version === 1) return {};
	if (typeof value.executionSno !== "number" || !Number.isInteger(value.executionSno) || value.executionSno < 1)
		throw new ExecutionAttemptError(`Invalid executionSno at line ${index}`);
	const executionNo = stringField(value, "executionNo", `event ${index}`);
	const kind = value.kind;
	if (kind !== "normal" && kind !== "escalation" && kind !== "review")
		throw new ExecutionAttemptError(`Invalid execution kind at line ${index}`);
	return { executionSno: value.executionSno, executionNo, kind };
}

function startedEvent(value: unknown, index: number): AttemptStartedEvent {
	if (!isRecord(value)) throw new ExecutionAttemptError(`Invalid started event at line ${index}`);
	const version = value.version === 1 || value.version === 2 ? value.version : undefined;
	if (!version || value.type !== "started") throw new ExecutionAttemptError(`Invalid started event at line ${index}`);
	const keys = ["version", "type", "attemptId", "goalId", "taskId", "sessionId", "at", "taskContentSha256"];
	if (version === 2) keys.push("executionSno", "executionNo", "kind");
	exactKeys(value, keys, `event ${index}`);
	const hash = stringField(value, "taskContentSha256", `event ${index}`);
	if (!/^[a-f0-9]{64}$/.test(hash)) throw new ExecutionAttemptError(`Invalid taskContentSha256 at line ${index}`);
	return {
		version,
		type: "started",
		attemptId: stringField(value, "attemptId", `event ${index}`),
		goalId: stringField(value, "goalId", `event ${index}`),
		taskId: stringField(value, "taskId", `event ${index}`),
		sessionId: stringField(value, "sessionId", `event ${index}`),
		at: timestampField(value, "at", `event ${index}`),
		taskContentSha256: hash,
		...executionFields(value, version, index),
	};
}

function terminalEvent(value: unknown, index: number): AttemptTerminalEvent {
	if (!isRecord(value)) throw new ExecutionAttemptError(`Invalid terminal event at line ${index}`);
	const version = value.version === 1 || value.version === 2 || value.version === 3 ? value.version : undefined;
	const keys = ["version", "type", "attemptId", "goalId", "taskId", "sessionId", "at"];
	if (version === 2 || version === 3) keys.push("executionSno", "executionNo", "kind");
	if (version === 3) {
		if ("usage" in value) keys.push("usage");
		if ("budget" in value) keys.push("budget");
	}
	if ("detail" in value) keys.push("detail");
	exactKeys(value, keys, `event ${index}`);
	if (!version || (value.type !== "settled" && value.type !== "failed" && value.type !== "aborted"))
		throw new ExecutionAttemptError(`Invalid terminal event at line ${index}`);
	if ("detail" in value && typeof value.detail !== "string")
		throw new ExecutionAttemptError(`Invalid event ${index}.detail`);
	return {
		version,
		type: value.type,
		attemptId: stringField(value, "attemptId", `event ${index}`),
		goalId: stringField(value, "goalId", `event ${index}`),
		taskId: stringField(value, "taskId", `event ${index}`),
		sessionId: stringField(value, "sessionId", `event ${index}`),
		at: timestampField(value, "at", `event ${index}`),
		detail: value.detail as string | undefined,
		...executionFields(value, version === 3 ? 2 : version, index),
		usage: value.usage as ExecutionUsageEvidence | undefined,
		budget: value.budget as ExecutionBudgetEvidence | undefined,
	};
}

function resultReportedEvent(value: unknown, index: number): AttemptResultReportedEvent {
	if (!isRecord(value)) throw new ExecutionAttemptError(`Invalid result_reported event at line ${index}`);
	exactKeys(
		value,
		[
			"version",
			"type",
			"attemptId",
			"goalId",
			"taskId",
			"sessionId",
			"executionSno",
			"executionNo",
			"kind",
			"taskContentSha256",
			"disposition",
			"at",
			...("summary" in value ? ["summary"] : []),
		],
		`event ${index}`,
	);
	if (value.version !== 2 || value.type !== "result_reported")
		throw new ExecutionAttemptError(`Invalid result_reported event at line ${index}`);
	const execution = executionFields(value, 2, index);
	const disposition = value.disposition;
	if (disposition !== "complete" && disposition !== "incomplete")
		throw new ExecutionAttemptError(`Invalid disposition at line ${index}`);
	const summary = value.summary;
	if (summary !== undefined && typeof summary !== "string")
		throw new ExecutionAttemptError(`Invalid summary at line ${index}`);
	const hash = stringField(value, "taskContentSha256", `event ${index}`);
	if (!/^[a-f0-9]{64}$/.test(hash)) throw new ExecutionAttemptError(`Invalid taskContentSha256 at line ${index}`);
	return {
		version: 2,
		type: "result_reported",
		attemptId: stringField(value, "attemptId", `event ${index}`),
		goalId: stringField(value, "goalId", `event ${index}`),
		taskId: stringField(value, "taskId", `event ${index}`),
		sessionId: stringField(value, "sessionId", `event ${index}`),
		executionSno: execution.executionSno!,
		executionNo: execution.executionNo!,
		kind: execution.kind!,
		taskContentSha256: hash,
		disposition,
		...(summary === undefined ? {} : { summary }),
		at: timestampField(value, "at", `event ${index}`),
	};
}

function parseEvent(value: unknown, index: number): ExecutionAttemptEvent {
	if (!isRecord(value) || typeof value.type !== "string")
		throw new ExecutionAttemptError(`Invalid event at line ${index}`);
	if (value.type === "started") return startedEvent(value, index);
	if (value.type === "result_reported") return resultReportedEvent(value, index);
	if (value.type === "settled" || value.type === "failed" || value.type === "aborted")
		return terminalEvent(value, index);
	throw new ExecutionAttemptError(`Unknown event type at line ${index}: ${String(value.type)}`);
}

function attemptPath(piRoot: string): string {
	try {
		return join(resolveControlDirectory(piRoot), "execution-attempts.jsonl");
	} catch (error) {
		throw new ExecutionAttemptError(`Invalid control directory: ${String(error)}`);
	}
}

function validateReference(piRoot: string, event: { goalId: string; taskId: string; sessionId: string }): void {
	try {
		readGoal(piRoot, event.goalId);
		readTask(piRoot, event.goalId, event.taskId);
		if (!SessionManager.findById(piRoot, event.sessionId))
			throw new Error(`durable Session not found: ${event.sessionId}`);
	} catch (error) {
		throw new ExecutionAttemptError(
			`Invalid attempt reference ${event.goalId}/${event.taskId}/${event.sessionId}: ${String(error)}`,
		);
	}
}

function derive(piRoot: string, events: readonly ExecutionAttemptEvent[]): ExecutionAttemptRecord[] {
	const attempts = new Map<string, ExecutionAttemptRecord>();
	for (const [index, event] of events.entries()) {
		validateReference(piRoot, event);
		if (event.type === "started") {
			if (attempts.has(event.attemptId))
				throw new ExecutionAttemptError(`Duplicate started attempt: ${event.attemptId}`);
			attempts.set(event.attemptId, {
				attemptId: event.attemptId,
				goalId: event.goalId,
				taskId: event.taskId,
				sessionId: event.sessionId,
				taskContentSha256: event.taskContentSha256,
				startedAt: event.at,
				executionSno: event.executionSno,
				executionNo: event.executionNo,
				kind: event.kind,
			});
			continue;
		}
		if (event.type === "result_reported") {
			const current = attempts.get(event.attemptId);
			if (!current) throw new ExecutionAttemptError(`Result event without started event: ${event.attemptId}`);
			if (current.completion !== undefined)
				throw new ExecutionAttemptError(`Duplicate result report: ${event.attemptId}`);
			if (
				current.goalId !== event.goalId ||
				current.taskId !== event.taskId ||
				current.sessionId !== event.sessionId ||
				current.executionSno !== event.executionSno ||
				current.executionNo !== event.executionNo ||
				current.taskContentSha256 !== event.taskContentSha256
			)
				throw new ExecutionAttemptError(`Result identity mismatch: ${event.attemptId}`);
			attempts.set(event.attemptId, {
				...current,
				completion: event.disposition,
				completionSummary: event.summary,
				completionReportedAt: event.at,
			});
			continue;
		}
		const current = attempts.get(event.attemptId);
		if (!current) throw new ExecutionAttemptError(`Terminal event without started event: ${event.attemptId}`);
		if (current.outcome) throw new ExecutionAttemptError(`Duplicate terminal event: ${event.attemptId}`);
		if (current.goalId !== event.goalId || current.taskId !== event.taskId || current.sessionId !== event.sessionId)
			throw new ExecutionAttemptError(`Attempt identity mismatch: ${event.attemptId}`);
		if (
			current.executionSno !== event.executionSno ||
			current.executionNo !== event.executionNo ||
			current.kind !== event.kind
		)
			throw new ExecutionAttemptError(`Attempt execution identity mismatch: ${event.attemptId}`);
		if (Date.parse(event.at) < Date.parse(current.startedAt))
			throw new ExecutionAttemptError(`Terminal event precedes started event: ${event.attemptId}`);
		attempts.set(event.attemptId, {
			...current,
			settledAt: event.at,
			outcome: event.type,
			detail: event.detail,
			usage: event.usage,
			budget: event.budget,
		});
		void index;
	}
	return [...attempts.values()];
}

function readEvents(_piRoot: string, path: string): ExecutionAttemptEvent[] {
	if (!existsSync(path)) return [];
	const content = readFileSync(path, "utf8");
	if (content === "") return [];
	const hasCompleteFinalLine = content.endsWith("\n");
	const lines = content.split("\n");
	if (hasCompleteFinalLine) lines.pop();
	else lines.pop();
	return lines
		.filter((line) => line !== "")
		.flatMap((line, index) => {
			try {
				return [parseEvent(JSON.parse(line) as unknown, index + 1)];
			} catch (error) {
				if (index === lines.length - 1 && !hasCompleteFinalLine) return [];
				throw error;
			}
		});
}

function enqueue<T>(path: string, operation: () => T): Promise<T> {
	const previous = appendQueues.get(path) ?? Promise.resolve();
	const next = previous.catch(() => undefined).then(operation);
	appendQueues.set(path, next);
	void next
		.finally(() => {
			if (appendQueues.get(path) === next) appendQueues.delete(path);
		})
		.catch(() => undefined);
	return next;
}

export function taskContentSha256(content: string): string {
	return createHash("sha256").update(content, "utf8").digest("hex");
}

export function readExecutionAttempts(piRoot: string = getPiRoot() ?? ""): ExecutionAttemptsRecord {
	if (!piRoot) throw new ExecutionAttemptError("PiRoot is not set");
	const path = attemptPath(piRoot);
	return { path, exists: existsSync(path), attempts: derive(piRoot, readEvents(piRoot, path)) };
}

export function recordAttemptStarted(
	piRoot: string,
	input: RecordAttemptStartedInput,
): Promise<ExecutionAttemptRecord> {
	if (!piRoot) return Promise.reject(new ExecutionAttemptError("PiRoot is not set"));
	const task = readTask(piRoot, input.goalId, input.taskId);
	validateReference(piRoot, input);
	return enqueue(attemptPath(piRoot), () => {
		const history = readExecutionAttempts(piRoot).attempts.filter(
			(attempt) => attempt.goalId === input.goalId && attempt.taskId === input.taskId,
		);
		if (history.some((attempt) => attempt.outcome === undefined))
			throw new ExecutionAttemptError(`Task has an unresolved open execution: ${input.goalId}/${input.taskId}`);
		const executionSno = history.reduce((max, attempt) => Math.max(max, attempt.executionSno ?? 0), 0) + 1;
		const event: AttemptStartedEvent = {
			version: 2,
			type: "started",
			attemptId: input.attemptId ?? idProvider(),
			goalId: input.goalId,
			taskId: input.taskId,
			executionSno,
			executionNo: `${input.taskId}-${String(executionSno).padStart(4, "0")}`,
			kind: input.kind ?? "normal",
			sessionId: input.sessionId,
			at: input.at ?? clock(),
			taskContentSha256: taskContentSha256(task.content),
		};
		if (mutationHooks.failStarted) throw new ExecutionAttemptError("Injected started append failure");
		const fd = openSync(attemptPath(piRoot), "a");
		try {
			writeFileSync(fd, `${JSON.stringify(event)}\n`, "utf8");
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		return {
			attemptId: event.attemptId,
			goalId: event.goalId,
			taskId: event.taskId,
			sessionId: event.sessionId,
			taskContentSha256: event.taskContentSha256,
			startedAt: event.at,
			executionSno,
			executionNo: event.executionNo,
			kind: event.kind,
		};
	});
}

export function recordAttemptResult(piRoot: string, input: RecordAttemptResultInput): Promise<ExecutionAttemptRecord> {
	if (!piRoot) return Promise.reject(new ExecutionAttemptError("PiRoot is not set"));
	return enqueue(attemptPath(piRoot), () => {
		const record = readExecutionAttempts(piRoot);
		const current = record.attempts.find((attempt) => attempt.attemptId === input.attemptId);
		if (!current) throw new ExecutionAttemptError(`Attempt not found: ${input.attemptId}`);
		if (current.outcome) throw new ExecutionAttemptError(`Attempt already terminal: ${input.attemptId}`);
		if (current.completion !== undefined)
			throw new ExecutionAttemptError(`Task result already reported: ${input.attemptId}`);
		if (current.executionSno === undefined || current.executionNo === undefined || current.kind === undefined)
			throw new ExecutionAttemptError(`Attempt does not support result reporting: ${input.attemptId}`);
		const event: AttemptResultReportedEvent = {
			version: 2,
			type: "result_reported",
			attemptId: current.attemptId,
			goalId: current.goalId,
			taskId: current.taskId,
			sessionId: current.sessionId,
			executionSno: current.executionSno,
			executionNo: current.executionNo,
			kind: current.kind,
			taskContentSha256: current.taskContentSha256,
			disposition: input.disposition,
			...(input.summary === undefined ? {} : { summary: input.summary }),
			at: input.at ?? clock(),
		};
		const fd = openSync(attemptPath(piRoot), "a");
		try {
			writeFileSync(fd, `${JSON.stringify(event)}\n`, "utf8");
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		return {
			...current,
			completion: event.disposition,
			completionSummary: event.summary,
			completionReportedAt: event.at,
		};
	});
}

export function recordAttemptTerminal(
	piRoot: string,
	input: RecordAttemptTerminalInput,
): Promise<ExecutionAttemptRecord> {
	if (!piRoot) return Promise.reject(new ExecutionAttemptError("PiRoot is not set"));
	return enqueue(attemptPath(piRoot), () => {
		const record = readExecutionAttempts(piRoot);
		const current = record.attempts.find((attempt) => attempt.attemptId === input.attemptId);
		if (!current) throw new ExecutionAttemptError(`Attempt not found: ${input.attemptId}`);
		if (current.outcome) throw new ExecutionAttemptError(`Attempt already terminal: ${input.attemptId}`);
		if (mutationHooks.failTerminal) throw new ExecutionAttemptError("Injected terminal append failure");
		const event: AttemptTerminalEvent = {
			version:
				current.executionSno === undefined ? 1 : input.usage !== undefined || input.budget !== undefined ? 3 : 2,
			type: input.type,
			attemptId: current.attemptId,
			goalId: current.goalId,
			taskId: current.taskId,
			sessionId: current.sessionId,
			at: input.at ?? clock(),
			detail: input.detail,
			...(current.executionSno === undefined
				? {}
				: {
						executionSno: current.executionSno,
						executionNo: current.executionNo,
						kind: current.kind,
						usage: input.usage,
						budget: input.budget,
					}),
		};
		const fd = openSync(attemptPath(piRoot), "a");
		try {
			writeFileSync(fd, `${JSON.stringify(event)}\n`, "utf8");
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		return {
			...current,
			settledAt: event.at,
			outcome: event.type,
			detail: event.detail,
			usage: event.usage,
			budget: event.budget,
		};
	});
}

export function getExecutionAttempt(
	record: ExecutionAttemptsRecord,
	attemptId: string,
): ExecutionAttemptRecord | undefined {
	return record.attempts.find((attempt) => attempt.attemptId === attemptId);
}

export function listTaskAttempts(
	record: ExecutionAttemptsRecord,
	goalId: string,
	taskId: string,
): ExecutionAttemptRecord[] {
	return record.attempts.filter((attempt) => attempt.goalId === goalId && attempt.taskId === taskId);
}
