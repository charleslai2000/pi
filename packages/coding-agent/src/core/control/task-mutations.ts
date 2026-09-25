import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { readTask, type TaskRecord } from "./read-model.ts";
import { withTaskMutationLock } from "./task-lock.ts";
import { isTerminalTaskStatus, parseTaskStatus, type TaskStatus } from "./task-status.ts";

export class TaskMutationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TaskMutationError";
	}
}

export interface CompleteTaskOptions {
	readonly result?: string;
	readonly remaining?: string;
}

export interface UpdateTaskMemoryOptions {
	readonly memory: string;
}

export interface UpdateTaskStatusOptions {
	readonly status: Extract<TaskStatus, "READY" | "ACTIVE" | "BLOCKED" | "DEFERRED">;
	readonly result?: string;
	readonly remaining?: string;
}

export interface TaskMutationResult {
	readonly changed: boolean;
	readonly task: TaskRecord;
}

export function validateTaskRemainingField(content: string, allowMissing = false): void {
	const matches = content.split(/\r?\n/).filter((line) => /^Remaining:\s*/.test(line));
	if (matches.length > 1 || (matches.length === 0 && !allowMissing))
		throw new TaskMutationError("Task must contain exactly one Remaining: field");
}

export type TaskField =
	| "Status"
	| "Result"
	| "Remaining"
	| "Memory"
	| "Objective"
	| "Constraints"
	| "Inputs"
	| "Completion";

export function replaceTaskField(
	content: string,
	field: TaskField,
	value: string,
	addRemainingIfMissing = false,
): string {
	if (
		value
			.split(/\r?\n/)
			.some((line) => /^(?:Status|Result|Remaining|Memory|Objective|Constraints|Inputs|Completion):\s*/.test(line))
	)
		throw new TaskMutationError("Task field values must not inject canonical Task fields");
	const lines = content.split(/(\r?\n)/);
	const matches: number[] = [];
	for (let index = 0; index < lines.length; index += 2) {
		if (new RegExp(`^${field}:\\s*`).test(lines[index] ?? "")) matches.push(index);
	}
	if (matches.length > 1 || (matches.length === 0 && !(field === "Remaining" && addRemainingIfMissing)))
		throw new TaskMutationError(`Task must contain exactly one ${field}: field`);
	if (matches.length === 0) {
		const newline = lines.some((line, index) => index % 2 === 1 && line === "\r\n") ? "\r\n" : "\n";
		return content.endsWith(newline)
			? `${content}Remaining: ${value}${newline}`
			: `${content}${newline}Remaining: ${value}`;
	}
	const index = matches[0]!;
	const line = lines[index]!;
	const newline = line.includes("\r") ? "\r\n" : "\n";
	lines[index] = `${field}: ${value}`;
	if (index + 1 < lines.length && lines[index + 1] === "") lines[index + 1] = newline;
	return lines.join("");
}

function writeTask(path: string, content: string): void {
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	try {
		const fd = openSync(temporary, "wx");
		try {
			writeFileSync(fd, content, "utf8");
			fsyncSync(fd);
		} finally {
			closeSync(fd);
		}
		renameSync(temporary, path);
	} catch (error) {
		try {
			unlinkSync(temporary);
		} catch {
			/* preserve original error */
		}
		throw new TaskMutationError(`Cannot atomically write Task: ${String(error)}`);
	}
}

function mutateTerminal(
	piRoot: string,
	goalId: string,
	taskId: string,
	target: Extract<TaskStatus, "DONE" | "CANCELLED">,
	options?: CompleteTaskOptions,
): Promise<TaskMutationResult> {
	return withTaskMutationLock(`${piRoot}\u0000${goalId}\u0000${taskId}`, () => {
		const task = readTask(piRoot, goalId, taskId);
		const current = parseTaskStatus(task.status);
		if (current === undefined) throw new TaskMutationError(`Task has invalid Status: ${goalId}/${taskId}`);
		if (current === target) {
			validateTaskRemainingField(task.content);
			return { changed: false, task };
		}
		if (isTerminalTaskStatus(current)) throw new TaskMutationError(`Task is already terminal: ${goalId}/${taskId}`);
		validateTaskRemainingField(task.content, options?.remaining !== undefined);
		let content = replaceTaskField(task.content, "Status", target);
		if (options?.result !== undefined) content = replaceTaskField(content, "Result", options.result);
		if (options?.remaining !== undefined) content = replaceTaskField(content, "Remaining", options.remaining, true);
		writeTask(task.path, content);
		return { changed: true, task: readTask(piRoot, goalId, taskId) };
	});
}

export function updateTaskStatus(
	piRoot: string,
	goalId: string,
	taskId: string,
	options: UpdateTaskStatusOptions,
): Promise<TaskMutationResult> {
	return withTaskMutationLock(`${piRoot}\u0000${goalId}\u0000${taskId}`, () => {
		const task = readTask(piRoot, goalId, taskId);
		validateTaskRemainingField(task.content, options.remaining !== undefined);
		const current = parseTaskStatus(task.status);
		if (current === undefined) throw new TaskMutationError(`Task has invalid Status: ${goalId}/${taskId}`);
		if (isTerminalTaskStatus(current)) throw new TaskMutationError(`Task is already terminal: ${goalId}/${taskId}`);
		let content = replaceTaskField(task.content, "Status", options.status);
		if (options.result !== undefined) content = replaceTaskField(content, "Result", options.result);
		if (options.remaining !== undefined) content = replaceTaskField(content, "Remaining", options.remaining, true);
		writeTask(task.path, content);
		return { changed: true, task: readTask(piRoot, goalId, taskId) };
	});
}

export function updateTaskMemory(
	piRoot: string,
	goalId: string,
	taskId: string,
	options: UpdateTaskMemoryOptions,
): Promise<TaskMutationResult> {
	return withTaskMutationLock(`${piRoot}\u0000${goalId}\u0000${taskId}`, () => {
		const task = readTask(piRoot, goalId, taskId);
		validateTaskRemainingField(task.content);
		const current = parseTaskStatus(task.status);
		if (current === undefined) throw new TaskMutationError(`Task has invalid Status: ${goalId}/${taskId}`);
		if (isTerminalTaskStatus(current)) throw new TaskMutationError(`Task is already terminal: ${goalId}/${taskId}`);
		if (
			options.memory
				.split(/\r?\n/)
				.some((line) =>
					/^(?:Status|Result|Remaining|Memory|Objective|Constraints|Inputs|Completion):\s*/.test(line),
				)
		)
			throw new TaskMutationError("Task field values must not inject canonical Task fields");
		if (
			options.memory
				.split(/\r?\n/)
				.some((line) =>
					/^(?:Status|Result|Remaining|Memory|Objective|Constraints|Inputs|Completion):\s*/.test(line),
				)
		)
			throw new TaskMutationError("Task field values must not inject canonical Task fields");
		const content =
			task.memory === undefined
				? `${task.content.trimEnd()}\n\nMemory: ${options.memory}\n`
				: replaceTaskField(task.content, "Memory", options.memory);
		writeTask(task.path, content);
		return { changed: true, task: readTask(piRoot, goalId, taskId) };
	});
}

export function completeTask(
	piRoot: string,
	goalId: string,
	taskId: string,
	options?: CompleteTaskOptions,
): Promise<TaskMutationResult> {
	return mutateTerminal(piRoot, goalId, taskId, "DONE", options);
}

export function cancelTask(piRoot: string, goalId: string, taskId: string): Promise<TaskMutationResult> {
	return mutateTerminal(piRoot, goalId, taskId, "CANCELLED");
}
