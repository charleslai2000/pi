import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { getPiRoot, getPiRootRuntimeDir, isPathInsidePiRoot } from "../pi-root.ts";

export interface GoalRecord {
	readonly goalId: string;
	readonly directory: string;
	readonly goalFile: string;
	readonly planFile?: string;
	readonly title?: string;
	readonly status?: string;
	readonly memory?: string;
	readonly coordinationMemory?: string;
	readonly content: string;
}

export interface TaskRecord {
	readonly goalId: string;
	readonly taskId: string;
	readonly slug: string;
	readonly path: string;
	readonly status?: string;
	readonly workArea?: string;
	readonly objective?: string;
	readonly constraints?: string;
	readonly prerequisites: readonly { goalId: string; taskId: string }[];
	readonly inputs?: string;
	readonly completion?: string;
	readonly result?: string;
	readonly remaining?: string;
	readonly memory?: string;
	readonly content: string;
}

export class ControlReadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ControlReadError";
	}
}

export class DuplicateTaskIdentityError extends ControlReadError {
	constructor(goalId: string, taskId: string, paths: readonly string[]) {
		super(`Duplicate task identity ${goalId}/${taskId}: ${paths.join(", ")}`);
		this.name = "DuplicateTaskIdentityError";
	}
}

function canonical(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

function controlDirectory(piRoot: string): string {
	const root = canonical(piRoot);
	const resolved = getPiRootRuntimeDir(root);
	if (!resolved || !existsSync(resolved))
		throw new ControlReadError(`PiRoot authority directory is unavailable: ${root}`);
	if (!statSync(resolved).isDirectory())
		throw new ControlReadError(`PiRoot authority directory is not a directory: ${root}`);
	return canonical(resolved);
}

function assertControlPath(path: string, controlDir: string): string {
	const result = canonical(path);
	if (
		!isPathInsidePiRoot(result, dirname(controlDir)) ||
		(relative(controlDir, result) !== "" && relative(controlDir, result).startsWith(".."))
	) {
		throw new ControlReadError(`Control path escapes control directory: ${path}`);
	}
	return result;
}

function readText(path: string): string {
	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		throw new ControlReadError(`Cannot read control document ${path}: ${String(error)}`);
	}
}

function section(content: string, name: string): string | undefined {
	const lines = content.split(/\r?\n/);
	const start = lines.findIndex((line) => new RegExp(`^(?:${name}:|##\\s+${name})\\s*`).test(line));
	if (start < 0) return undefined;
	const first = lines[start]!.replace(new RegExp(`^(?:${name}:|##\\s+${name})\\s*`), "").trim();
	const body: string[] = first ? [first] : [];
	for (let index = start + 1; index < lines.length; index++) {
		if (/^(?:#{1,6}\s+|[A-Z][A-Za-z ]*:\s*)/.test(lines[index]!)) break;
		body.push(lines[index]!);
	}
	const result = body.join("\n").trim();
	return result || undefined;
}

function title(content: string): string | undefined {
	return (
		content
			.split(/\r?\n/)
			.find((line) => /^#\s+/.test(line))
			?.replace(/^#\s+/, "")
			.trim() || undefined
	);
}

function parseGoal(goalId: string, directory: string): GoalRecord {
	const goalFile = assertControlPath(join(directory, "goal.md"), dirname(directory));
	if (!existsSync(goalFile) || !statSync(goalFile).isFile())
		throw new ControlReadError(`Goal directory has no goal.md: ${goalId}`);
	const content = readText(goalFile);
	const plan = join(directory, "plan.md");
	return {
		goalId,
		directory,
		goalFile,
		planFile: existsSync(plan) && statSync(plan).isFile() ? assertControlPath(plan, dirname(directory)) : undefined,
		title: title(content),
		status: section(content, "Status"),
		memory: section(content, "Memory"),
		coordinationMemory: section(content, "Coordination memory"),
		content,
	};
}

function parsePrerequisites(value: string | undefined): readonly { goalId: string; taskId: string }[] {
	if (!value) return [];
	return value.split(",").map((item) => {
		const match = /^([^/]+)\/(T\d+)$/.exec(item.trim());
		if (!match) throw new ControlReadError(`Invalid prerequisite identity: ${item}`);
		return { goalId: match[1]!, taskId: match[2]! };
	});
}

function parseTask(goalId: string, path: string): TaskRecord {
	const match = /^((?:T)\d+)-([^/]+)\.md$/.exec(basename(path));
	if (!match) throw new ControlReadError(`Invalid task filename: ${path}`);
	const content = readText(path);
	return {
		goalId,
		taskId: match[1]!,
		slug: match[2]!,
		path,
		status: section(content, "Status"),
		workArea: section(content, "Work area"),
		objective: section(content, "Objective"),
		constraints: section(content, "Constraints"),
		prerequisites: parsePrerequisites(section(content, "Prerequisites")),
		inputs: section(content, "Inputs"),
		completion: section(content, "Completion"),
		result: section(content, "Result"),
		remaining: section(content, "Remaining"),
		memory: section(content, "Memory"),
		content,
	};
}

export function resolveControlDirectory(piRoot: string = getPiRoot() ?? ""): string {
	if (!piRoot) throw new ControlReadError("PiRoot is not set");
	return controlDirectory(piRoot);
}

export function listGoals(piRoot: string = getPiRoot() ?? ""): GoalRecord[] {
	const controlDir = resolveControlDirectory(piRoot);
	return readdirSync(controlDir, { withFileTypes: true })
		.filter((entry) => {
			const candidate = join(controlDir, entry.name);
			if (!(entry.isDirectory() || entry.isSymbolicLink()) || !existsSync(join(candidate, "goal.md"))) return false;
			return true;
		})
		.map((entry) => parseGoal(entry.name, assertControlPath(join(controlDir, entry.name), controlDir)))
		.sort((a, b) => a.goalId.localeCompare(b.goalId));
}

export function readGoal(piRoot: string, goalId: string): GoalRecord {
	const controlDir = resolveControlDirectory(piRoot);
	if (goalId.includes("/") || goalId.includes("\\") || goalId === "." || goalId === "..")
		throw new ControlReadError(`Invalid goal id: ${goalId}`);
	const directory = assertControlPath(join(controlDir, goalId), controlDir);
	return parseGoal(goalId, directory);
}

export function listTasks(piRoot: string, goalId: string): TaskRecord[] {
	const goal = readGoal(piRoot, goalId);
	const controlDir = resolveControlDirectory(piRoot);
	const files = readdirSync(goal.directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && /^T\d+-[^/]+\.md$/.test(entry.name))
		.map((entry) => assertControlPath(join(goal.directory, entry.name), controlDir));
	const byId = new Map<string, string[]>();
	for (const path of files) {
		const id = /^((?:T)\d+)-/.exec(basename(path))![1]!;
		byId.set(id, [...(byId.get(id) ?? []), path]);
	}
	for (const [id, paths] of byId) if (paths.length > 1) throw new DuplicateTaskIdentityError(goalId, id, paths);
	return files.map((path) => parseTask(goalId, path)).sort((a, b) => a.taskId.localeCompare(b.taskId));
}

export function readTask(piRoot: string, goalId: string, taskId: string): TaskRecord {
	const tasks = listTasks(piRoot, goalId);
	const task = tasks.find((candidate) => candidate.taskId === taskId);
	if (!task) throw new ControlReadError(`Task not found: ${goalId}/${taskId}`);
	return task;
}
