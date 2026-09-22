import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalizePath } from "../utils/paths.ts";
import { getPiRoot, getPiRootControlDir } from "./pi-root.ts";
import { type SessionInfo, SessionManager } from "./session-manager.ts";

export type SessionRegistryRole = "control" | "unassigned";
export type SessionRegistryRuntimeState = "active" | "inactive";
export interface RegistryRow {
	session_id: string;
	session_file: string | null;
	cwd: string;
	name: string | null;
	role: SessionRegistryRole;
	runtime_state: SessionRegistryRuntimeState;
	runtime_instance_id: string | null;
	last_seen_at: number;
	updated_at: number;
}
export interface RuntimeInstance {
	instance_id: string;
	pid: number;
	hostname: string;
	started_at: number;
	heartbeat_at: number;
	state: "active" | "closed";
}

export class PiRootAlreadyActiveError extends Error {
	constructor(instance: RuntimeInstance) {
		super(
			`PiRoot is already owned by live instance ${instance.instance_id} (pid ${instance.pid}@${instance.hostname})`,
		);
		this.name = "PiRootAlreadyActiveError";
	}
}

let registry: SessionRegistry | undefined;
function now(): number {
	return Date.now();
}
function registryPath(controlDir: string): string {
	return join(controlDir, "state", "control.sqlite3");
}
function ensurePiGitignore(controlDir: string): void {
	mkdirSync(join(controlDir, "state"), { recursive: true });
	const file = join(controlDir, ".gitignore");
	if (!existsSync(file))
		writeFileSync(file, "state/control.sqlite3\nstate/control.sqlite3-wal\nstate/control.sqlite3-shm\n");
}

export class SessionRegistry {
	private readonly db: DatabaseSync;
	private readonly root: string;
	private readonly instance: RuntimeInstance;
	private heartbeatTimer: ReturnType<typeof setInterval> | undefined;
	private closed = false;
	private readonly heartbeatIntervalMs: number;
	private readonly staleAfterMs: number;
	private failNextDeactivate = false;

