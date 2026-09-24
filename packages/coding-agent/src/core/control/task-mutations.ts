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

function replaceField(
	content: string,
	field: "Status" | "Result" | "Remaining" | "Memory",
	value: string,
	addIfMissing = false,
): string {
	const lines = content.split(/(\r?\n)/);
	const matches: number[] = [];
	for (let index = 0; index < lines.length; index += 2) {
		if (new RegExp(`^${field}:\\s*`).test(lines[index] ?? "")) matches.push(index);
	}
	if (matches.length > 1 || (matches.length === 0 && !addIfMissing))
		throw new TaskMutationError(`Task must contain exactly one ${field}: field`);
	if (matches.length === 0) {
		const statusIndex = lines.findIndex((line, index) => index % 2 === 0 && /^Status:\s*/.test(line ?? ""));
		if (statusIndex < 0) throw new TaskMutationError("Task must contain exactly one Status: field");
		const newline = lines.some((line, index) => index % 2 === 1 && line === "\r\n") ? "\r\n" : "\n";
		return content.endsWith(newline)
			? `${content}${field}: ${value}${newline}`
			: `${content}${newline}${field}: ${value}`;
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
		if (current === target) return { changed: false, task };
		if (isTerminalTaskStatus(current)) throw new TaskMutationError(`Task is already terminal: ${goalId}/${taskId}`);
		let content = replaceField(task.content, "Status", target);
		if (options?.result !== undefined) content = replaceField(content, "Result", options.result);
		if (options?.remaining !== undefined) content = replaceField(content, "Remaining", options.remaining, true);
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
		const current = parseTaskStatus(task.status);
		if (current === undefined) throw new TaskMutationError(`Task has invalid Status: ${goalId}/${taskId}`);
		if (isTerminalTaskStatus(current)) throw new TaskMutationError(`Task is already terminal: ${goalId}/${taskId}`);
		let content = replaceField(task.content, "Status", options.status);
		if (options.result !== undefined) content = replaceField(content, "Result", options.result);
		if (options.remaining !== undefined) content = replaceField(content, "Remaining", options.remaining, true);
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
		const current = parseTaskStatus(task.status);
		if (current === undefined) throw new TaskMutationError(`Task has invalid Status: ${goalId}/${taskId}`);
		if (isTerminalTaskStatus(current)) throw new TaskMutationError(`Task is already terminal: ${goalId}/${taskId}`);
		const content =
			task.memory === undefined
				? `${task.content.trimEnd()}\n\nMemory: ${options.memory}\n`
				: replaceField(task.content, "Memory", options.memory);
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
