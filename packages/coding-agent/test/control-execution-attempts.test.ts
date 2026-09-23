import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	ExecutionAttemptError,
	getExecutionAttempt,
	listTaskAttempts,
	readExecutionAttempts,
	recordAttemptResult,
	recordAttemptStarted,
	recordAttemptTerminal,
	setExecutionAttemptClockForTesting,
	setExecutionAttemptIdForTesting,
	taskContentSha256,
} from "../src/core/control/execution-attempts.ts";
import { setPiRoot } from "../src/core/pi-root.ts";
import { getDefaultSessionDir } from "../src/core/session-manager.ts";

function fixture(): { root: string; sessionId: string; taskPath: string } {
	const root = mkdtempSync(join("/tmp", "pi-attempts-"));
	const taskDir = join(root, "control", "goal-a", "tasks");
	mkdirSync(taskDir, { recursive: true });
	writeFileSync(join(root, "control", "goal-a", "goal.md"), "# Goal A\n");
	const taskPath = join(taskDir, "T001-work.md");
	writeFileSync(taskPath, "Status: ACTIVE\nObjective: do work\n");
	setPiRoot(root, "formal");
	const sessionId = "session-a";
	const sessionDir = getDefaultSessionDir(root);
	const cwd = join(root, "work");
	mkdirSync(cwd);
	writeFileSync(
		join(sessionDir, `${sessionId}.jsonl`),
		`${JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: new Date().toISOString(), cwd })}\n`,
	);
	return { root, sessionId, taskPath };
}

afterEach(() => {
	setPiRoot(undefined);
	setExecutionAttemptIdForTesting(undefined);
	setExecutionAttemptClockForTesting(undefined);
});

