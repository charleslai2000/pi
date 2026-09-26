import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTask, reviseTask } from "../src/core/control/task-definitions.ts";
import { setTaskDependencies } from "../src/core/control/task-dependencies.ts";
import {
	cancelTask,
	completeTask,
	TaskMutationError,
	updateTaskMemory,
	updateTaskStatus,
} from "../src/core/control/task-mutations.ts";
import { setPiRoot } from "../src/core/pi-root.ts";

function fixture(status = "ACTIVE"): { root: string; taskPath: string } {
	const root = mkdtempSync(join("/tmp", "pi-task-mutation-"));
	const taskPath = join(root, ".pi", "control", "goal-a", "T001-work.md");
	mkdirSync(join(root, ".pi", "control", "goal-a"), { recursive: true });
	writeFileSync(join(root, ".pi", "control", "goal-a", "goal.md"), "# Goal A\n");
	writeFileSync(
		taskPath,
		`Status: ${status}\nObjective: preserve this\nResult: old\nRemaining: later\n\nOther: content\n`,
	);
	setPiRoot(root);
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

	it("creates exactly one Remaining field and rejects field injection", async () => {
		const value = fixture();
		const created = createTask(value.root, "goal-a", "T002", "created", {
			objective: "created objective",
			completion: "done",
		});
		expect(readFileSync(created.path, "utf8").match(/^Remaining:/gm)).toHaveLength(1);
		expect(() =>
			createTask(value.root, "goal-a", "T003", "injected", {
				objective: `safe\nRemaining: injected`,
				completion: "done",
			}),
		).toThrow("must not inject canonical Task fields");
	});

	it("uses production task revision and status writers without duplicating Remaining", async () => {
		const value = fixture();
		await reviseTask(value.root, "goal-a", "T001", { objective: "revised" });
		await setTaskDependencies(value.root, "goal-a", "T001", [], () => false);
		await updateTaskStatus(value.root, "goal-a", "T001", { status: "BLOCKED", remaining: "follow-up" });
		await updateTaskMemory(value.root, "goal-a", "T001", { memory: "recorded" });
		await completeTask(value.root, "goal-a", "T001", { result: "done", remaining: "" });
		expect(readFileSync(value.taskPath, "utf8").match(/^Remaining:/gm)).toHaveLength(1);
	});

	it("rejects revision values that inject canonical Task fields", async () => {
		const value = fixture();
		await expect(
			reviseTask(value.root, "goal-a", "T001", { objective: `revised\nRemaining: injected` }),
		).rejects.toThrow("Task field values must not inject canonical Task fields");
		expect(readFileSync(value.taskPath, "utf8").match(/^Remaining:/gm)).toHaveLength(1);
	});

	it("adds a missing Remaining field when completing a legacy Task", async () => {
		const value = fixture();
		writeFileSync(value.taskPath, "Status: ACTIVE\nObjective: legacy task without Remaining\nResult: old\n");

		const result = await completeTask(value.root, "goal-a", "T001", { remaining: "follow up" });

		expect(result.task.status).toBe("DONE");
		expect(result.task.remaining).toBe("follow up");
		expect(readFileSync(value.taskPath, "utf8")).toBe(
			"Status: DONE\nObjective: legacy task without Remaining\nResult: old\nRemaining: follow up\n",
		);
	});

	it("rejects duplicate Remaining fields rather than mutating ambiguous Task content", async () => {
		const value = fixture();
		writeFileSync(
			value.taskPath,
			"Status: ACTIVE\nObjective: duplicate field\nRemaining: first\nRemaining: second\n",
		);
		await expect(completeTask(value.root, "goal-a", "T001", { remaining: "follow up" })).rejects.toThrow(
			"Task must contain exactly one Remaining: field",
		);
	});

	it("rejects invalid current Status", async () => {
		const value = fixture("UNKNOWN");
		await expect(completeTask(value.root, "goal-a", "T001")).rejects.toBeInstanceOf(TaskMutationError);
	});
});
