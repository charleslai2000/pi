import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { setPiRoot } from "../src/core/pi-root.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SessionRegistry } from "../src/core/session-registry.ts";

function project(): { base: string; root: string; sessions: string; design: string; experiments: string } {
	const base = mkdtempSync(join("/tmp", "pi-recovery-integration-"));
	const root = join(base, "project");
	const sessions = join(root, "sessions");
	const design = join(root, "design");
	const experiments = join(root, "experiments");
	mkdirSync(join(root, ".pi"), { recursive: true });
	mkdirSync(join(root, "control"), { recursive: true });
	mkdirSync(design, { recursive: true });
	mkdirSync(experiments, { recursive: true });
	setPiRoot(root);
	return { base, root, sessions, design, experiments };
}

function durable(cwd: string, sessionDir: string, name?: string): SessionManager {
	const manager = SessionManager.create(cwd, sessionDir);
	manager.persistSessionHeader();
	if (name) manager.appendSessionInfo(name);
	return manager;
}

function info(manager: SessionManager) {
	return {
		id: manager.getSessionId(),
		path: manager.getSessionFile()!,
		cwd: manager.getCwd(),
		name: manager.getSessionName(),
		created: new Date(0),
		modified: new Date(0),
		messageCount: 0,
		firstMessage: "",
		allMessagesText: "",
	};
}

function view(registry: SessionRegistry): { active: string[]; inactive: string[] } {
	return {
		active: registry.activeRows().map((row) => row.session_id),
		inactive: registry
			.inactiveRows()
			.map((row) => row.session_id)
			.sort(),
	};
}

afterEach(() => setPiRoot(undefined));

