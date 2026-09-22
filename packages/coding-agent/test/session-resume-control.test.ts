import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setPiRoot } from "../src/core/pi-root.ts";
import { SessionManager } from "../src/core/session-manager.ts";

function root(base: string): string {
	const value = join(base, "project");
	mkdirSync(join(value, "control"), { recursive: true });
	return value;
}

function sessionFile(dir: string, id: string, cwd: string): string {
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `${id}.jsonl`);
	writeFileSync(
		path,
		`${JSON.stringify({ type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd })}\n`,
	);
	return path;
}

describe("session active/inactive semantics", () => {
	let base: string;
	let piRoot: string;
	beforeEach(() => {
		base = mkdtempSync(join(tmpdir(), "pi-session-state-"));
		piRoot = root(base);
		setPiRoot(piRoot);
	});
	afterEach(() => setPiRoot(undefined));

	it("excludes live persisted files from historical listings", async () => {
		const dir = join(base, "history");
		const control = join(piRoot, "control");
		const design = join(piRoot, "design");
		const experiments = join(piRoot, "experiments");
		mkdirSync(design, { recursive: true });
		mkdirSync(experiments, { recursive: true });
		const controlFile = sessionFile(dir, "control", control);
		const designFile = sessionFile(dir, "design", design);
		const experimentsFile = sessionFile(dir, "experiments", experiments);
		const active = new Set([controlFile, designFile].map((path) => realpathSync(path)));
		const listed = await SessionManager.listAll(dir);
		const inactive = listed.filter((item) => !active.has(realpathSync(item.path)));
		expect(inactive.map((item) => realpathSync(item.path))).toEqual([realpathSync(experimentsFile)]);
	});
});
