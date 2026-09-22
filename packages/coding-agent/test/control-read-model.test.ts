import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	ControlReadError,
	DuplicateTaskIdentityError,
	listGoals,
	listTasks,
	readGoal,
	readTask,
} from "../src/core/control/read-model.ts";
import { setPiRoot } from "../src/core/pi-root.ts";

const repoRoot = process.cwd();
const fixtureRoot = join(repoRoot, "control");

afterEach(() => setPiRoot(undefined));

describe("control read model", () => {
	it("discovers the real warm-multi-session Goal and Task without writing", () => {
		const goal = readGoal(repoRoot, "warm-multi-session");
		const task = readTask(repoRoot, "warm-multi-session", "T001");
		expect(goal.goalId).toBe("warm-multi-session");
		expect(existsSync(goal.goalFile)).toBe(true);
		expect(goal.planFile).toBe(join(fixtureRoot, "warm-multi-session", "plan.md"));
		expect(task.taskId).toBe("T001");
		expect(task.slug).toBe("implement-and-freeze");
		expect(task.status).toBe("DONE");
		expect(task.objective).toContain("concurrent warm multi-session");
		expect(listGoals(repoRoot).map((item) => item.goalId)).toContain("warm-multi-session");
		expect(listTasks(repoRoot, "warm-multi-session")).toHaveLength(1);
	});

	it("rejects malformed, duplicate, missing, and escaping paths", () => {
		const base = mkdtempSync(join("/tmp", "pi-control-read-"));
		const root = join(base, "project");
		const control = join(root, "control");
		mkdirSync(join(control, "g", "tasks"), { recursive: true });
		writeFileSync(join(control, "g", "goal.md"), "# G\n");
		mkdirSync(join(control, "h"), { recursive: true });
		writeFileSync(join(control, "h", "goal.md"), "# H\n");
		mkdirSync(join(control, "not-a-goal"), { recursive: true });
		writeFileSync(join(control, "not-a-goal", "notes.md"), "notes\n");
		writeFileSync(join(control, "g", "tasks", "random.md"), "Status: READY\n");
		writeFileSync(join(control, "g", "tasks", "T001-a.md"), "Status: READY\nObjective: A\n");
		writeFileSync(join(control, "g", "tasks", "T001-b.md"), "Status: READY\nObjective: B\n");
		setPiRoot(root, "legacy");
		expect(listGoals(root).map((goal) => goal.goalId)).toEqual(["g", "h"]);
		expect(() => listTasks(root, "g")).toThrow(DuplicateTaskIdentityError);
		writeFileSync(join(control, "g", "tasks", "T001-b.md"), "");
		rmSync(join(control, "g", "tasks", "T001-b.md"));
		expect(() => readTask(root, "g", "T999")).toThrow(ControlReadError);
		mkdirSync(join(base, "outside-goal"), { recursive: true });
		writeFileSync(join(base, "outside-goal", "goal.md"), "# Escaped\n");
		symlinkSync(join(base, "outside-goal"), join(control, "escaped"));
		expect(() => listGoals(root)).toThrow(ControlReadError);
		rmSync(base, { recursive: true, force: true });
	});

	it("does not mistake control documents for Goals or malformed files for Tasks", () => {
		expect(listGoals(repoRoot).some((goal) => goal.goalId === "AGENTS.md" || goal.goalId === "frontier.md")).toBe(
			false,
		);
		expect(() => readGoal(repoRoot, "missing-goal")).toThrow(ControlReadError);
	});
});
