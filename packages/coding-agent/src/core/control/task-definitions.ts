import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { listTasks, readGoal, readTask, resolveControlDirectory, type TaskRecord } from "./read-model.ts";
import { withTaskMutationLock } from "./task-lock.ts";
import { isTerminalTaskStatus, parseTaskStatus } from "./task-status.ts";

export interface GoalDefinitionInput {
	readonly title?: string;
	readonly status?: string;
	readonly memory?: string;
}

export interface GoalDefinitionPatch {
	readonly title?: string;
	readonly status?: string;
	readonly memory?: string;
}

export interface TaskDefinitionInput {
	readonly objective: string;
	readonly constraints?: string;
	readonly inputs?: string;
	readonly completion: string;
}

export type TaskDefinitionPatch = Partial<TaskDefinitionInput>;

export function createGoal(piRoot: string, goalId: string, definition: GoalDefinitionInput = {}): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(goalId)) throw new Error("Invalid Goal identity");
	const directory = join(resolveControlDirectory(piRoot), goalId);
	if (existsSync(directory)) throw new Error(`Goal already exists: ${goalId}`);
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, "goal.md"),
		[
			`# ${definition.title ?? goalId}`,
			`Status: ${definition.status ?? "READY"}`,
			`Memory: ${definition.memory ?? ""}`,
			"",
		].join("\n"),
	);
	return join(directory, "goal.md");
}

export function updateGoalMemory(piRoot: string, goalId: string, memory: string): string {
	const goal = readGoal(piRoot, goalId);
	const content = replaceManagedField(goal.content, "Memory", validateText(memory, "Goal memory", true)!);
	atomicWrite(goal.goalFile, content);
	return goal.goalFile;
}

export function updatePlanMemory(piRoot: string, goalId: string, memory: string): string {
	const goal = readGoal(piRoot, goalId);
	const planPath = goal.planFile ?? join(goal.directory, "plan.md");
	const current = goal.planFile ? readFileSync(planPath, "utf8") : "# Plan\n";
	const content = replaceManagedField(current, "Coordination memory", validateText(memory, "Plan memory", true)!);
	atomicWrite(planPath, content);
	return planPath;
}

export function reviseGoal(piRoot: string, goalId: string, patch: GoalDefinitionPatch): string {
	const goal = readGoal(piRoot, goalId);
	let content = goal.content;
	if (patch.title !== undefined) content = content.replace(/^# .*$/m, `# ${patch.title}`);
	if (patch.status !== undefined) content = content.replace(/^Status:.*$/m, `Status: ${patch.status}`);
	if (patch.memory !== undefined)
		content = replaceManagedField(content, "Memory", validateText(patch.memory, "Goal memory", true)!);
	atomicWrite(goal.goalFile, content);
	return goal.goalFile;
}

function replaceManagedField(content: string, name: "Memory" | "Coordination memory", value: string): string {
	const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const matches = [...content.matchAll(new RegExp(`^${escapedName}:`, "gm"))];
	if (matches.length === 0) return `${content.trimEnd()}\n\n${name}: ${value}\n`;
	if (matches.length > 1) throw new Error(`Document must contain at most one ${name}: field`);
	const start = matches[0]!.index!;
	const end = content.indexOf("\n", start);
	return `${content.slice(0, start)}${name}: ${value}${end < 0 ? "\n" : content.slice(end)}`;
}

function field(content: string, name: string, value: string): string {
	const lines = content.split(/(\r?\n)/);
	const index = lines.findIndex((line, i) => i % 2 === 0 && line.startsWith(`${name}:`));
	if (index < 0) throw new Error(`Task must contain ${name}: field`);
	lines[index] = `${name}: ${value}`;
	return lines.join("");
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
		throw new Error(`Cannot atomically write Task definition: ${String(error)}`);
	}
}

function validateText(value: unknown, name: string, required = false): string | undefined {
	if (value === undefined && !required) return undefined;
	if (typeof value !== "string" || (required && value.trim() === "")) throw new Error(`Invalid Task ${name}`);
	return value;
}

export function createTask(
	piRoot: string,
	goalId: string,
	taskId: string,
	slug: string,
	definition: TaskDefinitionInput,
): TaskRecord {
	readGoal(piRoot, goalId);
	if (!/^T\d+$/.test(taskId) || !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(slug)) throw new Error("Invalid Task identity");
	if (listTasks(piRoot, goalId).some((task) => task.taskId === taskId))
		throw new Error(`Task already exists: ${goalId}/${taskId}`);
	const objective = validateText(definition.objective, "objective", true)!;
	const completion = validateText(definition.completion, "completion", true)!;
	const constraints = validateText(definition.constraints, "constraints");
	const inputs = validateText(definition.inputs, "inputs");
	const directory = readTaskDirectory(piRoot, goalId);
	const path = join(directory, `${taskId}-${slug}.md`);
	const content = [
		`Status: READY`,
		`Objective: ${objective}`,
		`Constraints: ${constraints ?? ""}`,
		`Inputs: ${inputs ?? ""}`,
		`Completion: ${completion}`,
		`Result:`,
		`Remaining:`,
		"",
	].join("\n");
	try {
		writeFileSync(path, content, { encoding: "utf8", flag: "wx" });
	} catch (error) {
		throw new Error(`Cannot create Task ${goalId}/${taskId}: ${String(error)}`);
	}
	return readTask(piRoot, goalId, taskId);
}

function readTaskDirectory(piRoot: string, goalId: string): string {
	return readGoal(piRoot, goalId).directory;
}

export function reviseTask(
	piRoot: string,
	goalId: string,
	taskId: string,
	patch: TaskDefinitionPatch,
): Promise<TaskRecord> {
	return withTaskMutationLock(`${piRoot}\u0000${goalId}\u0000${taskId}`, () => {
		const task = readTask(piRoot, goalId, taskId);
		const status = parseTaskStatus(task.status);
		if (!status) throw new Error(`Task has invalid Status: ${goalId}/${taskId}`);
		if (isTerminalTaskStatus(status)) throw new Error(`Task is terminal: ${goalId}/${taskId}`);
		let content = task.content;
		for (const [name, value] of Object.entries(patch)) {
			if (!["objective", "constraints", "inputs", "completion"].includes(name))
				throw new Error(`Invalid Task definition field: ${name}`);
			if (value === undefined) continue;
			const checked = validateText(value, name, name === "objective" || name === "completion");
			if (checked !== undefined) content = field(content, name[0]!.toUpperCase() + name.slice(1), checked);
		}
		atomicWrite(task.path, content);
		return readTask(piRoot, goalId, taskId);
	});
}
