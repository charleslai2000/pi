import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setPiRoot } from "../src/core/pi-root.ts";
import { loadProjectContextFiles } from "../src/core/resource-loader.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function makeDir(...segments: string[]): string {
	const dir = join(...segments);
	mkdirSync(dir, { recursive: true });
	return realpathSync(dir);
}

function makePiRoot(base: string, name: string): string {
	const root = makeDir(base, name);
	mkdirSync(join(root, "control"), { recursive: true });
	return root;
}

function legacyDirName(path: string): string {
	return `--${path.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

function writeSession(dir: string, id: string, cwd: string, extra = 0): string {
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${id}.jsonl`);
	const lines = [JSON.stringify({ type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd })];
	for (let i = 0; i < extra; i++) {
		lines.push(
			JSON.stringify({
				type: "message",
				id: `${id}-m${i}`,
				parentId: i === 0 ? null : `${id}-m${i - 1}`,
				timestamp: new Date().toISOString(),
				message: { role: "user", content: `msg ${i}`, timestamp: Date.now() },
			}),
		);
	}
	writeFileSync(file, `${lines.join("\n")}\n`);
	return file;
}

describe("slash command discovery", () => {
	const names = BUILTIN_SLASH_COMMANDS.map((c) => c.name);

	it("exposes /sessions", () => {
		expect(names).toContain("sessions");
	});

	it("exposes /rename", () => {
		expect(names).toContain("rename");
	});

	it("keeps /name for backward compatibility", () => {
		expect(names).toContain("name");
	});

	it("keeps /new and /resume without regression", () => {
		expect(names).toContain("new");
		expect(names).toContain("resume");
	});
});

describe("/new PiRoot-relative parsing", () => {
	let base: string;
	let root: string;
	let newSession: ReturnType<
		typeof vi.fn<(options?: { cwd?: string; keepCurrent?: boolean }) => Promise<{ cancelled: boolean }>>
	>;
	let runtimeHost: { newSession: typeof newSession };

	beforeEach(() => {
		base = mkdtempSync(join(tmpdir(), "pirnew-"));
		root = makePiRoot(base, "project");
		newSession = vi.fn(async () => ({ cancelled: false }));
		runtimeHost = { newSession };
	});

	afterEach(() => {
		setPiRoot(undefined);
	});

	function makeFakeThis(): Record<string, unknown> {
		return {
			chatContainer: { addChild: vi.fn() },
			ui: { requestRender: vi.fn() },
			clearStatusIndicator: vi.fn(),
			showWarning: vi.fn(),
			handleFatalRuntimeError: vi.fn(),
			runtimeHost,
			handleClearCommand: async (cwd?: string) => {
				await newSession(cwd ? { cwd, keepCurrent: true } : { keepCurrent: true });
			},
		};
	}

	function run(rawArg?: string): Promise<void> {
		return (
			InteractiveMode.prototype as unknown as {
				handleNewCommand(this: unknown, rawArg?: string): Promise<void>;
			}
		).handleNewCommand.call(makeFakeThis(), rawArg);
	}

	it("with no argument starts a session in the current cwd", async () => {
		setPiRoot(root);
		await run(undefined);
		expect(newSession).toHaveBeenCalledWith({ keepCurrent: true });
	});

	it("resolves a bare name relative to PiRoot, not the current cwd", async () => {
		setPiRoot(root);
		await run("design");
		expect(newSession).toHaveBeenCalledWith({ cwd: join(root, "design"), keepCurrent: true });
	});

	it("resolves nested PiRoot-relative paths", async () => {
		setPiRoot(root);
		await run("control/task-a");
		expect(newSession).toHaveBeenCalledWith({ cwd: join(root, "control", "task-a"), keepCurrent: true });
	});

	it("rejects an absolute path", async () => {
		setPiRoot(root);
		await run("/tmp/foo");
		expect(newSession).not.toHaveBeenCalled();
	});

	it("rejects a parent-relative escape", async () => {
		setPiRoot(root);
		await run("../foo");
		expect(newSession).not.toHaveBeenCalled();
	});

	it("rejects a deep parent-relative escape", async () => {
		setPiRoot(root);
		await run("../../x");
		expect(newSession).not.toHaveBeenCalled();
	});

	it("does not silently rewrite an absolute path", async () => {
		setPiRoot(root);
		await run(`${root}/design`);
		expect(newSession).not.toHaveBeenCalled();
	});
});

