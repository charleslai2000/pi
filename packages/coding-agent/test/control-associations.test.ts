import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	AssociationConcurrentModificationError,
	AssociationConflictError,
	AssociationError,
	assignTaskToSession,
	getSessionAssignment,
	getTaskAssignment,
	listTaskAssociationHistory,
	readAssociations,
	reassignTaskToSession,
	setAssociationClockForTesting,
	setAssociationMutationHooksForTesting,
	unassignTask,
	writeAssociations,
} from "../src/core/control/associations.ts";
import { setPiRoot } from "../src/core/pi-root.ts";
import { getDefaultSessionDir } from "../src/core/session-manager.ts";

function fixture(): { root: string; sessionId: string } {
	const root = mkdtempSync(join("/tmp", "pi-associations-"));
	mkdirSync(join(root, ".pi"), { recursive: true });
	const taskDir = join(root, "control", "warm-multi-session", "tasks");
	mkdirSync(taskDir, { recursive: true });
	writeFileSync(join(root, "control", "warm-multi-session", "goal.md"), "# Warm\n");
	writeFileSync(join(taskDir, "T001-work.md"), "Status: READY\n");
	const sessionId = "session-a";
	setPiRoot(root);
	const sessionDir = getDefaultSessionDir(root);
	writeFileSync(
		join(sessionDir, "session-a.jsonl"),
		`${JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: new Date().toISOString(), cwd: root })}\n`,
	);
	return { root, sessionId };
}

function valid(sessionId: string) {
	return {
		version: 1 as const,
		current: [
			{
				goalId: "warm-multi-session",
				taskId: "T001",
				sessionId,
				assignedAt: "2026-01-01T00:00:00.000Z",
				generation: 1,
			},
		],
		history: [
			{
				goalId: "warm-multi-session",
				taskId: "T001",
				sessionId,
				type: "assigned" as const,
				at: "2026-01-01T00:00:00.000Z",
			},
		],
	};
}

afterEach(() => {
	setPiRoot(undefined);
	setAssociationClockForTesting(undefined);
	setAssociationMutationHooksForTesting({});
});

