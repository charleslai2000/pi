import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	hasPiRootMarker,
	isPathInsidePiRoot,
	PiRootNotFoundError,
	PiRootPathError,
	resolvePiRoot,
	resolvePiRootRelativePath,
	setPiRoot,
} from "../src/core/pi-root.ts";
import { loadProjectContextFiles } from "../src/core/resource-loader.ts";
import { SessionManager } from "../src/core/session-manager.ts";

/** Create a directory tree, return its realpath (macOS /tmp is a symlink). */
function makeDir(...segments: string[]): string {
	const dir = join(...segments);
	mkdirSync(dir, { recursive: true });
	return realpathSync(dir);
}

/** Create a PiRoot: a directory containing a `control/` marker. */
function makePiRoot(base: string, name: string): string {
	const root = makeDir(base, name);
	mkdirSync(join(root, "control"), { recursive: true });
	return root;
}

/** Write a session JSONL file with an explicit header cwd. */
function writeSession(dir: string, id: string, cwd: string, extraEntries = 0): string {
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_${id}.jsonl`);
	const lines = [JSON.stringify({ type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd })];
	for (let i = 0; i < extraEntries; i++) {
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

/** Replicate the legacy per-cwd session directory encoding. */
function legacyDirName(path: string): string {
	return `--${path.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

describe("PiRoot resolution", () => {
	let base: string;
	beforeEach(() => {
		base = mkdtempSync(join(tmpdir(), "piroot-"));
	});
	afterEach(() => {
		setPiRoot(undefined);
	});

	it("resolves to the nearest ancestor containing control/", () => {
		const root = makePiRoot(base, "project");
		const nested = makeDir(root, "design", "sub");
		expect(resolvePiRoot({ cwd: nested })).toBe(root);
	});

	it("resolves from the control directory itself", () => {
		const root = makePiRoot(base, "project");
		expect(resolvePiRoot({ cwd: join(root, "control") })).toBe(root);
	});

	it("honors an explicit --root", () => {
		makePiRoot(base, "project");
		const other = makePiRoot(base, "workspace");
		expect(resolvePiRoot({ explicitRoot: other, cwd: base })).toBe(other);
	});

	it("rejects an explicit --root without control/", () => {
		const plain = makeDir(base, "plain");
		expect(() => resolvePiRoot({ explicitRoot: plain, cwd: base })).toThrow(PiRootNotFoundError);
	});

	it("rejects a nonexistent explicit --root", () => {
		expect(() => resolvePiRoot({ explicitRoot: join(base, "nope"), cwd: base })).toThrow(PiRootNotFoundError);
	});

	it("throws when no ancestor contains control/", () => {
		const plain = makeDir(base, "plain", "deep");
		expect(() => resolvePiRoot({ cwd: plain })).toThrow(PiRootNotFoundError);
	});

	it("resolves through a symlinked cwd", () => {
		const root = makePiRoot(base, "project");
		const real = makeDir(root, "real");
		const link = join(base, "link");
		symlinkSync(real, link);
		expect(resolvePiRoot({ cwd: link })).toBe(root);
	});

	it("hasPiRootMarker only accepts a control directory", () => {
		const root = makePiRoot(base, "project");
		expect(hasPiRootMarker(root)).toBe(true);
		writeFileSync(join(base, "filecontrol"), "");
		expect(hasPiRootMarker(base)).toBe(false);
	});
});

describe("PiRoot containment", () => {
	let base: string;
	let root: string;
	beforeEach(() => {
		base = mkdtempSync(join(tmpdir(), "piroot-"));
		root = makePiRoot(base, "project");
		setPiRoot(root);
	});
	afterEach(() => {
		setPiRoot(undefined);
	});

	it("accepts the root itself and descendants", () => {
		expect(isPathInsidePiRoot(root)).toBe(true);
		expect(isPathInsidePiRoot(join(root, "design"))).toBe(true);
		expect(isPathInsidePiRoot(join(root, "design", "sub"))).toBe(true);
	});

	it("rejects the parent and siblings", () => {
		expect(isPathInsidePiRoot(base)).toBe(false);
		expect(isPathInsidePiRoot(join(base, "sibling"))).toBe(false);
		// Prefix trick: /base/project-other must not match /base/project.
		expect(isPathInsidePiRoot(`${root}-other`)).toBe(false);
	});

	it("rejects a path escaping via ..", () => {
		expect(isPathInsidePiRoot(join(root, "..", "outside"))).toBe(false);
	});

	it("rejects a symlink escaping the root", () => {
		const outside = makeDir(base, "outside");
		const link = join(root, "escape");
		symlinkSync(outside, link);
		expect(isPathInsidePiRoot(link)).toBe(false);
	});

	it("resolvePiRootRelativePath rejects absolute input", () => {
		expect(() => resolvePiRootRelativePath("/etc")).toThrow(PiRootPathError);
	});

	it("resolvePiRootRelativePath rejects .. escape", () => {
		expect(() => resolvePiRootRelativePath("../outside")).toThrow(PiRootPathError);
	});

	it("resolvePiRootRelativePath accepts nested dirs", () => {
		expect(resolvePiRootRelativePath("design/sub")).toBe(join(root, "design", "sub"));
	});
});

describe("SessionManager containment", () => {
	let base: string;
	let root: string;
	let outside: string;
	beforeEach(() => {
		base = mkdtempSync(join(tmpdir(), "piroot-"));
		root = makePiRoot(base, "project");
		outside = makeDir(base, "outside");
		setPiRoot(root);
	});
	afterEach(() => {
		setPiRoot(undefined);
	});

	it("create accepts a cwd inside PiRoot", () => {
		const session = SessionManager.create(join(root, "design"));
		expect(session.getCwd()).toBe(join(root, "design"));
	});

	it("create rejects a cwd outside PiRoot", () => {
		expect(() => SessionManager.create(outside)).toThrow(PiRootPathError);
	});

	it("create rejects a symlink escape", () => {
		const link = join(root, "escape");
		symlinkSync(outside, link);
		expect(() => SessionManager.create(link)).toThrow(PiRootPathError);
	});

	it("open rejects a session whose header cwd is outside PiRoot", () => {
		const file = writeSession(outside, "outside-session", outside);
		expect(() => SessionManager.open(file)).toThrow(PiRootPathError);
	});

	it("open accepts a session whose header cwd is inside PiRoot", () => {
		const insideDir = makeDir(root, "design");
		const file = writeSession(insideDir, "inside-session", insideDir);
		const session = SessionManager.open(file);
		expect(session.getCwd()).toBe(insideDir);
	});

	it("open rejects an external cwdOverride", () => {
		const insideDir = makeDir(root, "design");
		const file = writeSession(insideDir, "ovr-session", insideDir);
		expect(() => SessionManager.open(file, undefined, outside)).toThrow(PiRootPathError);
	});

	it("forkFrom rejects a target cwd outside PiRoot", () => {
		const insideDir = makeDir(root, "design");
		const src = writeSession(insideDir, "src-session", insideDir, 1);
		expect(() => SessionManager.forkFrom(src, outside)).toThrow(PiRootPathError);
	});
});

describe("Shared custom sessionDir respects PiRoot scope", () => {
	let base: string;
	let rootA: string;
	let rootB: string;
	let sharedDir: string;
	beforeEach(() => {
		base = mkdtempSync(join(tmpdir(), "piroot-"));
		rootA = makePiRoot(base, "rootA");
		rootB = makePiRoot(base, "rootB");
		sharedDir = makeDir(base, "shared-sessions");
		// Mixed storage: one session from each PiRoot in the same directory.
		writeSession(sharedDir, "session-a", makeDir(rootA, "design"), 1);
		writeSession(sharedDir, "session-b", makeDir(rootB, "design"), 1);
	});
	afterEach(() => {
		setPiRoot(undefined);
	});

	it("list only returns sessions from the active PiRoot", async () => {
		setPiRoot(rootA);
		const sessions = await SessionManager.list(rootA, sharedDir);
		expect(sessions.map((s) => s.id)).toContain("session-a");
		expect(sessions.map((s) => s.id)).not.toContain("session-b");
	});

	it("findById cannot reach a session from another PiRoot", () => {
		setPiRoot(rootA);
		expect(SessionManager.findById(rootA, "session-a", sharedDir)).toBeDefined();
		expect(SessionManager.findById(rootA, "session-b", sharedDir)).toBeUndefined();
	});

	it("continueRecent picks a session from the active PiRoot only", () => {
		// Make rootB's session newer so mtime ordering cannot accidentally "pass".
		const bFile = join(sharedDir, readdirSync(sharedDir).find((f) => f.includes("session-b"))!);
		writeFileSync(bFile, `${readFileSync(bFile, "utf-8")}${readFileSync(bFile, "utf-8")}`);

		setPiRoot(rootA);
		const session = SessionManager.continueRecent(rootA, sharedDir);
		expect(session.getSessionFile()).toBeDefined();
		expect(session.getSessionFile()).toContain("session-a");
	});

	it("switching PiRoot switches visible sessions", async () => {
		setPiRoot(rootB);
		const sessions = await SessionManager.list(rootB, sharedDir);
		expect(sessions.map((s) => s.id)).toContain("session-b");
		expect(sessions.map((s) => s.id)).not.toContain("session-a");
	});
});

describe("Legacy per-cwd history", () => {
	let base: string;
	let root: string;
	let agentDir: string;
	let originalAgentDir: string | undefined;
	beforeEach(() => {
		base = mkdtempSync(join(tmpdir(), "piroot-"));
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

	it("legacy session inside PiRoot is visible, outside is not", async () => {
		const insideDir = makeDir(root, "design");
		const legacyInside = join(agentDir, "sessions", legacyDirName(insideDir));
		writeSession(legacyInside, "legacy-inside", insideDir, 1);

		const otherRoot = makePiRoot(base, "otherProject");
		const otherDir = makeDir(otherRoot, "design");
		const legacyOutside = join(agentDir, "sessions", legacyDirName(otherDir));
		writeSession(legacyOutside, "legacy-outside", otherDir, 1);

		setPiRoot(root);
		const sessions = await SessionManager.list(root);
		const ids = sessions.map((s) => s.id);
		expect(ids).toContain("legacy-inside");
		expect(ids).not.toContain("legacy-outside");
	});

	it("findById and continueRecent agree with list on legacy sessions", async () => {
		const insideDir = makeDir(root, "design");
		const legacyDir = join(agentDir, "sessions", legacyDirName(insideDir));
		writeSession(legacyDir, "legacy-consistency", insideDir, 1);

		setPiRoot(root);
		const listed = await SessionManager.list(root);
		const found = SessionManager.findById(root, "legacy-consistency");
		const continued = SessionManager.continueRecent(root);

		expect(listed.map((s) => s.id)).toContain("legacy-consistency");
		expect(found).toBeDefined();
		expect(continued.getSessionFile()).toBeDefined();
	});

	it("resuming a legacy session never appends to the legacy file and continues in the PiRoot namespace", () => {
		const insideDir = makeDir(root, "design");
		const legacyDir = join(agentDir, "sessions", legacyDirName(insideDir));
		const legacyFile = writeSession(legacyDir, "legacy-migrate", insideDir, 2);
		const before = readFileSync(legacyFile, "utf-8");

		setPiRoot(root);
		const session = SessionManager.open(legacyFile);

		// Legacy file is byte-for-byte unchanged.
		expect(readFileSync(legacyFile, "utf-8")).toBe(before);

		// Continued session lives in the PiRoot namespace, not the legacy dir.
		const activeFile = session.getSessionFile();
		expect(activeFile).toBeDefined();
		expect(activeFile!.startsWith(join(agentDir, "sessions"))).toBe(true);
		expect(activeFile).not.toBe(legacyFile);
		expect(legacyDirName(root)).toBe(
			activeFile!.split("/sessions/")[1]!.slice(0, activeFile!.split("/sessions/")[1]!.indexOf("/")),
		);

		// History and lineage are preserved.
		const lines = readFileSync(activeFile!, "utf-8")
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l));
		expect(lines[0].cwd).toBe(insideDir);
		expect(lines[0].parentSession).toBe(legacyFile);
		expect(lines.filter((e: { type: string }) => e.type === "message").length).toBe(2);
	});

	it("a session already in the PiRoot namespace is opened in place", () => {
		const insideDir = makeDir(root, "design");
		const namespaceDir = join(agentDir, "sessions", legacyDirName(root));
		const file = writeSession(namespaceDir, "already-namespaced", insideDir, 1);

		setPiRoot(root);
		const session = SessionManager.open(file);
		expect(session.getSessionFile()).toBe(file);
		expect(existsSync(file)).toBe(true);
	});
});

describe("cwd ancestry context", () => {
	let base: string;
	let root: string;
	let agentDir: string;
	let originalAgentDir: string | undefined;
	beforeEach(() => {
		base = mkdtempSync(join(tmpdir(), "piroot-"));
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

	it("loads only the PiRoot and cwd ancestry for a design session", () => {
		writeFileSync(join(root, "AGENTS.md"), "piroot-root");
		writeFileSync(join(root, "control", "AGENTS.md"), "control");
		const design = makeDir(root, "design");
		writeFileSync(join(design, "AGENTS.md"), "design");

		const files = loadProjectContextFiles({ cwd: design, agentDir });
		expect(files.map((f) => f.content)).toEqual(["global", "piroot-root", "design"]);
	});

	it("loads control/AGENTS.md only when cwd is inside control", () => {
		writeFileSync(join(root, "AGENTS.md"), "piroot-root");
		writeFileSync(join(root, "control", "AGENTS.md"), "control");

		const files = loadProjectContextFiles({ cwd: join(root, "control"), agentDir });
		expect(files.map((f) => f.content)).toEqual(["global", "piroot-root", "control"]);
		expect(files.filter((f) => f.content === "control")).toHaveLength(1);
	});

	it("dedupes by canonical path across a symlinked cwd alias", () => {
		writeFileSync(join(root, "control", "AGENTS.md"), "control");
		const design = makeDir(root, "design");
		writeFileSync(join(design, "AGENTS.md"), "design");
		const alias = join(base, "design-alias");
		symlinkSync(design, alias);

		const direct = loadProjectContextFiles({ cwd: design, agentDir });
		const viaAlias = loadProjectContextFiles({ cwd: alias, agentDir });
		expect(viaAlias.map((f) => f.content)).toEqual(direct.map((f) => f.content));
		expect(viaAlias.map((f) => f.content)).toEqual(["global", "design"]);
	});

	it("does not change ResourceLoader cwd semantics (only context assembly)", () => {
		// Sanity: cwd stays the real session cwd, never the PiRoot.
		writeFileSync(join(root, "control", "AGENTS.md"), "control");
		const design = makeDir(root, "design");
		writeFileSync(join(design, "AGENTS.md"), "design");
		const files = loadProjectContextFiles({ cwd: design, agentDir });
		expect(files.some((f) => f.path === join(design, "AGENTS.md"))).toBe(true);
	});
});