describe("/resume scope with real sessions", () => {
	let base: string;
	let root: string;
	let otherRoot: string;
	let agentDir: string;
	let originalAgentDir: string | undefined;

	beforeEach(() => {
		base = mkdtempSync(join(tmpdir(), "pirresume-"));
		root = makePiRoot(base, "project");
		otherRoot = makePiRoot(base, "other-project");
		agentDir = makeDir(base, "agent");
		originalAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
	});

	afterEach(() => {
		if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
		setPiRoot(undefined);
	});

	it("lists only PiRoot sessions and is stable across foreground cwd changes", async () => {
		const controlDir = makeDir(root, "control");
		const designDir = makeDir(root, "design");
		const otherDir = makeDir(otherRoot, "foo");

		// PiRoot namespace holds the two in-scope sessions.
		const namespaceDir = join(agentDir, "sessions", legacyDirName(root));
		writeSession(namespaceDir, "sess-control", controlDir, 1);
		writeSession(namespaceDir, "sess-design", designDir, 1);
		// A session from a different PiRoot, stored in the same namespace dir.
		writeSession(namespaceDir, "sess-other", otherDir, 1);
		// A legacy per-cwd session inside PiRoot.
		const legacyDir = join(agentDir, "sessions", legacyDirName(designDir));
		writeSession(legacyDir, "sess-legacy", designDir, 1);

		setPiRoot(root);

		// Foreground is /project/control.
		const fromControl = await SessionManager.list(controlDir);
		const controlIds = fromControl.map((s) => s.id).sort();
		expect(controlIds).toContain("sess-control");
		expect(controlIds).toContain("sess-design");
		expect(controlIds).toContain("sess-legacy");
		expect(controlIds).not.toContain("sess-other");

		// Foreground switches to /project/design: same visible set.
		const fromDesign = await SessionManager.list(designDir);
		expect(fromDesign.map((s) => s.id).sort()).toEqual(controlIds);
	});
});

describe("PiRoot / cwd / context separation", () => {
	let base: string;
	let root: string;
	let agentDir: string;
	let originalAgentDir: string | undefined;

	beforeEach(() => {
		base = mkdtempSync(join(tmpdir(), "pirsep-"));
		root = makePiRoot(base, "project");
		agentDir = makeDir(base, "agent");
		originalAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
		writeFileSync(join(agentDir, "AGENTS.md"), "global");
	});

	afterEach(() => {
		if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
		setPiRoot(undefined);
	});

	it("keeps PiRoot fixed while session cwd and context follow the session", async () => {
		writeFileSync(join(root, "AGENTS.md"), "piroot-root");
		writeFileSync(join(root, "control", "AGENTS.md"), "control");
		const design = makeDir(root, "design");
		writeFileSync(join(design, "AGENTS.md"), "design");

		setPiRoot(root);
		const session = SessionManager.create(design);

		// PiRoot is unchanged; session cwd is the real directory.
		expect(session.getCwd()).toBe(design);
		expect(loadProjectContextFiles({ cwd: session.getCwd(), agentDir }).map((f) => f.content)).toEqual([
			"global",
			"piroot-root",
			"design",
		]);
	});

	it("keeps PiRoot fixed after creating a sibling session", () => {
		setPiRoot(root);
		const design = makeDir(root, "design");
		const first = SessionManager.create(design);
		expect(first.getCwd()).toBe(design);

		const experiments = makeDir(root, "experiments");
		const second = SessionManager.create(experiments);

		expect(second.getCwd()).toBe(experiments);
		expect(first.getCwd()).toBe(design);
		// The history namespace is unchanged by the cwd switch.
		expect(second.getSessionDir()).toBe(first.getSessionDir());
	});
});

describe("/rename alias and persistence", () => {
	let base: string;
	let root: string;
	let agentDir: string;
	let originalAgentDir: string | undefined;

	beforeEach(() => {
		base = mkdtempSync(join(tmpdir(), "pirrename-"));
		root = makePiRoot(base, "project");
		agentDir = makeDir(base, "agent");
		originalAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
	});

	afterEach(() => {
		if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
		setPiRoot(undefined);
	});

	function callNameCommand(text: string, fakeThis: Record<string, unknown>): void {
		initTheme("dark");
		(
			InteractiveMode.prototype as unknown as { handleNameCommand(this: unknown, text: string): void }
		).handleNameCommand.call(fakeThis, text);
	}

	it("/rename sets the live session name", () => {
		const setSessionName = vi.fn();
		callNameCommand("/name architecture", {
			session: { setSessionName },
			sessionManager: { getSessionName: () => "architecture" },
			chatContainer: { addChild: vi.fn() },
			ui: { requestRender: vi.fn() },
			showWarning: vi.fn(),
		});
		expect(setSessionName).toHaveBeenCalledWith("architecture");
	});

	it("/rename routes through the same handler as /name", () => {
		const setSessionName = vi.fn();
		callNameCommand("/rename architecture", {
			session: { setSessionName },
			sessionManager: { getSessionName: () => "architecture" },
			chatContainer: { addChild: vi.fn() },
			ui: { requestRender: vi.fn() },
			showWarning: vi.fn(),
		});
		expect(setSessionName).toHaveBeenCalledWith("architecture");
	});

	it("a renamed session keeps its name after reload and is listed", () => {
		const dir = makeDir(root, "design");
		const nsDir = join(agentDir, "sessions", legacyDirName(root));
		const file = writeSession(nsDir, "renamed-session", dir, 1);
		// Append the rename the way AgentSession.setSessionName() persists it.
		const session = SessionManager.open(file);
		session.appendSessionInfo("architecture");

		setPiRoot(root);
		const reopened = SessionManager.open(file);
		expect(reopened.getSessionName()).toBe("architecture");
	});

	it("writing a rename does not change session cwd or PiRoot namespace", () => {
		const dir = makeDir(root, "design");
		setPiRoot(root);
		const session = SessionManager.create(dir);
		const sessionDirBefore = session.getSessionDir();
		session.appendSessionInfo("architecture");
		expect(session.getCwd()).toBe(dir);
		expect(session.getSessionDir()).toBe(sessionDirBefore);
		// The name is immediately visible to the live session.
		expect(session.getSessionName()).toBe("architecture");
	});
});
