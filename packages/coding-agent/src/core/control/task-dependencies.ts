import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { readTask, type TaskRecord } from "./read-model.ts";
import { withTaskMutationLock } from "./task-lock.ts";
import { validateTaskRemainingField } from "./task-mutations.ts";
import { isTerminalTaskStatus, parseTaskStatus } from "./task-status.ts";

export interface TaskIdentity {
	readonly goalId: string;
	readonly taskId: string;
}

function key(identity: TaskIdentity): string {
	return `${identity.goalId}\u0000${identity.taskId}`;
}

function atomicWrite(path: string, content: string): void {
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
		throw new Error(`Cannot atomically write Task dependencies: ${String(error)}`);
	}
}

function replacePrerequisites(content: string, prerequisites: readonly TaskIdentity[]): string {
	validateTaskRemainingField(content);
	const lines = content.split(/(\r?\n)/);
	const index = lines.findIndex((line, i) => i % 2 === 0 && line.startsWith("Prerequisites:"));
	const value = prerequisites.map((item) => `${item.goalId}/${item.taskId}`).join(", ");
	if (index >= 0) {
		lines[index] = `Prerequisites: ${value}`;
		return lines.join("");
	}
	return `${content.trimEnd()}\nPrerequisites: ${value}\n`;
}

function hasPath(piRoot: string, from: TaskIdentity, target: string, visiting: Set<string>): boolean {
	if (key(from) === target) return true;
	if (visiting.has(key(from))) return false;
	visiting.add(key(from));
	const task = readTask(piRoot, from.goalId, from.taskId);
	return task.prerequisites.some((dependency) => hasPath(piRoot, dependency, target, visiting));
}

export function setTaskDependencies(
	piRoot: string,
	goalId: string,
	taskId: string,
	prerequisites: readonly TaskIdentity[],
	isTenured: (sessionGoalId: string, sessionTaskId: string) => boolean,
): Promise<TaskRecord> {
	return withTaskMutationLock(`${piRoot}\u0000${goalId}\u0000${taskId}`, () => {
		const task = readTask(piRoot, goalId, taskId);
		const status = parseTaskStatus(task.status);
		if (!status) throw new Error(`Task has invalid Status: ${goalId}/${taskId}`);
		if (isTerminalTaskStatus(status)) throw new Error(`Task is terminal: ${goalId}/${taskId}`);
		validateTaskRemainingField(task.content);
		if ((status === "ACTIVE" || status === "BLOCKED") && isTenured(goalId, taskId))
			throw new Error(`Task has an active Executor tenure: ${goalId}/${taskId}`);
		const unique = new Set<string>();
		for (const prerequisite of prerequisites) {
			if (key(prerequisite) === key({ goalId, taskId })) throw new Error("Task cannot depend on itself");
			if (unique.has(key(prerequisite))) throw new Error(`Duplicate prerequisite: ${key(prerequisite)}`);
			unique.add(key(prerequisite));
			readTask(piRoot, prerequisite.goalId, prerequisite.taskId);
			if (hasPath(piRoot, prerequisite, key({ goalId, taskId }), new Set()))
				throw new Error("Task dependency cycle detected");
		}
		atomicWrite(task.path, replacePrerequisites(task.content, prerequisites));
		return readTask(piRoot, goalId, taskId);
	});
}

export function dependencySatisfied(piRoot: string, task: TaskRecord): boolean {
	return task.prerequisites.every(
		(prerequisite) => readTask(piRoot, prerequisite.goalId, prerequisite.taskId).status === "DONE",
	);
}

export function listDerivedFrontier(
	piRoot: string,
	tasks: readonly TaskRecord[],
	assigned: (task: TaskRecord) => boolean,
): TaskRecord[] {
	return tasks.filter(
		(task) =>
			(task.status === "READY" || task.status === "DEFERRED") &&
			!assigned(task) &&
			dependencySatisfied(piRoot, task),
	);
}
