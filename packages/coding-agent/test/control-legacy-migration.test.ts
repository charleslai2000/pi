import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listGoals, listTasks, readTask } from "../src/core/control/read-model.ts";
import { createGoal, createTask, updateGoalMemory, updatePlanMemory } from "../src/core/control/task-definitions.ts";
import { setPiRoot } from "../src/core/pi-root.ts";
import { createWriteToolDefinition } from "../src/core/tools/write.ts";

const roots: string[] = [];
afterEach(() => {
	setPiRoot(undefined);
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): string {
	const root = mkdtempSync(join("/tmp", "pi-control-authority-"));
	roots.push(root);
	mkdirSync(join(root, ".pi"), { recursive: true });
	return root;
}

describe("PiRoot Markdown authority", () => {
	it("creates Goals/Tasks directly under .pi and exposes Goal memory", async () => {
		const root = fixture();
		const goalPath = createGoal(root, "goal-a", { title: "Goal A", memory: "cross-Task constraint" });
		expect(goalPath).toBe(join(root, ".pi", "goal-a", "goal.md"));
		createTask(root, "goal-a", "T001", "work", { objective: "Do work", completion: "done" });
		expect(readTask(root, "goal-a", "T001").path).toBe(join(root, ".pi", "goal-a", "T001-work.md"));
		expect(listGoals(root)[0]?.memory).toBe("cross-Task constraint");
		expect(listTasks(root, "goal-a")).toHaveLength(1);
	});

	it("keeps Goal and Plan memory mutations separate and rejects raw managed-path writes", async () => {
		const root = fixture();
		createGoal(root, "goal-a", { title: "Goal A", memory: "initial" });
		setPiRoot(root);
		updateGoalMemory(root, "goal-a", "long-term constraint");
		updatePlanMemory(root, "goal-a", "current strategy");
		expect(listGoals(root)[0]?.memory).toBe("long-term constraint");
		expect(readFileSync(join(root, ".pi", "goal-a", "plan.md"), "utf8")).toContain(
			"Coordination memory: current strategy",
		);
		await expect(
			createWriteToolDefinition(root).execute(
				"test",
				{ path: join(root, ".pi", "goal-a", "goal.md"), content: "unauthorized" },
				undefined,
				undefined,
				{ cwd: root } as never,
			),
		).rejects.toThrow(/Managed Control Plane files/);
	});
});
