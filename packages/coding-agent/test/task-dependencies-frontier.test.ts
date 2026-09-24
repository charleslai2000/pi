import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readAssociations } from "../src/core/control/associations.ts";
import { listTasks, readTask } from "../src/core/control/read-model.ts";
import { createTask } from "../src/core/control/task-definitions.ts";
import {
	dependencySatisfied,
	listDerivedFrontier,
	setTaskDependencies,
} from "../src/core/control/task-dependencies.ts";
import { cancelTask, completeTask, updateTaskStatus } from "../src/core/control/task-mutations.ts";
import { setPiRoot } from "../src/core/pi-root.ts";

const roots: string[] = [];
function setup(): string {
	const root = mkdtempSync(join("/tmp", "pi-task-deps-"));
	roots.push(root);
	mkdirSync(join(root, ".pi", "goal-a"), { recursive: true });
	writeFileSync(join(root, ".pi", "goal-a", "goal.md"), "# Goal A\n");
	setPiRoot(root);
	return root;
}
function task(root: string, id: string) {
	return createTask(root, "goal-a", id, id.toLowerCase(), { objective: id, completion: "done" });
}

afterEach(() => {
	setPiRoot(undefined);
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Task dependencies and derived frontier", () => {
	it("derives eligibility from persisted prerequisites and terminal state", async () => {
		const root = setup();
		task(root, "T001");
		task(root, "T002");
		await setTaskDependencies(root, "goal-a", "T002", [{ goalId: "goal-a", taskId: "T001" }], () => false);
		const before = listDerivedFrontier(root, listTasks(root, "goal-a"), () => false);
		expect(before.map((item) => item.taskId)).toEqual(["T001"]);
		await completeTask(root, "goal-a", "T001");
		const after = listDerivedFrontier(root, listTasks(root, "goal-a"), () => false);
		expect(after.map((item) => item.taskId)).toEqual(["T002"]);
		expect(dependencySatisfied(root, readTask(root, "goal-a", "T002"))).toBe(true);
	});

	it("rejects missing, self, direct, indirect, and cancelled prerequisites", async () => {
		const root = setup();
		task(root, "T001");
		task(root, "T002");
		task(root, "T003");
		await expect(
			setTaskDependencies(root, "goal-a", "T001", [{ goalId: "goal-a", taskId: "T001" }], () => false),
		).rejects.toThrow("itself");
		await expect(
			setTaskDependencies(root, "goal-a", "T001", [{ goalId: "goal-a", taskId: "T999" }], () => false),
		).rejects.toThrow();
		await setTaskDependencies(root, "goal-a", "T002", [{ goalId: "goal-a", taskId: "T001" }], () => false);
		await setTaskDependencies(root, "goal-a", "T003", [{ goalId: "goal-a", taskId: "T002" }], () => false);
		await expect(
			setTaskDependencies(root, "goal-a", "T001", [{ goalId: "goal-a", taskId: "T003" }], () => false),
		).rejects.toThrow("cycle");
		await cancelTask(root, "goal-a", "T001");
		expect(dependencySatisfied(root, readTask(root, "goal-a", "T002"))).toBe(false);
	});

	it("atomically persists replacements and rejects tenured lifecycle mutation", async () => {
		const root = setup();
		task(root, "T001");
		task(root, "T002");
		await setTaskDependencies(root, "goal-a", "T002", [{ goalId: "goal-a", taskId: "T001" }], () => false);
		expect(readTask(root, "goal-a", "T002").prerequisites).toEqual([{ goalId: "goal-a", taskId: "T001" }]);
		await updateTaskStatus(root, "goal-a", "T002", { status: "ACTIVE" });
		await expect(setTaskDependencies(root, "goal-a", "T002", [], () => true)).rejects.toThrow("tenure");
		expect(readTask(root, "goal-a", "T002").prerequisites).toEqual([{ goalId: "goal-a", taskId: "T001" }]);
		expect(existsSync(join(root, ".pi", "frontier.md"))).toBe(false);
		expect(readAssociations(root).current).toEqual([]);
	});
});
