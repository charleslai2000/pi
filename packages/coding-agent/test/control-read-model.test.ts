import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

afterEach(() => setPiRoot(undefined));

describe("control read model", () => {
	it("requires an explicit or active PiRoot for Control Plane projections", () => {
		expect(() => listGoals()).toThrow(/PiRoot is not set/);
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
		setPiRoot(root);
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

	it("returns an empty projection when an available Task authority has no Goals", () => {
		const base = mkdtempSync(join("/tmp", "pi-control-empty-"));
		const root = join(base, "project");
		mkdirSync(join(root, ".pi"), { recursive: true });
		mkdirSync(join(root, "control"), { recursive: true });
		writeFileSync(join(root, "control", "AGENTS.md"), "instructions\n");
		writeFileSync(join(root, "control", "frontier.md"), "# Frontier\n");
		setPiRoot(root);
		expect(listGoals(root)).toEqual([]);
		expect(() => readGoal(root, "missing-goal")).toThrow(ControlReadError);
		rmSync(base, { recursive: true, force: true });
	});
});
