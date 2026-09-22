import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getPiRoot } from "../pi-root.ts";
import { SessionManager } from "../session-manager.ts";
import { readGoal, readTask, resolveControlDirectory } from "./read-model.ts";

export interface CurrentAssignment {
	readonly goalId: string;
	readonly taskId: string;
	readonly sessionId: string;
	readonly assignedAt: string;
}

export type AssociationEventType = "assigned" | "unassigned";

export interface AssociationEvent {
	readonly goalId: string;
	readonly taskId: string;
	readonly sessionId: string;
	readonly type: AssociationEventType;
	readonly at: string;
}

export interface AssociationRecord {
	readonly path: string;
	readonly exists: boolean;
	readonly version: 1;
	readonly current: readonly CurrentAssignment[];
	readonly history: readonly AssociationEvent[];
}

export interface AssociationData {
	readonly version: 1;
	readonly current: readonly CurrentAssignment[];
	readonly history: readonly AssociationEvent[];
}

export class AssociationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AssociationError";
	}
}

export class AssociationConflictError extends AssociationError {
	constructor(message: string) {
		super(message);
		this.name = "AssociationConflictError";
	}
}

export class AssociationConcurrentModificationError extends AssociationError {
	constructor(path: string) {
		super(`Association file changed during mutation: ${path}`);
		this.name = "AssociationConcurrentModificationError";
	}
}

export interface AssociationMutationResult {
	readonly changed: boolean;
	readonly record: AssociationRecord;
}

type AssociationMutationTestHooks = {
	beforeCommit?: () => void;
	failRename?: boolean;
};

let associationNow = (): string => new Date().toISOString();
let mutationHooks: AssociationMutationTestHooks = {};
const mutationQueues = new Map<string, Promise<unknown>>();

export function setAssociationClockForTesting(clock: (() => string) | undefined): void {
	associationNow = clock ?? (() => new Date().toISOString());
}

export function setAssociationMutationHooksForTesting(hooks: AssociationMutationTestHooks): void {
	mutationHooks = { ...hooks };
}

export function withAssociationMutationLock<T>(piRoot: string, operation: () => T | Promise<T>): Promise<T> {
	return enqueueMutation(associationPath(piRoot), operation);
}

function enqueueMutation<T>(path: string, operation: () => T | Promise<T>): Promise<T> {
	const previous = mutationQueues.get(path) ?? Promise.resolve();
	const next = previous.catch(() => undefined).then(operation);
	mutationQueues.set(path, next);
	void next
		.finally(() => {
			if (mutationQueues.get(path) === next) mutationQueues.delete(path);
		})
		.catch(() => undefined);
	return next;
}

