import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { join, relative } from "node:path";

/** One-time migration helper. Runtime never imports or invokes this function. */
export function migrateLegacyControlAuthority(piRoot: string): { goals: number; tasks: number } {
	const legacy = join(piRoot, "control");
	const authority = join(piRoot, ".pi");
	if (!existsSync(legacy)) return { goals: 0, tasks: 0 };
	const goals = readdirSync(legacy, { withFileTypes: true }).filter(
		(entry) => entry.isDirectory() && existsSync(join(legacy, entry.name, "goal.md")),
	);
	const names = goals.map((entry) => entry.name);
	let taskCount = 0;
	const sources = new Map<string, string>();
	for (const entry of goals) {
		const source = join(legacy, entry.name);
		const destination = join(authority, entry.name);
		if (existsSync(destination)) throw new Error(`Migration conflict: destination already exists: ${destination}`);
		const entries = readdirSync(source, { withFileTypes: true });
		for (const item of entries) {
			if (!item.isFile() || (!/^(goal|plan)\.md$/.test(item.name) && !/^T\d+-[^/]+\.md$/.test(item.name)))
				throw new Error(`Unexpected legacy authority entry: ${join(source, item.name)}`);
			const from = join(source, item.name);
			sources.set(from, readFileSync(from, "utf8"));
			if (/^T\d+-[^/]+\.md$/.test(item.name)) taskCount++;
		}
	}
	mkdirSync(authority, { recursive: true });
	for (const entry of goals) renameSync(join(legacy, entry.name), join(authority, entry.name));
	for (const [from, content] of sources) {
		const destination = join(authority, relative(legacy, from));
		if (readFileSync(destination, "utf8") !== content)
			throw new Error(`Migration verification mismatch: ${destination}`);
	}
	return { goals: names.length, tasks: taskCount };
}
