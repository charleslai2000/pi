import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";

interface Ready {
	type: "ready";
	pid: number;
	instanceId: string;
	canonicalSessionId: string;
	sessionFile: string;
	poolSize: number;
	foregroundSessionId: string;
	foregroundCwd: string;
}

const fixture = new URL("./fixtures/pi-root-application-child.ts", import.meta.url);
const children: ChildProcess[] = [];
const exitedChildren = new WeakSet<ChildProcess>();

function makeProject(): { base: string; root: string; agentDir: string } {
	const base = mkdtempSync(join("/tmp", "pi-root-process-"));
	const root = join(base, "project");
	mkdirSync(join(root, ".pi", "agents"), { recursive: true });
	mkdirSync(join(root, "design"), { recursive: true });
	writeFileSync(join(root, ".pi", "agents", "orchestrator.md"), "Canonical Controller.\n");
	return { base, root, agentDir: join(base, "agent") };
}

function db(root: string): DatabaseSync {
	return new DatabaseSync(join(root, ".pi", "control", "control.sqlite3"));
}

function persistedSession(root: string, cwdName: string): string {
	const cwd = join(root, cwdName);
	mkdirSync(cwd, { recursive: true });
	const manager = SessionManager.create(cwd, join(root, ".pi", "sessions"));
	manager.persistSessionHeader();
	return manager.getSessionFile()!;
}

async function start(project: ReturnType<typeof makeProject>): Promise<{ child: ChildProcess; ready: Ready }> {
	const child = spawn(process.execPath, ["--import", "tsx", fixture.pathname], {
		shell: false,
		env: { ...process.env, PI_TEST_ROOT: project.root, PI_TEST_AGENT_DIR: project.agentDir },
		stdio: ["pipe", "pipe", "pipe"],
	});
	children.push(child);
	child.once("exit", () => exitedChildren.add(child));
	const lines = createInterface({ input: child.stdout!, crlfDelay: Infinity });
	const stderr: string[] = [];
	child.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
	return {
		child,
		ready: await new Promise<Ready>((resolve, reject) => {
			lines.on("line", (line) => {
				if (line.startsWith("{")) resolve(JSON.parse(line) as Ready);
			});
			child.once("error", reject);
			child.once("exit", () => reject(new Error(`child exited before ready: ${stderr.join("")}`)));
		}),
	};
}

function command(child: ChildProcess, value: string): void {
	child.stdin!.write(`${value}\n`);
}

async function activate(
	child: ChildProcess,
	sessionFile: string,
): Promise<{ sessionId: string; poolSize: number; foregroundSessionId: string }> {
	const lines = createInterface({ input: child.stdout!, crlfDelay: Infinity });
	const result = new Promise<{ sessionId: string; poolSize: number; foregroundSessionId: string }>(
		(resolve, reject) => {
			lines.on("line", (line) => {
				if (!line.startsWith("{")) return;
				const value = JSON.parse(line) as {
					type?: string;
					sessionId?: string;
					poolSize?: number;
					foregroundSessionId?: string;
				};
				if (value.type === "activated" && value.sessionId && value.poolSize && value.foregroundSessionId)
					resolve({
						sessionId: value.sessionId,
						poolSize: value.poolSize,
						foregroundSessionId: value.foregroundSessionId,
					});
			});
			child.once("exit", () => reject(new Error("child exited before activation ACK")));
		},
	);
	command(child, `activate ${sessionFile}`);
	return result;
}

async function commandAndExit(child: ChildProcess, value: string): Promise<number> {
	const result = exit(child);
	command(child, value);
	const code = await result;
	if (code === null) throw new Error(`child exited by signal while processing ${value}`);
	return code;
}

async function exit(child: ChildProcess): Promise<number | null> {
	if (exitedChildren.has(child)) return child.exitCode;
	return await new Promise((resolve) => child.once("exit", (code) => resolve(code)));
}

