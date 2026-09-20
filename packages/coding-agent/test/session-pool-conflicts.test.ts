import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionPool } from "../src/core/session-pool.ts";

function fakeSession(tools: string[]) {
	let listener: ((event: any) => void) | undefined;
	return {
		isStreaming: false,
		sessionFile: undefined,
		agent: { state: { tools: tools.map((name) => ({ name })) } },
		subscribe(next: (event: any) => void) {
			listener = next;
			return () => {
				listener = undefined;
			};
		},
		start() {
			listener?.({ type: "agent_start" });
		},
		settle() {
			listener?.({ type: "agent_settled" });
		},
		end(stopReason = "stop") {
			listener?.({ type: "agent_end", willRetry: false, messages: [{ role: "assistant", stopReason }] });
		},
	} as any;
}

function services(cwd: string) {
	return { cwd } as any;
}

function initGit(cwd: string): void {
	execFileSync("git", ["-C", cwd, "init", "-q"]);
}

describe("SessionPool worktree conflicts", () => {
	it("warns once for same worktree, resets after idle, and aggregates three slots", () => {
		const root = join(tmpdir(), `pi-conflict-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const cwdA = join(root, "repo");
		const cwdB = join(cwdA, "subdir");
		mkdirSync(cwdB, { recursive: true });
		initGit(cwdA);
		const pool = new SessionPool();
		const events: any[] = [];
		pool.subscribeActivity((event) => events.push(event));
		const a = fakeSession(["write"]);
		const b = fakeSession(["edit"]);
		const c = fakeSession(["bash"]);
		const slotA = pool.adopt(a, services(cwdA));
		const slotB = pool.adopt(b, services(cwdB));
		const slotC = pool.adopt(c, services(cwdA));

		a.start();
		b.start();
		c.start();
		expect(events.filter((event) => event.type === "conflict")).toHaveLength(1);
		expect((events.find((event) => event.type === "conflict") as any).slots).toHaveLength(2);
		b.settle();
		c.settle();
		a.settle();
		b.start();
		c.start();
		expect(events.filter((event) => event.type === "conflict")).toHaveLength(2);
		expect(slotA.gitWorktreeRoot).toBe(slotB.gitWorktreeRoot);
		expect(slotA.gitWorktreeRoot).toBe(slotC.gitWorktreeRoot);
		rmSync(root, { recursive: true, force: true });
	});

	it("does not warn for linked worktrees or different repositories", () => {
		const root = join(tmpdir(), `pi-worktrees-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const repo = join(root, "repo");
		const linked = join(root, "repo-feature");
		const other = join(root, "repo-other");
		mkdirSync(repo, { recursive: true });
		mkdirSync(other, { recursive: true });
		initGit(repo);
		initGit(other);
		execFileSync("git", ["-C", repo, "commit", "--allow-empty", "-m", "initial"], {
			env: {
				...process.env,
				GIT_AUTHOR_NAME: "Test",
				GIT_AUTHOR_EMAIL: "test@example.com",
				GIT_COMMITTER_NAME: "Test",
				GIT_COMMITTER_EMAIL: "test@example.com",
			},
		});
		execFileSync("git", ["-C", repo, "worktree", "add", "-q", "-b", "feature", linked]);
		const linkedRoot = execFileSync("git", ["-C", linked, "rev-parse", "--show-toplevel"], {
			encoding: "utf8",
		}).trim();
		const repoRoot = execFileSync("git", ["-C", repo, "rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
		expect(repoRoot).not.toBe(linkedRoot);
		const pool = new SessionPool();
		const events: any[] = [];
		pool.subscribeActivity((event) => events.push(event));
		const a = fakeSession(["write"]);
		const b = fakeSession(["edit"]);
		const c = fakeSession(["bash"]);
		const slotA = pool.adopt(a, services(repo));
		const slotB = pool.adopt(b, services(linked));
		const slotC = pool.adopt(c, services(other));
		a.start();
		b.start();
		c.start();
		expect(slotA.gitWorktreeRoot).not.toBe(slotB.gitWorktreeRoot);
		expect(slotA.gitWorktreeRoot).not.toBe(slotC.gitWorktreeRoot);
		expect(events.filter((event) => event.type === "conflict")).toHaveLength(0);
		execFileSync("git", ["-C", repo, "worktree", "remove", "-f", linked]);
		rmSync(root, { recursive: true, force: true });
	});

	it("suppression is one-shot and close removes the conflict episode", () => {
		const root = join(tmpdir(), `pi-suppression-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		mkdirSync(root, { recursive: true });
		initGit(root);
		const pool = new SessionPool();
		const events: any[] = [];
		pool.subscribeActivity((event) => events.push(event));
		const a = fakeSession(["write"]);
		const b = fakeSession(["edit"]);
		const slotA = pool.adopt(a, services(root));
		const slotB = pool.adopt(b, services(root));
		pool.setForeground(slotB.id);
		a.start();
		b.start();
		expect(events.filter((event) => event.type === "conflict")).toHaveLength(1);
		pool.suppressCompletion(slotA.id);
		a.end();
		a.settle();
		expect(events.filter((event) => event.type === "completed")).toHaveLength(0);
		a.start();
		a.end();
		a.settle();
		expect(events.filter((event) => event.type === "completed")).toHaveLength(1);
		b.settle();
		pool.setForeground(slotA.id);
		pool.remove(slotB.id);
		expect(events.filter((event) => event.type === "conflict")).toHaveLength(1);
		rmSync(root, { recursive: true, force: true });
	});

	it("does not warn for non-git directories or read-only active tools", () => {
		const root = join(tmpdir(), `pi-no-conflict-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const cwdA = join(root, "a");
		const cwdB = join(root, "b");
		mkdirSync(cwdA, { recursive: true });
		mkdirSync(cwdB, { recursive: true });
		const pool = new SessionPool();
		const events: any[] = [];
		pool.subscribeActivity((event) => events.push(event));
		const a = fakeSession(["read"]);
		const b = fakeSession(["read"]);
		pool.adopt(a, services(cwdA));
		pool.adopt(b, services(cwdB));
		a.start();
		b.start();
		expect(events.some((event) => event.type === "conflict")).toBe(false);
		rmSync(root, { recursive: true, force: true });
	});
});
