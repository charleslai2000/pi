import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getPiRoot } from "../pi-root.ts";
import { readGoal, readTask, resolveControlDirectory } from "./read-model.ts";

export interface FrontierEntry {
	readonly goalId: string;
	readonly taskId?: string;
	readonly state: "active" | "deferred";
	readonly blocker?: string;
	readonly next?: string;
}

export interface FrontierRecord {
	readonly path: string;
	readonly exists: boolean;
	readonly entries: readonly FrontierEntry[];
}

export class FrontierError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FrontierError";
	}
}

function frontierPath(piRoot: string): string {
	try {
		return join(resolveControlDirectory(piRoot), "frontier.md");
	} catch (error) {
		throw new FrontierError(`Invalid control directory: ${String(error)}`);
	}
}

function field(line: string): { name: string; value: string } | undefined {
	const match = /^(Task|State|Blocker|Next):(?:\s*)(.*)$/.exec(line);
	return match ? { name: match[1]!, value: match[2]!.trim() } : undefined;
}

function validateEntry(piRoot: string, entry: FrontierEntry): FrontierEntry {
	try {
		readGoal(piRoot, entry.goalId);
		if (entry.taskId !== undefined) readTask(piRoot, entry.goalId, entry.taskId);
	} catch (error) {
		throw new FrontierError(
			`Invalid frontier reference ${entry.goalId}${entry.taskId ? `/${entry.taskId}` : ""}: ${String(error)}`,
		);
	}
	return entry;
}

export function validateFrontier(piRoot: string, entries: readonly FrontierEntry[]): FrontierEntry[] {
	const seenGoals = new Set<string>();
	return entries.map((entry) => {
		if (seenGoals.has(entry.goalId)) throw new FrontierError(`Duplicate frontier Goal entry: ${entry.goalId}`);
		seenGoals.add(entry.goalId);
		if (!entry.goalId) throw new FrontierError("Missing frontier Goal");
		if (entry.state !== "active" && entry.state !== "deferred")
			throw new FrontierError(`Invalid frontier State for ${entry.goalId}: ${entry.state}`);
		if (entry.taskId === "") throw new FrontierError(`Missing frontier Task for ${entry.goalId}`);
		return validateEntry(piRoot, entry);
	});
}

export function parseFrontier(piRoot: string, content: string): FrontierEntry[] {
	const lines = content.split(/\r?\n/);
	if (lines[0] !== "# Frontier") throw new FrontierError("Missing or invalid # Frontier heading");
	const entries: FrontierEntry[] = [];
	let current: { goalId: string; fields: Map<string, string> } | undefined;
	const finish = (): void => {
		if (!current) return;
		const { goalId, fields } = current;
		const state = fields.get("State");
		if (!state) throw new FrontierError(`Missing State for frontier Goal ${goalId}`);
		if (state !== "active" && state !== "deferred") throw new FrontierError(`Invalid State for ${goalId}: ${state}`);
		entries.push({
			goalId,
			taskId: fields.has("Task") ? fields.get("Task") : undefined,
			state,
			blocker: fields.has("Blocker") ? fields.get("Blocker") : undefined,
			next: fields.has("Next") ? fields.get("Next") : undefined,
		});
	};
	for (let index = 1; index < lines.length; index++) {
		const line = lines[index]!;
		if (line.trim() === "") continue;
		const heading = /^##\s+(.*)$/.exec(line);
		if (heading) {
			finish();
			const goalId = heading[1]!.trim();
			if (!goalId) throw new FrontierError("Missing frontier Goal");
			current = { goalId, fields: new Map() };
			continue;
		}
		if (!current) throw new FrontierError(`Unexpected content outside frontier Goal: ${line}`);
		const parsed = field(line);
		if (!parsed) throw new FrontierError(`Unknown frontier field: ${line}`);
		if (current.fields.has(parsed.name))
			throw new FrontierError(`Duplicate ${parsed.name} field for ${current.goalId}`);
		if ((parsed.name === "Task" || parsed.name === "State") && !parsed.value)
			throw new FrontierError(`Missing ${parsed.name} for ${current.goalId}`);
		current.fields.set(parsed.name, parsed.value);
	}
	finish();
	return validateFrontier(piRoot, entries);
}

export function serializeFrontier(piRoot: string, entries: readonly FrontierEntry[]): string {
	const validated = validateFrontier(piRoot, entries);
	const sections = validated.map((entry) => {
		const lines = [`## ${entry.goalId}`];
		if (entry.taskId !== undefined) lines.push(`Task: ${entry.taskId}`);
		lines.push(`State: ${entry.state}`);
		if (entry.blocker !== undefined) lines.push(`Blocker: ${entry.blocker}`);
		if (entry.next !== undefined) lines.push(`Next: ${entry.next}`);
		return lines.join("\n");
	});
	return `# Frontier\n\n${sections.join("\n\n")}\n`;
}

export function readFrontier(piRoot: string = getPiRoot() ?? ""): FrontierRecord {
	if (!piRoot) throw new FrontierError("PiRoot is not set");
	const path = frontierPath(piRoot);
	if (!existsSync(path)) return { path, exists: false, entries: [] };
	let content: string;
	try {
		content = readFileSync(path, "utf8");
	} catch (error) {
		throw new FrontierError(`Cannot read frontier: ${String(error)}`);
	}
	return { path, exists: true, entries: parseFrontier(piRoot, content) };
}

export function writeFrontier(piRoot: string, entries: readonly FrontierEntry[]): FrontierRecord {
	if (!piRoot) throw new FrontierError("PiRoot is not set");
	const path = frontierPath(piRoot);
	const content = serializeFrontier(piRoot, entries);
	const temporary = join(resolveControlDirectory(piRoot), `.frontier.md.${process.pid}.${Date.now()}.tmp`);
	try {
		writeFileSync(temporary, content, { encoding: "utf8", flag: "wx" });
		renameSync(temporary, path);
	} catch (error) {
		try {
			unlinkSync(temporary);
		} catch {
			// Preserve the original error and leave any pre-existing frontier intact.
		}
		throw new FrontierError(`Cannot atomically write frontier: ${String(error)}`);
	}
	return { path, exists: true, entries: [...entries] };
}
