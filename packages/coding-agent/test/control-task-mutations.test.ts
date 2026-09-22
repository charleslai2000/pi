import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cancelTask, completeTask, TaskMutationError, updateTaskMemory } from "../src/core/control/task-mutations.ts";
import { setPiRoot } from "../src/core/pi-root.ts";

function fixture(status = "ACTIVE"): { root: string; taskPath: string } {
	const root = mkdtempSync(join("/tmp", "pi-task-mutation-"));
	const taskPath = join(root, "control", "goal-a", "tasks", "T001-work.md");
	mkdirSync(join(root, "control", "goal-a", "tasks"), { recursive: true });
	writeFileSync(join(root, "control", "goal-a", "goal.md"), "# Goal A\n");
	writeFileSync(
		taskPath,
		`Status: ${status}\nObjective: preserve this\nResult: old\nRemaining: later\n\nOther: content\n`,
	);
	setPiRoot(root, "legacy");
	return { root, taskPath };
}

afterEach(() => setPiRoot(undefined));

describe("Task terminal mutations", () => {
	it("completes with targeted field updates and preserves unrelated Markdown", async () => {
		const value = fixture();
		const before = readFileSync(value.taskPath, "utf8");
		const result = await completeTask(value.root, "goal-a", "T001", { result: "finished", remaining: "" });
		expect(result.changed).toBe(true);
		const after = readFileSync(value.taskPath, "utf8");
		expect(after).toContain("Status: DONE");
		expect(after).toContain("Result: finished");
		expect(after).toContain("Remaining: ");
		expect(after).toContain("Other: content");
		expect(after).not.toBe(before);
	});

	it("updates only the Task memory field without changing lifecycle fields", async () => {
		const value = fixture();
		await updateTaskMemory(value.root, "goal-a", "T001", { memory: "Decision: use the native Session model." });
		const after = readFileSync(value.taskPath, "utf8");
		expect(after).toContain("Status: ACTIVE");
		expect(after).toContain("Objective: preserve this");
		expect(after).toContain("Memory: Decision: use the native Session model.");
		expect(after).toContain("Other: content");
	});

	it("rejects memory writes to terminal Tasks", async () => {
		const value = fixture("DONE");
		await expect(updateTaskMemory(value.root, "goal-a", "T001", { memory: "no" })).rejects.toBeInstanceOf(
			TaskMutationError,
		);
	});

	it("supports idempotent same-terminal mutation and rejects cross-terminal mutation", async () => {
		const value = fixture("ACTIVE");
		await cancelTask(value.root, "goal-a", "T001");
		expect((await cancelTask(value.root, "goal-a", "T001")).changed).toBe(false);
		await expect(completeTask(value.root, "goal-a", "T001")).rejects.toBeInstanceOf(TaskMutationError);
	});

	it("rejects invalid current Status", async () => {
		const value = fixture("UNKNOWN");
		await expect(completeTask(value.root, "goal-a", "T001")).rejects.toBeInstanceOf(TaskMutationError);
	});
});