	constructor(root: string, options: { acquire?: boolean; heartbeatIntervalMs?: number; staleAfterMs?: number } = {}) {
		this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10_000;
		this.staleAfterMs = options.staleAfterMs ?? 30_000;
		this.root = canonicalizePath(root);
		const controlDir = getPiRootControlDir(this.root);
		if (!controlDir) throw new Error(`PiRoot has no control directory: ${this.root}`);
		ensurePiGitignore(controlDir);
		this.db = new DatabaseSync(registryPath(controlDir));
		this.db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
		this.db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runtime_instances (
 instance_id TEXT PRIMARY KEY, pid INTEGER NOT NULL, hostname TEXT NOT NULL,
 started_at INTEGER NOT NULL, heartbeat_at INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('active','closed'))
);
CREATE TABLE IF NOT EXISTS sessions (
 session_id TEXT PRIMARY KEY, session_file TEXT UNIQUE, cwd TEXT NOT NULL, name TEXT,
 role TEXT NOT NULL CHECK(role IN ('control','unassigned')),
 runtime_state TEXT NOT NULL CHECK(runtime_state IN ('active','inactive')),
 runtime_instance_id TEXT REFERENCES runtime_instances(instance_id),
 last_seen_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);`);
		this.migrateSessions();
		this.db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('schema_version','3')").run();
		this.db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('pi_root',?)").run(this.root);
		this.instance = {
			instance_id: randomUUID(),
			pid: process.pid,
			hostname: hostname(),
			started_at: now(),
			heartbeat_at: now(),
			state: "active",
		};
		if (options.acquire !== false) this.acquire();
	}

	private migrateSessions(): void {
		const columns = this.db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
		if (!columns.some((column) => column.name === "runtime_instance_id")) {
			this.db.exec(
				"ALTER TABLE sessions ADD COLUMN runtime_instance_id TEXT REFERENCES runtime_instances(instance_id)",
			);
		}
		this.db.exec(
			"CREATE INDEX IF NOT EXISTS sessions_active_instance ON sessions(runtime_state, runtime_instance_id)",
		);
	}

	private acquire(): void {
		const threshold = this.staleAfterMs;
		this.db.exec("BEGIN IMMEDIATE");
		try {
			const owner = this.db
				.prepare("SELECT * FROM runtime_instances WHERE state='active' ORDER BY heartbeat_at DESC LIMIT 1")
				.get() as RuntimeInstance | undefined;
			if (owner && !this.isStale(owner, threshold)) throw new PiRootAlreadyActiveError(owner);
			if (owner) {
				this.db.prepare("UPDATE runtime_instances SET state='closed' WHERE instance_id=?").run(owner.instance_id);
				this.db
					.prepare(
						"UPDATE sessions SET runtime_state='inactive', runtime_instance_id=NULL, updated_at=? WHERE runtime_instance_id=?",
					)
					.run(now(), owner.instance_id);
			}
			this.db
				.prepare("INSERT INTO runtime_instances VALUES(?,?,?,?,?,'active')")
				.run(
					this.instance.instance_id,
					this.instance.pid,
					this.instance.hostname,
					this.instance.started_at,
					this.instance.heartbeat_at,
				);
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
		this.heartbeatTimer = setInterval(() => this.heartbeat(), this.heartbeatIntervalMs);
		this.heartbeatTimer.unref();
	}

	private isStale(owner: RuntimeInstance, threshold: number): boolean {
		if (now() - owner.heartbeat_at > threshold) return true;
		if (owner.hostname === hostname()) {
			try {
				process.kill(owner.pid, 0);
				return false;
			} catch {
				return true;
			}
		}
		return false;
	}

	private heartbeat(): void {
		this.db
			.prepare("UPDATE runtime_instances SET heartbeat_at=? WHERE instance_id=? AND state='active'")
			.run(now(), this.instance.instance_id);
	}

	resetActive(): void {
		this.db
			.prepare(
				"UPDATE sessions SET runtime_state='inactive', runtime_instance_id=NULL, updated_at=? WHERE runtime_state='active'",
			)
			.run(now());
	}

	rebuild(rows: readonly SessionInfo[]): void {
		const timestamp = now();
		const upsert =
			this.db.prepare(`INSERT INTO sessions(session_id,session_file,cwd,name,role,runtime_state,runtime_instance_id,last_seen_at,updated_at)
VALUES(?,?,?,?,?,'inactive',NULL,?,?) ON CONFLICT(session_id) DO UPDATE SET session_file=excluded.session_file,cwd=excluded.cwd,name=excluded.name,role=excluded.role,runtime_state='inactive',runtime_instance_id=NULL,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`);
		this.db.exec("BEGIN IMMEDIATE");
		try {
			for (const row of rows) {
				const cwd = canonicalizePath(row.cwd);
				upsert.run(
					row.id,
					canonicalizePath(row.path),
					cwd,
					row.name ?? null,
					this.roleFor(cwd),
					timestamp,
					timestamp,
				);
			}
			this.recoverCanonicalControl();
			this.db.exec("COMMIT");
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	private recoverCanonicalControl(): void {
		const controlDir = getPiRootControlDir(this.root);
		if (!controlDir) return;
		const existing = this.db.prepare("SELECT value FROM meta WHERE key='canonical_control_session_id'").get() as
			| { value?: string }
			| undefined;
		if (
			existing?.value &&
			this.db.prepare("SELECT 1 FROM sessions WHERE session_id=? AND cwd=?").get(existing.value, controlDir)
		)
			return;
		const candidate = this.db
			.prepare("SELECT session_id FROM sessions WHERE cwd=? ORDER BY last_seen_at DESC LIMIT 1")
			.get(controlDir) as { session_id?: string } | undefined;
		if (candidate?.session_id)
			this.db
				.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('canonical_control_session_id',?)")
				.run(candidate.session_id);
	}

	getRoot(): string {
		return this.root;
	}

	isClosed(): boolean {
		return this.closed;
	}

	canonicalControlSession(): RegistryRow | undefined {
		const id = this.canonicalControlSessionId();
		return id === undefined ? undefined : this.rows().find((row) => row.session_id === id);
	}

	async openCanonicalControl(sessionDir?: string): Promise<SessionManager> {
		const existing = this.canonicalControlSession();
		if (existing && existsSync(existing.session_file ?? ""))
			return SessionManager.open(existing.session_file!, sessionDir);
		const controlDir = getPiRootControlDir(this.root);
		if (!controlDir) throw new Error(`PiRoot has no control directory: ${this.root}`);
		const created = SessionManager.create(controlDir, sessionDir);
		if (created.getSessionFile() && !existsSync(created.getSessionFile()!)) created.persistSessionHeader();
		this.setCanonicalControlSessionId(created.getSessionId());
		return created;
	}

	heartbeatAt(): number {
		return (
			(
				this.db
					.prepare("SELECT heartbeat_at FROM runtime_instances WHERE instance_id=?")
					.get(this.instance.instance_id) as { heartbeat_at: number } | undefined
			)?.heartbeat_at ?? 0
		);
	}

	runtimeInstance(): RuntimeInstance {
		return { ...this.instance };
	}

	canonicalControlSessionId(): string | undefined {
		return (
			this.db.prepare("SELECT value FROM meta WHERE key='canonical_control_session_id'").get() as
				| { value?: string }
				| undefined
		)?.value;
	}
	setCanonicalControlSessionId(id: string): void {
		this.db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('canonical_control_session_id',?)").run(id);
	}

	upsert(session: { id: string; file?: string; cwd: string; name?: string }): void {
		const timestamp = now();
		const cwd = canonicalizePath(session.cwd);
		this.db
			.prepare(`INSERT INTO sessions(session_id,session_file,cwd,name,role,runtime_state,runtime_instance_id,last_seen_at,updated_at)
VALUES(?,?,?,?,?,'active',?,?,?) ON CONFLICT(session_id) DO UPDATE SET session_file=excluded.session_file,cwd=excluded.cwd,name=excluded.name,role=excluded.role,runtime_state='active',runtime_instance_id=excluded.runtime_instance_id,last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at`)
			.run(
				session.id,
				session.file ? canonicalizePath(session.file) : null,
				cwd,
				session.name ?? null,
				this.roleFor(cwd),
				this.instance.instance_id,
				timestamp,
				timestamp,
			);
		if (this.roleFor(cwd) === "control" && !this.canonicalControlSessionId())
			this.setCanonicalControlSessionId(session.id);
	}
	setName(id: string, name: string | undefined): void {
		this.db.prepare("UPDATE sessions SET name=?,updated_at=? WHERE session_id=?").run(name ?? null, now(), id);
	}
	setFaults(faults: { nextDeactivate?: boolean; nextActivate?: boolean }): void {
		this.failNextDeactivate = faults.nextDeactivate === true;
	}

	setInactive(id: string): void {
		if (this.failNextDeactivate) {
			this.failNextDeactivate = false;
			throw new Error(`Injected registry deactivation failure for ${id}`);
		}
		this.db
			.prepare(
				"UPDATE sessions SET runtime_state='inactive',runtime_instance_id=NULL,updated_at=? WHERE session_id=?",
			)
			.run(now(), id);
		const row = this.db.prepare("SELECT runtime_state FROM sessions WHERE session_id=?").get(id) as
			| { runtime_state?: string }
			| undefined;
		if (!row || row.runtime_state !== "inactive") throw new Error(`Failed to deactivate session registry row: ${id}`);
	}
	activeRows(): RegistryRow[] {
		return this.rows().filter(
			(row) => row.runtime_state === "active" && row.runtime_instance_id === this.instance.instance_id,
		);
	}
	inactiveRows(): RegistryRow[] {
		const canonical = this.canonicalControlSessionId();
		return this.rows().filter(
			(row) => row.runtime_state === "inactive" && row.role !== "control" && row.session_id !== canonical,
		);
	}
	rows(): RegistryRow[] {
		return this.db.prepare("SELECT * FROM sessions ORDER BY updated_at DESC").all() as unknown as RegistryRow[];
	}
	private roleFor(cwd: string): SessionRegistryRole {
		return getPiRootControlDir(this.root) === cwd ? "control" : "unassigned";
	}
	close(): void {
		if (this.closed) return;
		this.closed = true;
		if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
		this.db
			.prepare(
				"UPDATE sessions SET runtime_state='inactive',runtime_instance_id=NULL,updated_at=? WHERE runtime_instance_id=?",
			)
			.run(now(), this.instance.instance_id);
		this.db
			.prepare("UPDATE runtime_instances SET state='closed',heartbeat_at=? WHERE instance_id=?")
			.run(now(), this.instance.instance_id);
		this.db.close();
	}
}

export async function initializeSessionRegistry(
	root: string,
	options: { acquire?: boolean; heartbeatIntervalMs?: number; staleAfterMs?: number; sessionDir?: string } = {},
): Promise<SessionRegistry> {
	const canonicalRoot = canonicalizePath(root);
	if (registry) {
		if (registry.getRoot() !== canonicalRoot) {
			throw new Error(`SessionRegistry is already initialized for ${registry.getRoot()}`);
		}
		if (registry.isClosed()) throw new Error("SessionRegistry was already closed and cannot be reinitialized");
		return registry;
	}
	registry = new SessionRegistry(canonicalRoot, options);
	const rows = await SessionManager.listAll(options.sessionDir);
	registry.rebuild(rows);
	return registry;
}
export function getSessionRegistry(): SessionRegistry | undefined {
	return registry;
}

export function setSessionRegistryForTesting(value: SessionRegistry | undefined): void {
	registry = value;
}
export function syncSessionRegistry(session: { id: string; file?: string; cwd: string; name?: string }): void {
	registry?.upsert(session);
}
export function syncSessionRegistryName(id: string, name: string | undefined): void {
	registry?.setName(id, name);
}
export function deactivateSessionRegistry(id: string): void {
	registry?.setInactive(id);
}
export function isControlCwd(cwd: string): boolean {
	const root = getPiRoot();
	return root !== undefined && getPiRootControlDir(root) === canonicalizePath(cwd);
}