function associationPath(piRoot: string): string {
	try {
		return join(resolveControlDirectory(piRoot), "assignments.json");
	} catch (error) {
		throw new AssociationError(`Invalid control directory: ${String(error)}`);
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
	const expected = new Set(keys);
	for (const key of Object.keys(value))
		if (!expected.has(key)) throw new AssociationError(`Unknown ${label} field: ${key}`);
	for (const key of keys) if (!(key in value)) throw new AssociationError(`Missing ${label} field: ${key}`);
}

function stringField(value: Record<string, unknown>, key: string, label: string): string {
	if (typeof value[key] !== "string" || value[key] === "") throw new AssociationError(`Invalid ${label}.${key}`);
	return value[key];
}

function timestampField(value: Record<string, unknown>, key: string, label: string): string {
	const timestamp = stringField(value, key, label);
	if (Number.isNaN(Date.parse(timestamp))) throw new AssociationError(`Invalid timestamp ${label}.${key}`);
	return timestamp;
}

function parseCurrent(value: unknown, index: number): CurrentAssignment {
	if (!isRecord(value)) throw new AssociationError(`Invalid current assignment at index ${index}`);
	exactKeys(value, ["goalId", "taskId", "sessionId", "assignedAt"], `current[${index}]`);
	return {
		goalId: stringField(value, "goalId", `current[${index}]`),
		taskId: stringField(value, "taskId", `current[${index}]`),
		sessionId: stringField(value, "sessionId", `current[${index}]`),
		assignedAt: timestampField(value, "assignedAt", `current[${index}]`),
	};
}

function parseEvent(value: unknown, index: number): AssociationEvent {
	if (!isRecord(value)) throw new AssociationError(`Invalid history event at index ${index}`);
	exactKeys(value, ["goalId", "taskId", "sessionId", "type", "at"], `history[${index}]`);
	const type = stringField(value, "type", `history[${index}]`);
	if (type !== "assigned" && type !== "unassigned") throw new AssociationError(`Invalid event type: ${type}`);
	return {
		goalId: stringField(value, "goalId", `history[${index}]`),
		taskId: stringField(value, "taskId", `history[${index}]`),
		sessionId: stringField(value, "sessionId", `history[${index}]`),
		type,
		at: timestampField(value, "at", `history[${index}]`),
	};
}

function validateData(piRoot: string, data: AssociationData): AssociationData {
	if (data.version !== 1) throw new AssociationError(`Unknown association schema version: ${String(data.version)}`);
	const taskKeys = new Set<string>();
	const sessionKeys = new Set<string>();
	for (const assignment of data.current) {
		const taskKey = `${assignment.goalId}\u0000${assignment.taskId}`;
		if (taskKeys.has(taskKey))
			throw new AssociationError(`Duplicate current Task: ${assignment.goalId}/${assignment.taskId}`);
		if (sessionKeys.has(assignment.sessionId))
			throw new AssociationError(`Duplicate current Session: ${assignment.sessionId}`);
		taskKeys.add(taskKey);
		sessionKeys.add(assignment.sessionId);
		validateReference(piRoot, assignment.goalId, assignment.taskId, assignment.sessionId);
		if (
			!data.history.some(
				(event) =>
					event.goalId === assignment.goalId &&
					event.taskId === assignment.taskId &&
					event.sessionId === assignment.sessionId &&
					event.type === "assigned",
			)
		)
			throw new AssociationError(
				`Current assignment has no history assigned event: ${assignment.goalId}/${assignment.taskId}`,
			);
	}
	for (const event of data.history) validateReference(piRoot, event.goalId, event.taskId, event.sessionId);
	return data;
}

function validateReference(piRoot: string, goalId: string, taskId: string, sessionId: string): void {
	try {
		readGoal(piRoot, goalId);
		readTask(piRoot, goalId, taskId);
		if (!SessionManager.findById(piRoot, sessionId)) throw new Error(`durable Session not found: ${sessionId}`);
	} catch (error) {
		throw new AssociationError(`Invalid association reference ${goalId}/${taskId}/${sessionId}: ${String(error)}`);
	}
}

function parseData(piRoot: string, value: unknown): AssociationData {
	if (!isRecord(value)) throw new AssociationError("Association document must be an object");
	exactKeys(value, ["version", "current", "history"], "top-level");
	if (value.version !== 1) throw new AssociationError(`Unknown association schema version: ${String(value.version)}`);
	if (!Array.isArray(value.current) || !Array.isArray(value.history))
		throw new AssociationError("current and history must be arrays");
	const data: AssociationData = {
		version: 1,
		current: value.current.map(parseCurrent),
		history: value.history.map(parseEvent),
	};
	return validateData(piRoot, data);
}

export function validateAssociations(piRoot: string, data: AssociationData): AssociationData {
	return validateData(piRoot, data);
}

export function readAssociations(piRoot: string = getPiRoot() ?? ""): AssociationRecord {
	if (!piRoot) throw new AssociationError("PiRoot is not set");
	const path = associationPath(piRoot);
	if (!existsSync(path)) return { path, exists: false, version: 1, current: [], history: [] };
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(path, "utf8")) as unknown;
	} catch (error) {
		throw new AssociationError(`Cannot parse assignments.json: ${String(error)}`);
	}
	const data = parseData(piRoot, value);
	return { path, exists: true, ...data };
}

export function writeAssociations(piRoot: string, data: AssociationData | AssociationRecord): AssociationRecord {
	if (!piRoot) throw new AssociationError("PiRoot is not set");
	const path = associationPath(piRoot);
	const input: AssociationData = { version: 1, current: data.current, history: data.history };
	const validated = validateData(piRoot, input);
	return replaceAssociations(piRoot, path, validated, undefined, false);
}

function rawFile(path: string): Buffer | undefined {
	return existsSync(path) ? readFileSync(path) : undefined;
}

function sameBytes(left: Buffer | undefined, right: Buffer | undefined): boolean {
	return left === undefined ? right === undefined : right !== undefined && left.equals(right);
}

function replaceAssociations(
	piRoot: string,
	path: string,
	data: AssociationData,
	expected: Buffer | undefined,
	checkExpected: boolean,
): AssociationRecord {
	const current = rawFile(path);
	if (checkExpected && !sameBytes(expected, current)) throw new AssociationConcurrentModificationError(path);
	const content = `${JSON.stringify(data, null, 2)}\n`;
	const temporary = join(resolveControlDirectory(piRoot), `.assignments.json.${process.pid}.${Date.now()}.tmp`);
	try {
		writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
		if (mutationHooks.failRename) throw new Error("Injected association rename failure");
		renameSync(temporary, path);
	} catch (error) {
		try {
			unlinkSync(temporary);
		} catch {
			// Preserve the write error.
		}
		throw new AssociationError(`Cannot atomically write assignments.json: ${String(error)}`);
	}
	return { path, exists: true, ...data };
}

