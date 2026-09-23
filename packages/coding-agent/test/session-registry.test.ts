import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getPiRootControlDir, resolvePiRootInfo, setPiRoot } from "../src/core/pi-root.ts";
import { SessionRegistry } from "../src/core/session-registry.ts";

function session(
	id: string,
	cwd: string,
	name: string,
): {
	id: string;
	path: string;
	cwd: string;
	name: string;
	created: Date;
	modified: Date;
	messageCount: number;
	firstMessage: string;
	allMessagesText: string;
} {
	return {
		id,
		path: join(cwd, `${id}.jsonl`),
		cwd,
		name,
		created: new Date(0),
		modified: new Date(0),
		messageCount: 0,
		firstMessage: "",
		allMessagesText: "",
	};
}

function logicalRows(registry: SessionRegistry): unknown[] {
	return registry
		.rows()
		.map(({ session_id, session_file, cwd, name, role }) => ({ session_id, session_file, cwd, name, role }))
		.sort((left, right) =>
			(left as { session_id: string }).session_id.localeCompare((right as { session_id: string }).session_id),
		);
}

describe("SessionRegistry control plane", () => {
	afterEach(() => setPiRoot(undefined));

	it("uses .pi for formal projects and rebuilds equivalently after database deletion", () => {
		const base = mkdtempSync(join("/tmp", "pi-registry-formal-"));
		const root = join(base, "project");
		mkdirSync(join(root, ".pi"), { recursive: true });
		mkdirSync(join(root, "control"), { recursive: true });
		const design = join(root, "design");
		const experiments = join(root, "experiments");
		mkdirSync(design, { recursive: true });
		mkdirSync(experiments, { recursive: true });
		setPiRoot(root, "formal");
		expect(resolvePiRootInfo({ cwd: design })).toEqual({ root, controlDir: join(root, "control"), mode: "formal" });
		expect(getPiRootControlDir(root)).toBe(join(root, "control"));

		const registry = new SessionRegistry(root);
		const rows = [
			session("a", design, "design"),
			session("b", experiments, "science"),
			session("c", join(root, ".pi"), "control"),
		];
		registry.rebuild(rows);
		const first = logicalRows(registry);
		for (const file of ["control.sqlite3", "control.sqlite3-wal", "control.sqlite3-shm"]) {
			rmSync(join(root, ".pi", "state", file), { force: true });
		}
		registry.close();
		expect(existsSync(join(root, ".pi", "state", "control.sqlite3"))).toBe(false);
		const rebuilt = new SessionRegistry(root);
		rebuilt.rebuild(rows);
		expect(logicalRows(rebuilt)).toEqual(first);
		expect(rebuilt.rows().every((row) => row.runtime_state === "inactive")).toBe(true);
		rebuilt.upsert({ id: "b", file: rows[1]!.path, cwd: experiments, name: "science" });
		expect(rebuilt.rows().find((row) => row.session_id === "b")?.runtime_state).toBe("active");
		expect(rebuilt.rows().filter((row) => row.runtime_state === "active")).toHaveLength(1);
		rebuilt.close();
		rmSync(base, { recursive: true, force: true });
	});

	it("allows a PiRoot with .pi/ and no control/ directory", () => {
		const base = mkdtempSync(join("/tmp", "pi-registry-no-control-"));
		const root = join(base, "project");
		mkdirSync(join(root, ".pi"), { recursive: true });
		setPiRoot(root, "formal");
		const registry = new SessionRegistry(root, { acquire: false });
		expect(registry.getRoot()).toBe(root);
		registry.close();
		rmSync(base, { recursive: true, force: true });
	});

	it("rejects a directory with control/ but no .pi/ marker", () => {
		const base = mkdtempSync(join("/tmp", "pi-registry-legacy-"));
		const root = join(base, "project");
		const control = join(root, "control");
		mkdirSync(control, { recursive: true });
		setPiRoot(root, "formal");
		expect(() => resolvePiRootInfo({ cwd: control })).toThrow();
		expect(() => new SessionRegistry(root)).toThrow();
		rmSync(base, { recursive: true, force: true });
	});

	it("resets crash-stale active rows without deleting them", () => {
		const base = mkdtempSync(join("/tmp", "pi-registry-crash-"));
		const root = join(base, "project");
		mkdirSync(join(root, ".pi"), { recursive: true });
		mkdirSync(join(root, "control"), { recursive: true });
		setPiRoot(root, "formal");
		const registry = new SessionRegistry(root);
		const a = session("a", join(root, "a"), "a");
		registry.rebuild([a]);
		registry.upsert({ id: "a", file: a.path, cwd: a.cwd, name: a.name });
		registry.upsert({ id: "b", file: join(root, "b.jsonl"), cwd: join(root, "b"), name: "b" });
		registry.resetActive();
		expect(registry.rows()).toHaveLength(2);
		expect(registry.rows().every((row) => row.runtime_state === "inactive")).toBe(true);
		registry.close();
		rmSync(base, { recursive: true, force: true });
	});
});
