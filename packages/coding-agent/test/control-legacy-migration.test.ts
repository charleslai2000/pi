import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateLegacyControlAuthority } from "../src/core/control/legacy-migration.ts";
import { listGoals, listTasks, readTask, resolveControlDirectory } from "../src/core/control/read-model.ts";
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
		expect(goalPath).toBe(join(root, ".pi", "control", "goal-a", "goal.md"));
		createTask(root, "goal-a", "T001", "work", { objective: "Do work", completion: "done" });
		expect(readTask(root, "goal-a", "T001").path).toBe(join(root, ".pi", "control", "goal-a", "T001-work.md"));
		expect(listGoals(root)[0]?.memory).toBe("cross-Task constraint");
		expect(listTasks(root, "goal-a")).toHaveLength(1);
	});

	it("migrates Goal and Task Markdown into .pi/control without changing bytes", () => {
		const root = fixture();
		const legacyGoal = join(root, "control", "goal-a");
		mkdirSync(legacyGoal, { recursive: true });
		const documents = new Map([
			["goal.md", "# Goal A\\r\\nStatus: READY\\r\\nMemory: retain\\r\\n"],
			["plan.md", "# Plan\\r\\nCoordination memory: strategy\\r\\n"],
			["T001-work.md", "Status: DONE\\r\\nObjective: work\\r\\n\\r\\n## Result\\r\\npreserved\\r\\n"],
		]);
		for (const [name, content] of documents) writeFileSync(join(legacyGoal, name), content);

		expect(migrateLegacyControlAuthority(root)).toEqual({ goals: 1, tasks: 1 });
		expect(resolveControlDirectory(root)).toBe(join(root, ".pi", "control"));
		for (const [name, content] of documents)
			expect(readFileSync(join(root, ".pi", "control", "goal-a", name), "utf8")).toBe(content);
		expect(listGoals(root).map((goal) => goal.goalId)).toEqual(["goal-a"]);
		expect(readTask(root, "goal-a", "T001").content).toContain("preserved");
		expect(existsSync(legacyGoal)).toBe(false);
		expect(readdirSync(join(root, ".pi", "control"))).toContain("goal-a");
	});

	it("refuses a collision without moving legacy authority", () => {
		const root = fixture();
		const legacyGoal = join(root, "control", "goal-a");
		mkdirSync(legacyGoal, { recursive: true });
		writeFileSync(join(legacyGoal, "goal.md"), "# Legacy\\n");
		mkdirSync(join(root, ".pi", "control", "goal-a"), { recursive: true });
		expect(() => migrateLegacyControlAuthority(root)).toThrow(/Migration conflict/);
		expect(readFileSync(join(legacyGoal, "goal.md"), "utf8")).toBe("# Legacy\\n");
	});

	it("keeps Goal and Plan memory mutations separate and rejects raw managed-path writes", async () => {
		const root = fixture();
		createGoal(root, "goal-a", { title: "Goal A", memory: "initial" });
		setPiRoot(root);
		updateGoalMemory(root, "goal-a", "long-term constraint");
		updatePlanMemory(root, "goal-a", "current strategy");
		expect(listGoals(root)[0]?.memory).toBe("long-term constraint");
		expect(readFileSync(join(root, ".pi", "control", "goal-a", "plan.md"), "utf8")).toContain(
			"Coordination memory: current strategy",
		);
		await expect(
			createWriteToolDefinition(root).execute(
				"test",
				{ path: join(root, ".pi", "control", "goal-a", "goal.md"), content: "unauthorized" },
				undefined,
				undefined,
				{ cwd: root } as never,
			),
		).rejects.toThrow(/Managed Control Plane files/);
	});
});
