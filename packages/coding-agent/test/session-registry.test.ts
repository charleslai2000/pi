import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePiRootInfo, setPiRoot } from "../src/core/pi-root.ts";
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
		const design = join(root, "design");
		const experiments = join(root, "experiments");
		mkdirSync(design, { recursive: true });
		mkdirSync(experiments, { recursive: true });
		setPiRoot(root);
		expect(resolvePiRootInfo({ cwd: design })).toEqual({ root });
		const registry = new SessionRegistry(root);
		const rows = [
			session("a", design, "design"),
			session("b", experiments, "science"),
			session("c", join(root, ".pi"), "runtime"),
		];
		registry.rebuild(rows);
		const first = logicalRows(registry);
		for (const file of ["control.sqlite3", "control.sqlite3-wal", "control.sqlite3-shm"]) {
			rmSync(join(root, ".pi", "control", file), { force: true });
		}
		registry.close();
		expect(existsSync(join(root, ".pi", "control", "control.sqlite3"))).toBe(false);
		const rebuilt = new SessionRegistry(root);
		rebuilt.rebuild(rows);
		expect(logicalRows(rebuilt)).toEqual(first);
		expect(rebuilt.rows().every((row) => row.runtime_state === "inactive")).toBe(true);
		rebuilt.upsert({ id: "b", file: rows[1]!.path, cwd: experiments, name: "science" });
		expect(rebuilt.rows().find((row) => row.session_id === "b")?.runtime_state).toBe("active");
		expect(rebuilt.rows().find((row) => row.session_id === "b")).toMatchObject({
			agent_slug: null,
			task_id: null,
			assignment_generation: null,
		});
		rebuilt.rebuild(rows);
		expect(rebuilt.rows().find((row) => row.session_id === "b")).toMatchObject({
			agent_slug: null,
			task_id: null,
			assignment_generation: null,
			runtime_state: "inactive",
		});
		rebuilt.upsert({
			id: "b",
			file: rows[1]!.path,
			cwd: experiments,
			name: "coder",
			agentSlug: "coder",
			taskId: "T001",
			assignmentGeneration: 3,
		});
		expect(rebuilt.rows().find((row) => row.session_id === "b")).toMatchObject({
			agent_slug: "coder",
			task_id: "T001",
			assignment_generation: 3,
			runtime_state: "active",
		});
		expect(rebuilt.rows().filter((row) => row.runtime_state === "active")).toHaveLength(1);
		rebuilt.close();
		rmSync(base, { recursive: true, force: true });
	});

	it("allows a PiRoot with .pi/ and no Control Plane directory", () => {
		const base = mkdtempSync(join("/tmp", "pi-registry-no-control-"));
		const root = join(base, "project");
		mkdirSync(join(root, ".pi"), { recursive: true });
		setPiRoot(root);
		const registry = new SessionRegistry(root, { acquire: false });
		expect(registry.getRoot()).toBe(root);
		registry.close();
		rmSync(base, { recursive: true, force: true });
	});

	it("does not treat .pi/control/ as a PiRoot marker", () => {
		const base = mkdtempSync(join("/tmp", "pi-registry-no-marker-"));
		const root = join(base, "project");
		const control = join(root, ".pi", "control");
		mkdirSync(control, { recursive: true });
		expect(() => resolvePiRootInfo({ cwd: control })).toThrow();
		rmSync(base, { recursive: true, force: true });
	});

	it("migrates legacy registry rows when stale assignments reference a missing goal", () => {
		const base = mkdtempSync(join("/tmp", "pi-registry-stale-assignment-"));
		const root = join(base, "project");
		const runtimeDir = join(root, ".pi");
		mkdirSync(join(runtimeDir, "control"), { recursive: true });
		setPiRoot(root);

		const db = new DatabaseSync(join(runtimeDir, "control", "control.sqlite3"));
		db.exec(`
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE runtime_instances (
	instance_id TEXT PRIMARY KEY, pid INTEGER NOT NULL, hostname TEXT NOT NULL,
	started_at INTEGER NOT NULL, heartbeat_at INTEGER NOT NULL,
	state TEXT NOT NULL CHECK(state IN ('active','closed'))
);
CREATE TABLE sessions (
	session_id TEXT PRIMARY KEY, session_file TEXT UNIQUE, cwd TEXT NOT NULL, name TEXT,
	role TEXT NOT NULL CHECK(role IN ('control','unassigned')),
	runtime_state TEXT NOT NULL CHECK(runtime_state IN ('active','inactive')),
	runtime_instance_id TEXT REFERENCES runtime_instances(instance_id),
	last_seen_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
INSERT INTO sessions VALUES('executor-session',NULL,'/tmp/project',NULL,'unassigned','inactive',NULL,1,1);
`);
		db.close();
		mkdirSync(join(runtimeDir, "control"), { recursive: true });
		mkdirSync(join(runtimeDir, "control", "goal-a"), { recursive: true });
		writeFileSync(join(runtimeDir, "control", "goal-a", "goal.md"), "# Goal A\n");
		writeFileSync(join(runtimeDir, "control", "goal-a", "T001-work.md"), "Status: READY\n");
		writeFileSync(
			join(runtimeDir, "control", "assignments.json"),
			JSON.stringify({
				version: 1,
				current: [
					{
						goalId: "deleted-goal",
						taskId: "T001",
						sessionId: "executor-session",
						assignedAt: new Date(1).toISOString(),
						generation: 1,
					},
				],
				history: [],
			}),
		);

		const registry = new SessionRegistry(root);
		expect(registry.getRoot()).toBe(root);
		const migrated = new DatabaseSync(join(runtimeDir, "control", "control.sqlite3"));
		expect(migrated.prepare("SELECT role FROM sessions WHERE session_id=?").get("executor-session")).toEqual({
			role: "executor",
		});
		migrated.close();
		registry.close();
		rmSync(base, { recursive: true, force: true });
	});

	it("resets crash-stale active rows without deleting them", () => {
		const base = mkdtempSync(join("/tmp", "pi-registry-crash-"));
		const root = join(base, "project");
		mkdirSync(join(root, ".pi"), { recursive: true });
		setPiRoot(root);
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