describe("SessionRegistry recovery integration", () => {
	it("upgrades legacy control-role schema transactionally and reprojects authority roles", () => {
		const value = project();
		const control = durable(value.root, value.sessions, "legacy-controller");
		const executor = durable(value.design, value.sessions, "legacy-executor");
		const ordinary = durable(value.experiments, value.sessions, "legacy-ordinary");
		mkdirSync(join(value.root, "control", "qualification", "tasks"), { recursive: true });
		writeFileSync(join(value.root, "control", "qualification", "goal.md"), "# Qualification\n");
		writeFileSync(
			join(value.root, "control", "qualification", "tasks", "T001-fixture.md"),
			"Status: ACTIVE\nWork area\nfixture\nObjective\nfixture\nCompletion\nfixture\nResult\nfixture\nRemaining\nfixture\n",
		);
		const dbPath = join(value.root, ".pi", "state", "control.sqlite3");
		const formalSessions = join(value.root, ".pi", "sessions");
		mkdirSync(formalSessions, { recursive: true });
		for (const manager of [control, executor, ordinary])
			copyFileSync(manager.getSessionFile()!, join(formalSessions, `${manager.getSessionId()}.jsonl`));
		mkdirSync(join(value.root, ".pi", "state"), { recursive: true });
		const legacy = new DatabaseSync(dbPath);
		legacy.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE runtime_instances (instance_id TEXT PRIMARY KEY, pid INTEGER NOT NULL, hostname TEXT NOT NULL, started_at INTEGER NOT NULL, heartbeat_at INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('active','closed')));
CREATE TABLE sessions (session_id TEXT PRIMARY KEY, session_file TEXT UNIQUE, cwd TEXT NOT NULL, name TEXT, role TEXT NOT NULL CHECK(role IN ('control','unassigned')), runtime_state TEXT NOT NULL CHECK(runtime_state IN ('active','inactive')), runtime_instance_id TEXT REFERENCES runtime_instances(instance_id), last_seen_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO meta VALUES('canonical_control_session_id','${control.getSessionId()}');
INSERT INTO meta VALUES('schema_version','3');
INSERT INTO meta VALUES('pi_root','${value.root}');`);
		const insert = legacy.prepare(
			"INSERT INTO sessions VALUES(:id,:file,:cwd,:name,:role,:state,:instance,:seen,:updated)",
		);
		insert.run({
			id: control.getSessionId(),
			file: control.getSessionFile()!,
			cwd: value.root,
			name: "controller",
			role: "control",
			state: "inactive",
			instance: null,
			seen: 11,
			updated: 12,
		});
		insert.run({
			id: executor.getSessionId(),
			file: executor.getSessionFile()!,
			cwd: value.design,
			name: "executor",
			role: "control",
			state: "active",
			instance: null,
			seen: 21,
			updated: 22,
		});
		insert.run({
			id: ordinary.getSessionId(),
			file: ordinary.getSessionFile()!,
			cwd: value.experiments,
			name: "ordinary",
			role: "unassigned",
			state: "inactive",
			instance: null,
			seen: 31,
			updated: 32,
		});
		legacy
			.prepare(
				"INSERT INTO runtime_instances(instance_id,pid,hostname,started_at,heartbeat_at,state) VALUES(:id,:pid,:host,:started,:heartbeat,'closed')",
			)
			.run({ id: "instance-preserved", pid: 777, host: "host", started: 41, heartbeat: 42 });
		legacy.close();
		writeFileSync(
			join(value.root, ".pi", "assignments.json"),
			JSON.stringify(
				{
					version: 1,
					current: [
						{
							goalId: "qualification",
							taskId: "T001",
							sessionId: executor.getSessionId(),
							assignedAt: new Date(0).toISOString(),
							generation: 1,
						},
					],
					history: [
						{
							goalId: "qualification",
							taskId: "T001",
							sessionId: executor.getSessionId(),
							type: "assigned",
							at: new Date(0).toISOString(),
						},
					],
				},
				null,
				2,
			),
		);
		const registry = new SessionRegistry(value.root, { acquire: false });
		const migrated = new DatabaseSync(dbPath, { readOnly: true });
		expect(
			(
				migrated.prepare("SELECT updated_at FROM sessions WHERE session_id=?").get(executor.getSessionId()) as {
					updated_at: number;
				}
			).updated_at,
		).toBe(22);
		migrated.close();
		const rows = registry.rows();
		const byId = new Map(rows.map((row) => [row.session_id, row]));
		expect(rows).toHaveLength(3);
		expect(registry.canonicalControlSessionId()).toBe(control.getSessionId());
		expect(byId.get(control.getSessionId())?.role).toBe("controller");
		expect(byId.get(executor.getSessionId())?.role).toBe("executor");
		expect(byId.get(ordinary.getSessionId())?.role).toBe("unassigned");
		expect(byId.get(executor.getSessionId())).toMatchObject({
			runtime_state: "active",
			runtime_instance_id: null,
			last_seen_at: 21,
		});
		const migratedAfterProjection = new DatabaseSync(dbPath, { readOnly: true });
		expect(migratedAfterProjection.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
		expect(
			(migratedAfterProjection.prepare("SELECT count(*) AS count FROM sessions").get() as { count: number }).count,
		).toBe(3);
		expect(
			migratedAfterProjection
				.prepare("SELECT * FROM runtime_instances WHERE instance_id='instance-preserved'")
				.get(),
		).toMatchObject({ pid: 777, started_at: 41, heartbeat_at: 42, state: "closed" });
		const roleSchema = (
			migratedAfterProjection
				.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'")
				.get() as { sql: string }
		).sql;
		expect(roleSchema).toContain("'controller','executor','unassigned'");
		migratedAfterProjection.close();
		registry.close();
		rmSync(value.base, { recursive: true, force: true });
	});

	it("rolls back legacy role-schema upgrade on canonical/assignment identity conflict", () => {
		const value = project();
		const executor = durable(value.design, value.sessions, "conflict");
		mkdirSync(join(value.root, ".pi", "sessions"), { recursive: true });
		copyFileSync(executor.getSessionFile()!, join(value.root, ".pi", "sessions", "conflict.jsonl"));
		const dbPath = join(value.root, ".pi", "state", "control.sqlite3");
		mkdirSync(join(value.root, ".pi", "state"), { recursive: true });
		const legacy = new DatabaseSync(dbPath);
		legacy.exec(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE runtime_instances (instance_id TEXT PRIMARY KEY, pid INTEGER NOT NULL, hostname TEXT NOT NULL, started_at INTEGER NOT NULL, heartbeat_at INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN ('active','closed')));
CREATE TABLE sessions (session_id TEXT PRIMARY KEY, session_file TEXT UNIQUE, cwd TEXT NOT NULL, name TEXT, role TEXT NOT NULL CHECK(role IN ('control','unassigned')), runtime_state TEXT NOT NULL CHECK(runtime_state IN ('active','inactive')), runtime_instance_id TEXT REFERENCES runtime_instances(instance_id), last_seen_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
INSERT INTO meta VALUES('canonical_control_session_id','${executor.getSessionId()}');
INSERT INTO meta VALUES('schema_version','3');
INSERT INTO meta VALUES('pi_root','${value.root}');`);
		const metaDb = legacy.prepare("INSERT INTO sessions VALUES(:id,:file,:cwd,:name,'control','inactive',NULL,1,2)");
		metaDb.run({
			id: "other-canonical",
			file: join(value.sessions, "other.jsonl"),
			cwd: value.root,
			name: "other",
		});
		metaDb.run({
			id: executor.getSessionId(),
			file: executor.getSessionFile()!,
			cwd: value.design,
			name: "conflict",
		});
		legacy.prepare("UPDATE meta SET value=? WHERE key='canonical_control_session_id'").run(executor.getSessionId());
		legacy.prepare("INSERT INTO meta VALUES('dummy','value')");
		writeFileSync(
			join(value.root, ".pi", "assignments.json"),
			JSON.stringify(
				{
					version: 1,
					current: [
						{
							goalId: "qualification",
							taskId: "T001",
							sessionId: executor.getSessionId(),
							assignedAt: new Date(0).toISOString(),
							generation: 1,
						},
					],
					history: [
						{
							goalId: "qualification",
							taskId: "T001",
							sessionId: executor.getSessionId(),
							type: "assigned",
							at: new Date(0).toISOString(),
						},
					],
				},
				null,
				2,
			),
		);
		legacy.close();
		mkdirSync(join(value.root, "control", "qualification", "tasks"), { recursive: true });
		writeFileSync(join(value.root, "control", "qualification", "goal.md"), "# Qualification\n");
		writeFileSync(
			join(value.root, "control", "qualification", "tasks", "T001-fixture.md"),
			"Status: ACTIVE\nWork area\nfixture\nObjective\nfixture\nCompletion\nfixture\nResult\nfixture\nRemaining\nfixture\n",
		);
		const before = new DatabaseSync(dbPath, { readOnly: true });
		const beforeRows = before.prepare("SELECT * FROM sessions ORDER BY session_id").all();
		before.close();
		expect(() => new SessionRegistry(value.root, { acquire: false })).toThrow(
			"both canonical Controller and assigned Executor",
		);
		const after = new DatabaseSync(dbPath, { readOnly: true });
		expect(after.prepare("SELECT * FROM sessions ORDER BY session_id").all()).toEqual(beforeRows);
		expect(
			(
				after.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sessions'").get() as {
					sql: string;
				}
			).sql,
		).toContain("'control','unassigned'");
		expect(after.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
		after.close();
		rmSync(value.base, { recursive: true, force: true });
	});

	it("clean restart activates only canonical Controller and preserves ordinary identity", () => {
		const value = project();
		const control = durable(value.root, value.sessions, "controller");
		const design = durable(value.design, value.sessions, "architecture");
		const experiments = durable(value.experiments, value.sessions, "science");
		const before = [info(control), info(design), info(experiments)];
		const first = new SessionRegistry(value.root);
		first.rebuild(before);
		first.upsert({
			id: control.getSessionId(),
			file: control.getSessionFile(),
			cwd: control.getCwd(),
			name: control.getSessionName(),
		});
		first.upsert({
			id: design.getSessionId(),
			file: design.getSessionFile(),
			cwd: design.getCwd(),
			name: design.getSessionName(),
		});
		first.close();
		const second = new SessionRegistry(value.root);
		second.rebuild(before);
		second.upsert({
			id: control.getSessionId(),
			file: control.getSessionFile(),
			cwd: control.getCwd(),
			name: control.getSessionName(),
		});
		expect(view(second).active).toEqual([control.getSessionId()]);
		expect(view(second).inactive).toEqual(
			expect.arrayContaining([experiments.getSessionId(), design.getSessionId()]),
		);
		expect(second.rows().find((row) => row.session_id === design.getSessionId())?.session_file).toBe(
			design.getSessionFile(),
		);
		expect(second.rows().find((row) => row.session_id === design.getSessionId())?.name).toBe("architecture");
		second.close();
		rmSync(value.base, { recursive: true, force: true });
	});

	it("reclaims a stale instance and resumes only the canonical Controller", () => {
		const value = project();
		const control = durable(value.root, value.sessions, "controller");
		const design = durable(value.design, value.sessions, "architecture");
		const rows = [info(control), info(design)];
		const first = new SessionRegistry(value.root, { heartbeatIntervalMs: 100, staleAfterMs: 1 });
		first.rebuild(rows);
		first.upsert({
			id: control.getSessionId(),
			file: control.getSessionFile(),
			cwd: control.getCwd(),
			name: control.getSessionName(),
		});
		first.upsert({
			id: design.getSessionId(),
			file: design.getSessionFile(),
			cwd: design.getCwd(),
			name: design.getSessionName(),
		});
		const oldId = first.runtimeInstance().instance_id;
		const database = new DatabaseSync(join(value.root, ".pi", "state", "control.sqlite3"));
		database.prepare("UPDATE runtime_instances SET heartbeat_at=0 WHERE instance_id=?").run(oldId);
		database.close();
		const second = new SessionRegistry(value.root, { heartbeatIntervalMs: 100, staleAfterMs: 1 });
		second.rebuild(rows);
		second.upsert({
			id: control.getSessionId(),
			file: control.getSessionFile(),
			cwd: control.getCwd(),
			name: control.getSessionName(),
		});
		const current = second.runtimeInstance().instance_id;
		expect(current).not.toBe(oldId);
		expect(view(second)).toEqual({ active: [control.getSessionId()], inactive: [design.getSessionId()] });
		expect(second.rows().find((row) => row.session_id === design.getSessionId())?.runtime_instance_id).toBeNull();
		expect(second.rows().find((row) => row.session_id === design.getSessionId())?.name).toBe("architecture");
		second.close();
		rmSync(value.base, { recursive: true, force: true });
	});

	it("rebuilds the deleted registry from JSONL identity and filters ordinary history", async () => {
		const value = project();
		const oldControl = durable(value.root, join(value.root, ".pi", "sessions"), "old-controller");
		const control = durable(value.root, join(value.root, ".pi", "sessions"), "controller");
		const design = durable(value.design, value.sessions, "architecture");
		const experiments = durable(value.experiments, value.sessions, "science");
		const rows = await SessionManager.listAll(value.sessions);
		const first = new SessionRegistry(value.root);
		first.rebuild(rows);
		first.setCanonicalControlSessionId(control.getSessionId());
		first.close();
		const databaseDir = join(value.root, ".pi", "state");
		for (const suffix of ["", "-wal", "-shm"]) rmSync(join(databaseDir, `control.sqlite3${suffix}`), { force: true });
		const rebuilt = new SessionRegistry(value.root);
		rebuilt.rebuild(await SessionManager.listAll(value.sessions));
		rebuilt.setCanonicalControlSessionId(control.getSessionId());
		rebuilt.upsert({
			id: control.getSessionId(),
			file: control.getSessionFile(),
			cwd: control.getCwd(),
			name: control.getSessionName(),
		});
		const result = view(rebuilt);
		expect(result.active).toEqual([control.getSessionId()]);
		expect(result.inactive).toEqual([experiments.getSessionId(), design.getSessionId()].sort());
		expect(result.inactive).not.toContain(oldControl.getSessionId());
		for (const manager of [control, design, experiments]) {
			const row = rebuilt.rows().find((candidate) => candidate.session_id === manager.getSessionId());
			expect(row?.session_file).toBe(manager.getSessionFile());
			expect(row?.name).toBe(manager.getSessionName());
		}
		rebuilt.close();
		rmSync(value.base, { recursive: true, force: true });
	});
});