function mutationBase(piRoot: string): { path: string; record: AssociationRecord; bytes: Buffer | undefined } {
	const record = readAssociations(piRoot);
	return { path: record.path, record, bytes: rawFile(record.path) };
}

function currentForTask(record: AssociationRecord, goalId: string, taskId: string): CurrentAssignment | undefined {
	return record.current.find((assignment) => assignment.goalId === goalId && assignment.taskId === taskId);
}

function validateMutationIdentity(piRoot: string, goalId: string, taskId: string, sessionId?: string): void {
	readGoal(piRoot, goalId);
	readTask(piRoot, goalId, taskId);
	if (sessionId !== undefined && !SessionManager.findById(piRoot, sessionId))
		throw new AssociationError(`Durable Session not found: ${sessionId}`);
}

function commitMutation(
	piRoot: string,
	base: { path: string; record: AssociationRecord; bytes: Buffer | undefined },
	data: AssociationData,
): AssociationRecord {
	validateData(piRoot, data);
	mutationHooks.beforeCommit?.();
	return replaceAssociations(piRoot, base.path, data, base.bytes, true);
}

export function assignTaskToSession(
	piRoot: string,
	goalId: string,
	taskId: string,
	sessionId: string,
): Promise<AssociationMutationResult> {
	const path = associationPath(piRoot);
	return enqueueMutation(path, () => {
		validateMutationIdentity(piRoot, goalId, taskId, sessionId);
		const base = mutationBase(piRoot);
		const existing = currentForTask(base.record, goalId, taskId);
		if (existing?.sessionId === sessionId) return { changed: false, record: base.record };
		if (existing) throw new AssociationConflictError(`Task is already assigned: ${goalId}/${taskId}`);
		const occupied = base.record.current.find((assignment) => assignment.sessionId === sessionId);
		if (occupied) throw new AssociationConflictError(`Session is already assigned: ${sessionId}`);
		const at = associationNow();
		return {
			changed: true,
			record: commitMutation(piRoot, base, {
				version: 1,
				current: [...base.record.current, { goalId, taskId, sessionId, assignedAt: at }],
				history: [...base.record.history, { goalId, taskId, sessionId, type: "assigned", at }],
			}),
		};
	});
}

export function unassignTask(piRoot: string, goalId: string, taskId: string): Promise<AssociationMutationResult> {
	const path = associationPath(piRoot);
	return enqueueMutation(path, () => {
		validateMutationIdentity(piRoot, goalId, taskId);
		const base = mutationBase(piRoot);
		const existing = currentForTask(base.record, goalId, taskId);
		if (!existing) return { changed: false, record: base.record };
		const at = associationNow();
		return {
			changed: true,
			record: commitMutation(piRoot, base, {
				version: 1,
				current: base.record.current.filter((assignment) => assignment !== existing),
				history: [
					...base.record.history,
					{ goalId, taskId, sessionId: existing.sessionId, type: "unassigned", at },
				],
			}),
		};
	});
}

export function reassignTaskToSession(
	piRoot: string,
	goalId: string,
	taskId: string,
	newSessionId: string,
): Promise<AssociationMutationResult> {
	const path = associationPath(piRoot);
	return enqueueMutation(path, () => {
		validateMutationIdentity(piRoot, goalId, taskId, newSessionId);
		const base = mutationBase(piRoot);
		const existing = currentForTask(base.record, goalId, taskId);
		if (!existing) throw new AssociationError(`Task is not currently assigned: ${goalId}/${taskId}`);
		if (existing.sessionId === newSessionId) return { changed: false, record: base.record };
		const occupied = base.record.current.find((assignment) => assignment.sessionId === newSessionId);
		if (occupied) throw new AssociationConflictError(`Session is already assigned: ${newSessionId}`);
		const at = associationNow();
		return {
			changed: true,
			record: commitMutation(piRoot, base, {
				version: 1,
				current: [
					...base.record.current.filter((assignment) => assignment !== existing),
					{ goalId, taskId, sessionId: newSessionId, assignedAt: at },
				],
				history: [
					...base.record.history,
					{ goalId, taskId, sessionId: existing.sessionId, type: "unassigned", at },
					{ goalId, taskId, sessionId: newSessionId, type: "assigned", at },
				],
			}),
		};
	});
}

export function getTaskAssignment(
	record: AssociationRecord,
	goalId: string,
	taskId: string,
): CurrentAssignment | undefined {
	return record.current.find((assignment) => assignment.goalId === goalId && assignment.taskId === taskId);
}

export function getSessionAssignment(record: AssociationRecord, sessionId: string): CurrentAssignment | undefined {
	return record.current.find((assignment) => assignment.sessionId === sessionId);
}

export function listTaskAssociationHistory(
	record: AssociationRecord,
	goalId: string,
	taskId: string,
): AssociationEvent[] {
	return record.history.filter((event) => event.goalId === goalId && event.taskId === taskId);
}
