import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
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
	mkdirSync(design, { recursive: true });
	mkdirSync(experiments, { recursive: true });
	setPiRoot(root, "formal");
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
		inactive: registry.inactiveRows().map((row) => row.session_id),
	};
}

afterEach(() => setPiRoot(undefined));

describe("SessionRegistry recovery integration", () => {
	it("clean restart activates only canonical control and preserves ordinary identity", () => {
		const value = project();
		const control = durable(join(value.root, ".pi"), value.sessions, "control");
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

	it("reclaims a stale instance and resumes only canonical control", () => {
		const value = project();
		const control = durable(join(value.root, ".pi"), value.sessions, "control");
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

	it("rebuilds the deleted registry from JSONL identity and filters control history", async () => {
		const value = project();
		const oldControl = durable(join(value.root, ".pi"), value.sessions, "old-control");
		const control = durable(join(value.root, ".pi"), value.sessions, "control");
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
		expect(result.inactive).toEqual([experiments.getSessionId(), design.getSessionId()]);
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