async function waitForPidExit(pid: number): Promise<void> {
	const deadline = Date.now() + 2_000;
	while (Date.now() < deadline) {
		try {
			process.kill(pid, 0);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
		}
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	throw new Error(`PID ${pid} did not exit`);
}

async function clean(child: ChildProcess, signal?: NodeJS.Signals): Promise<void> {
	if (child.exitCode !== null || exitedChildren.has(child)) return;
	if (signal) {
		child.kill(signal);
		await exit(child);
		return;
	}
	await commandAndExit(child, "shutdown");
}

afterEach(async () => {
	for (const child of children.splice(0)) await clean(child, "SIGKILL");
});

describe("PiRoot application cross-process lifecycle", () => {
	it("preserves canonical identity across normal process restart", async () => {
		const project = makeProject();
		const first = await start(project);
		expect(first.ready.poolSize).toBe(1);
		expect(first.ready.foregroundSessionId).toBe(first.ready.canonicalSessionId);
		expect(await commandAndExit(first.child, "shutdown")).toBe(0);
		const second = await start(project);
		expect(second.ready.canonicalSessionId).toBe(first.ready.canonicalSessionId);
		expect(second.ready.sessionFile).toBe(first.ready.sessionFile);
		expect(second.ready.poolSize).toBe(1);
		expect(await commandAndExit(second.child, "shutdown")).toBe(0);
		rmSync(project.base, { recursive: true, force: true });
	});

	it("rejects a fresh second process without mutating the first", async () => {
		const project = makeProject();
		const first = await start(project);
		const second = spawn(process.execPath, ["--import", "tsx", fixture.pathname], {
			shell: false,
			env: { ...process.env, PI_TEST_ROOT: project.root, PI_TEST_AGENT_DIR: project.agentDir },
			stdio: ["ignore", "pipe", "pipe"],
		});
		children.push(second);
		const code = await exit(second);
		expect(code).not.toBe(0);
		const database = db(project.root);
		const owner = database
			.prepare("SELECT * FROM runtime_instances WHERE instance_id=?")
			.get(first.ready.instanceId) as { state: string };
		const session = database
			.prepare("SELECT * FROM sessions WHERE session_id=?")
			.get(first.ready.canonicalSessionId) as { runtime_state: string; runtime_instance_id: string };
		expect(owner.state).toBe("active");
		expect(session.runtime_state).toBe("active");
		expect(session.runtime_instance_id).toBe(first.ready.instanceId);
		database.close();
		expect(await commandAndExit(first.child, "shutdown")).toBe(0);
		rmSync(project.base, { recursive: true, force: true });
	});

	it("reclaims a crashed owner and resumes only canonical control", async () => {
		const project = makeProject();
		const designFile = persistedSession(project.root, "design");
		const first = await start(project);
		const activation = await activate(first.child, designFile);
		expect(activation.poolSize).toBe(2);
		expect(activation.foregroundSessionId).toBe(activation.sessionId);
		const before = db(project.root);
		let activeBefore: { runtime_state: string; runtime_instance_id: string } | undefined;
		for (let attempt = 0; attempt < 20; attempt++) {
			activeBefore = before
				.prepare("SELECT session_id, runtime_state, runtime_instance_id FROM sessions WHERE session_file=?")
				.get(designFile) as { runtime_state: string; runtime_instance_id: string } | undefined;
			if (activeBefore?.runtime_state === "active") break;
			await new Promise((resolve) => setTimeout(resolve, 25));
		}
		expect(activeBefore).toBeDefined();
		expect(activeBefore?.runtime_state).toBe("active");
		expect(activeBefore?.runtime_instance_id).toBe(first.ready.instanceId);
		before.close();
		const killed = first.child.kill("SIGKILL");
		expect(killed).toBe(true);
		const crashCode = await exit(first.child);
		expect(crashCode).toBe(null);
		await waitForPidExit(first.ready.pid);
		const dirty = db(project.root);
		const dirtyOwner = dirty
			.prepare("SELECT state FROM runtime_instances WHERE instance_id=?")
			.get(first.ready.instanceId) as { state: string };
		const dirtySessions = dirty
			.prepare("SELECT runtime_state, runtime_instance_id FROM sessions WHERE runtime_instance_id=?")
			.all(first.ready.instanceId) as Array<{ runtime_state: string; runtime_instance_id: string }>;
		expect(dirtyOwner.state).toBe("active");
		expect(dirtySessions).toHaveLength(2);
		dirty.close();
		const second = await start(project);
		expect(second.ready.poolSize).toBe(1);
		expect(second.ready.foregroundSessionId).toBe(second.ready.canonicalSessionId);
		const database = db(project.root);
		const control = database
			.prepare("SELECT * FROM sessions WHERE session_id=?")
			.get(second.ready.canonicalSessionId) as { runtime_state: string; runtime_instance_id: string };
		const design = database.prepare("SELECT * FROM sessions WHERE session_file=?").get(designFile) as {
			runtime_state: string;
			runtime_instance_id: string | null;
		};
		const oldOwner = database
			.prepare("SELECT state FROM runtime_instances WHERE instance_id=?")
			.get(first.ready.instanceId) as { state: string };
		expect(oldOwner.state).toBe("closed");
		expect(control.runtime_state).toBe("active");
		expect(control.runtime_instance_id).toBe(second.ready.instanceId);
		expect(design.runtime_state).toBe("inactive");
		expect(design.runtime_instance_id).toBeNull();
		database.close();
		expect(await commandAndExit(second.child, "shutdown")).toBe(0);
		rmSync(project.base, { recursive: true, force: true });
	});

	it("rebuilds the catalog after database deletion and creates a new canonical Controller", async () => {
		const project = makeProject();
		const designFile = persistedSession(project.root, "design");
		const experimentsFile = persistedSession(project.root, "experiments");
		const first = await start(project);
		const original = { id: first.ready.canonicalSessionId, file: first.ready.sessionFile };
		const database = db(project.root);
		const controlDir = join(project.root, ".pi", "control");
		database.close();
		expect(await commandAndExit(first.child, "shutdown")).toBe(0);
		for (const suffix of ["", "-wal", "-shm"]) rmSync(join(controlDir, `control.sqlite3${suffix}`), { force: true });
		const second = await start(project);
		expect(second.ready.canonicalSessionId).not.toBe(original.id);
		expect(second.ready.sessionFile).not.toBe(original.file);
		expect(existsSync(original.file!)).toBe(true);
		expect(second.ready.poolSize).toBe(1);
		const rebuilt = db(project.root);
		const rows = rebuilt
			.prepare("SELECT session_id, session_file, runtime_state, runtime_instance_id FROM sessions")
			.all() as Array<{
			session_id: string;
			session_file: string;
			runtime_state: string;
			runtime_instance_id: string | null;
		}>;
		expect(rows.some((row) => row.session_file === designFile && row.runtime_state === "inactive")).toBe(true);
		expect(rows.some((row) => row.session_file === experimentsFile && row.runtime_state === "inactive")).toBe(true);
		expect(rows.find((row) => row.session_id === second.ready.canonicalSessionId)?.runtime_instance_id).toBe(
			second.ready.instanceId,
		);
		rebuilt.close();
		expect(await commandAndExit(second.child, "shutdown")).toBe(0);
		rmSync(project.base, { recursive: true, force: true });
	});

	it("stops heartbeat on clean shutdown", async () => {
		const project = makeProject();
		const first = await start(project);
		const database = db(project.root);
		const before = database
			.prepare("SELECT heartbeat_at FROM runtime_instances WHERE instance_id=?")
			.get(first.ready.instanceId) as { heartbeat_at: number };
		await new Promise((resolve) => setTimeout(resolve, 180));
		const after = database
			.prepare("SELECT heartbeat_at FROM runtime_instances WHERE instance_id=?")
			.get(first.ready.instanceId) as { heartbeat_at: number };
		expect(after.heartbeat_at).toBeGreaterThan(before.heartbeat_at);
		expect(await commandAndExit(first.child, "shutdown")).toBe(0);
		const closed = database
			.prepare("SELECT state, heartbeat_at FROM runtime_instances WHERE instance_id=?")
			.get(first.ready.instanceId) as { state: string; heartbeat_at: number };
		expect(closed.state).toBe("closed");
		await new Promise((resolve) => setTimeout(resolve, 180));
		const stopped = database
			.prepare("SELECT heartbeat_at FROM runtime_instances WHERE instance_id=?")
			.get(first.ready.instanceId) as { heartbeat_at: number };
		expect(stopped.heartbeat_at).toBe(closed.heartbeat_at);
		database.close();
		rmSync(project.base, { recursive: true, force: true });
	});
});