describe("durable execution attempts", () => {
	it("bootstraps, records open/terminal attempts, and preserves task revision hash", async () => {
		const value = fixture();
		expect(readExecutionAttempts(value.root).attempts).toEqual([]);
		setExecutionAttemptIdForTesting(() => "attempt-1");
		setExecutionAttemptClockForTesting(() => "2026-01-01T00:00:00.000Z");
		const started = await recordAttemptStarted(value.root, {
			goalId: "goal-a",
			taskId: "T001",
			sessionId: value.sessionId,
		});
		expect(started.taskContentSha256).toBe(taskContentSha256(readFileSync(value.taskPath, "utf8")));
		expect(readExecutionAttempts(value.root).attempts[0]?.outcome).toBeUndefined();
		const settled = await recordAttemptTerminal(value.root, {
			attemptId: "attempt-1",
			type: "settled",
			at: "2026-01-01T00:01:00.000Z",
		});
		expect(settled.outcome).toBe("settled");
		writeFileSync(value.taskPath, "Status: DONE\nObjective: changed\n");
		expect(readExecutionAttempts(value.root).attempts[0]?.taskContentSha256).toBe(started.taskContentSha256);
	});

	it("supports multiple attempts and distinct historical Sessions", async () => {
		const value = fixture();
		const second = "session-b";
		writeFileSync(
			join(getDefaultSessionDir(value.root), `${second}.jsonl`),
			`${JSON.stringify({ type: "session", version: 3, id: second, timestamp: new Date().toISOString(), cwd: value.root })}\n`,
		);
		await recordAttemptStarted(value.root, {
			attemptId: "a1",
			goalId: "goal-a",
			taskId: "T001",
			sessionId: value.sessionId,
			at: "2026-01-01T00:00:00Z",
		});
		await recordAttemptTerminal(value.root, { attemptId: "a1", type: "failed", at: "2026-01-01T00:01:00Z" });
		await recordAttemptStarted(value.root, {
			attemptId: "a2",
			goalId: "goal-a",
			taskId: "T001",
			sessionId: second,
			at: "2026-01-02T00:00:00Z",
		});
		expect(
			listTaskAttempts(readExecutionAttempts(value.root), "goal-a", "T001").map((attempt) => attempt.sessionId),
		).toEqual([value.sessionId, second]);
		expect(getExecutionAttempt(readExecutionAttempts(value.root), "a2")?.outcome).toBeUndefined();
	});

	it("rejects malformed lifecycle, identity, references, and unknown fields", async () => {
		const value = fixture();
		await expect(recordAttemptTerminal(value.root, { attemptId: "missing", type: "aborted" })).rejects.toThrow(
			ExecutionAttemptError,
		);
		const path = join(value.root, "control", "execution-attempts.jsonl");
		const start = {
			version: 1,
			type: "started",
			attemptId: "a1",
			goalId: "goal-a",
			taskId: "T001",
			sessionId: value.sessionId,
			at: "2026-01-01T00:00:00Z",
			taskContentSha256: "0".repeat(64),
		};
		writeFileSync(path, `${JSON.stringify({ ...start, extra: true })}\n`);
		expect(() => readExecutionAttempts(value.root)).toThrow(ExecutionAttemptError);
		writeFileSync(path, `${JSON.stringify({ ...start, type: "failed" })}\n`);
		expect(() => readExecutionAttempts(value.root)).toThrow(ExecutionAttemptError);
		writeFileSync(
			path,
			`${JSON.stringify(start)}\n${JSON.stringify({ version: 1, type: "failed", attemptId: "a1", goalId: "goal-a", taskId: "T002", sessionId: value.sessionId, at: "2026-01-01T00:01:00Z" })}\n`,
		);
		expect(() => readExecutionAttempts(value.root)).toThrow(ExecutionAttemptError);
	});

	it("retains valid prefix when the final JSONL line is torn", async () => {
		const value = fixture();
		await recordAttemptStarted(value.root, {
			attemptId: "a1",
			goalId: "goal-a",
			taskId: "T001",
			sessionId: value.sessionId,
		});
		const path = join(value.root, "control", "execution-attempts.jsonl");
		const valid = readFileSync(path, "utf8");
		writeFileSync(path, `${valid}{"version":1,"type":"started"`);
		expect(readExecutionAttempts(value.root).attempts).toHaveLength(1);
		rmSync(value.root, { recursive: true, force: true });
	});

	it("appends concurrent starts without loss and is independent of Registry", async () => {
		const value = fixture();
		const results = await Promise.allSettled([
			recordAttemptStarted(value.root, {
				attemptId: "a1",
				goalId: "goal-a",
				taskId: "T001",
				sessionId: value.sessionId,
			}),
			recordAttemptStarted(value.root, {
				attemptId: "a2",
				goalId: "goal-a",
				taskId: "T001",
				sessionId: value.sessionId,
			}),
		]);
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
		expect(readExecutionAttempts(value.root).attempts).toHaveLength(1);
		rmSync(join(value.root, "control", "state"), { recursive: true, force: true });
		expect(readExecutionAttempts(value.root).attempts).toHaveLength(1);
	});

	it("allocates V2 sequence numbers and preserves legacy UUID history", async () => {
		const value = fixture();
		const path = join(value.root, "control", "execution-attempts.jsonl");
		writeFileSync(
			path,
			`${JSON.stringify({ version: 1, type: "started", attemptId: "legacy", goalId: "goal-a", taskId: "T001", sessionId: value.sessionId, at: "2026-01-01T00:00:00Z", taskContentSha256: "0".repeat(64) })}\n${JSON.stringify({ version: 1, type: "aborted", attemptId: "legacy", goalId: "goal-a", taskId: "T001", sessionId: value.sessionId, at: "2026-01-01T00:01:00Z" })}\n`,
		);
		const first = await recordAttemptStarted(value.root, {
			goalId: "goal-a",
			taskId: "T001",
			sessionId: value.sessionId,
		});
		expect(first.executionSno).toBe(1);
		expect(first.executionNo).toBe("T001-0001");
		expect(first.kind).toBe("normal");
		await recordAttemptTerminal(value.root, { attemptId: first.attemptId, type: "settled" });
		const second = await recordAttemptStarted(value.root, {
			goalId: "goal-a",
			taskId: "T001",
			sessionId: value.sessionId,
			kind: "review",
		});
		expect(second.executionSno).toBe(2);
		expect(second.executionNo).toBe("T001-0002");
		expect(second.kind).toBe("review");
	});

	it("blocks a legacy open attempt", async () => {
		const value = fixture();
		await recordAttemptStarted(value.root, {
			attemptId: "legacy-open",
			goalId: "goal-a",
			taskId: "T001",
			sessionId: value.sessionId,
		});
		await expect(
			recordAttemptStarted(value.root, { goalId: "goal-a", taskId: "T001", sessionId: value.sessionId }),
		).rejects.toThrow("unresolved open execution");
	});

	it("persists and aggregates one result report independently of terminal outcome", async () => {
		const value = fixture();
		const started = await recordAttemptStarted(value.root, {
			goalId: "goal-a",
			taskId: "T001",
			sessionId: value.sessionId,
		});
		const reported = await recordAttemptResult(value.root, {
			attemptId: started.attemptId,
			disposition: "complete",
			summary: "artifact ready",
		});
		expect(reported.completion).toBe("complete");
		expect(readExecutionAttempts(value.root).attempts[0]).toMatchObject({
			completion: "complete",
			completionSummary: "artifact ready",
		});
		await expect(
			recordAttemptResult(value.root, { attemptId: started.attemptId, disposition: "incomplete" }),
		).rejects.toThrow("already reported");
		await expect(
			recordAttemptTerminal(value.root, { attemptId: started.attemptId, type: "failed" }),
		).resolves.toMatchObject({ outcome: "failed", completion: "complete" });
	});

	it("leaves completion absent when no report is made", async () => {
		const value = fixture();
		const started = await recordAttemptStarted(value.root, {
			goalId: "goal-a",
			taskId: "T001",
			sessionId: value.sessionId,
		});
		const terminal = await recordAttemptTerminal(value.root, { attemptId: started.attemptId, type: "settled" });
		expect(terminal.completion).toBeUndefined();
	});
});