describe("durable task/session associations", () => {
	it("bootstraps, validates, writes, and reads a current assignment", () => {
		const { root, sessionId } = fixture();
		const missing = readAssociations(root);
		expect(missing.exists).toBe(false);
		const written = writeAssociations(root, valid(sessionId));
		expect(written.exists).toBe(true);
		expect(getTaskAssignment(readAssociations(root), "warm-multi-session", "T001")?.sessionId).toBe(sessionId);
		expect(getSessionAssignment(readAssociations(root), sessionId)?.taskId).toBe("T001");
		expect(listTaskAssociationHistory(readAssociations(root), "warm-multi-session", "T001")).toHaveLength(1);
	});

	it("allows historical N:N and inactive durable sessions, including control sessions", () => {
		const { root } = fixture();
		const second = "session-b";
		writeFileSync(
			join(getDefaultSessionDir(root), "session-b.jsonl"),
			`${JSON.stringify({ type: "session", version: 3, id: second, timestamp: new Date().toISOString(), cwd: root })}\n`,
		);
		const data = {
			version: 1 as const,
			current: [
				{
					goalId: "warm-multi-session",
					taskId: "T001",
					sessionId: second,
					assignedAt: "2026-01-01T00:00:00.000Z",
					generation: 2,
				},
			],
			history: [
				{
					goalId: "warm-multi-session",
					taskId: "T001",
					sessionId: second,
					type: "assigned" as const,
					at: "2025-01-01T00:00:00.000Z",
				},
				{
					goalId: "warm-multi-session",
					taskId: "T001",
					sessionId: second,
					type: "unassigned" as const,
					at: "2025-01-02T00:00:00.000Z",
				},
				{
					goalId: "warm-multi-session",
					taskId: "T001",
					sessionId: second,
					type: "assigned" as const,
					at: "2026-01-01T00:00:00.000Z",
				},
			],
		};
		expect(writeAssociations(root, data).history).toHaveLength(3);
	});

	it("rejects identity, schema, cardinality, and malformed timestamp errors", () => {
		const { root, sessionId } = fixture();
		const assertInvalid = (data: unknown): void => {
			writeFileSync(join(root, ".pi", "assignments.json"), JSON.stringify(data));
			expect(() => readAssociations(root)).toThrow(AssociationError);
		};
		assertInvalid({ version: 2, current: [], history: [] });
		assertInvalid({ version: 1, current: [], history: [], extra: true });
		assertInvalid({
			version: 1,
			current: [{ goalId: "warm-multi-session", taskId: "T001", sessionId, assignedAt: "bad", generation: 1 }],
			history: [],
		});
		assertInvalid({
			version: 1,
			current: [{ goalId: "missing", taskId: "T001", sessionId, assignedAt: "2026-01-01T00:00:00Z", generation: 1 }],
			history: [],
		});
		assertInvalid({
			version: 1,
			current: [
				{
					goalId: "warm-multi-session",
					taskId: "T999",
					sessionId,
					assignedAt: "2026-01-01T00:00:00Z",
					generation: 1,
				},
			],
			history: [],
		});
		assertInvalid({
			version: 1,
			current: [
				{
					goalId: "warm-multi-session",
					taskId: "T001",
					sessionId: "missing",
					assignedAt: "2026-01-01T00:00:00Z",
					generation: 1,
				},
			],
			history: [],
		});
		assertInvalid({
			version: 1,
			current: [valid(sessionId).current[0], { ...valid(sessionId).current[0], taskId: "T001" }],
			history: valid(sessionId).history,
		});
	});

	it("preserves the old file on invalid write and leaves no temp file after replacement", () => {
		const { root, sessionId } = fixture();
		writeAssociations(root, valid(sessionId));
		const path = join(root, ".pi", "assignments.json");
		const before = readFileSync(path);
		expect(() =>
			writeAssociations(root, {
				version: 1,
				current: [
					{
						goalId: "warm-multi-session",
						taskId: "T999",
						sessionId,
						assignedAt: "2026-01-01T00:00:00Z",
						generation: 1,
					},
				],
				history: [],
			}),
		).toThrow(AssociationError);
		expect(readFileSync(path)).toEqual(before);
		writeAssociations(root, { version: 1, current: [], history: valid(sessionId).history });
		expect(JSON.parse(readFileSync(path, "utf8")).current).toEqual([]);
		expect(
			readdirSync(join(root, "control")).some(
				(name) => name.startsWith(".assignments.json.") && name.endsWith(".tmp"),
			),
		).toBe(false);
		rmSync(root, { recursive: true, force: true });
	});

	it("supports assign, unassign, and atomic reassign semantics", async () => {
		const { root, sessionId } = fixture();
		const second = "session-b";
		writeFileSync(
			join(getDefaultSessionDir(root), "session-b.jsonl"),
			`${JSON.stringify({ type: "session", version: 3, id: second, timestamp: new Date().toISOString(), cwd: root })}\n`,
		);
		setAssociationClockForTesting(() => "2026-01-01T00:00:00.000Z");
		expect((await assignTaskToSession(root, "warm-multi-session", "T001", sessionId)).changed).toBe(true);
		expect((await assignTaskToSession(root, "warm-multi-session", "T001", sessionId)).changed).toBe(false);
		expect((await reassignTaskToSession(root, "warm-multi-session", "T001", second)).changed).toBe(true);
		expect(readAssociations(root).current.find((item) => item.taskId === "T001")?.generation).toBe(2);
		expect(
			readAssociations(root)
				.history.slice(-2)
				.map((event) => [event.type, event.sessionId]),
		).toEqual([
			["unassigned", sessionId],
			["assigned", second],
		]);
		expect((await unassignTask(root, "warm-multi-session", "T001")).changed).toBe(true);
		expect((await unassignTask(root, "warm-multi-session", "T001")).changed).toBe(false);
		expect(
			(await assignTaskToSession(root, "warm-multi-session", "T001", sessionId)).record.current[0]?.generation,
		).toBe(3);
	});

	it("rejects current conflicts and unassigned reassign", async () => {
		const { root, sessionId } = fixture();
		const second = "session-b";
		writeFileSync(
			join(getDefaultSessionDir(root), "session-b.jsonl"),
			`${JSON.stringify({ type: "session", version: 3, id: second, timestamp: new Date().toISOString(), cwd: root })}\n`,
		);
		writeFileSync(join(root, "control", "warm-multi-session", "tasks", "T002-work.md"), "Status: READY\n");
		expect((await assignTaskToSession(root, "warm-multi-session", "T001", sessionId)).changed).toBe(true);
		await expect(assignTaskToSession(root, "warm-multi-session", "T001", second)).rejects.toThrow(
			AssociationConflictError,
		);
		await expect(assignTaskToSession(root, "warm-multi-session", "T002", sessionId)).rejects.toThrow(
			AssociationConflictError,
		);
		await expect(reassignTaskToSession(root, "warm-multi-session", "T002", second)).rejects.toThrow(AssociationError);
	});

	it("serializes concurrent mutations and detects stale external changes", async () => {
		const { root, sessionId } = fixture();
		const second = "session-b";
		writeFileSync(
			join(getDefaultSessionDir(root), "session-b.jsonl"),
			`${JSON.stringify({ type: "session", version: 3, id: second, timestamp: new Date().toISOString(), cwd: root })}\n`,
		);
		writeFileSync(join(root, "control", "warm-multi-session", "tasks", "T002-work.md"), "Status: READY\n");
		const results = await Promise.all([
			assignTaskToSession(root, "warm-multi-session", "T001", sessionId),
			assignTaskToSession(root, "warm-multi-session", "T002", second),
		]);
		expect(results.every((result) => result.changed)).toBe(true);
		writeFileSync(join(root, "control", "warm-multi-session", "tasks", "T003-work.md"), "Status: READY\n");
		const third = "session-c";
		writeFileSync(
			join(getDefaultSessionDir(root), "session-c.jsonl"),
			`${JSON.stringify({ type: "session", version: 3, id: third, timestamp: new Date().toISOString(), cwd: root })}\n`,
		);
		setAssociationMutationHooksForTesting({
			beforeCommit: () => {
				writeFileSync(join(root, ".pi", "assignments.json"), '{"version":1,"current":[],"history":[]}\n');
			},
		});
		await expect(assignTaskToSession(root, "warm-multi-session", "T003", third)).rejects.toThrow(
			AssociationConcurrentModificationError,
		);
	});

	it("keeps the old file on injected rename failure", async () => {
		const { root, sessionId } = fixture();
		const before = readAssociations(root);
		setAssociationMutationHooksForTesting({ failRename: true });
		await expect(assignTaskToSession(root, "warm-multi-session", "T001", sessionId)).rejects.toThrow(
			AssociationError,
		);
		expect(readAssociations(root)).toEqual(before);
	});

	it("does not create control or depend on the Registry database", () => {
		const root = mkdtempSync(join("/tmp", "pi-associations-no-control-"));
		mkdirSync(join(root, ".pi"), { recursive: true });
		mkdirSync(join(root, "control"), { recursive: true });
		setPiRoot(root);
		const taskDir = join(root, "control", "goal-a", "tasks");
		mkdirSync(taskDir, { recursive: true });
		writeFileSync(join(root, "control", "goal-a", "goal.md"), "# Goal A\n");
		writeFileSync(join(taskDir, "T001-work.md"), "Status: READY\n");
		expect(readAssociations(root).current).toEqual([]);
		expect(existsSync(join(root, ".pi", "state", "control.sqlite3"))).toBe(false);
		rmSync(root, { recursive: true, force: true });
	});
});
