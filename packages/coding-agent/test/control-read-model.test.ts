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
		const authority = join(root, ".pi");
		mkdirSync(join(authority, "g"), { recursive: true });
		writeFileSync(join(authority, "g", "goal.md"), "# G\n");
		mkdirSync(join(authority, "h"), { recursive: true });
		writeFileSync(join(authority, "h", "goal.md"), "# H\n");
		mkdirSync(join(authority, "not-a-goal"), { recursive: true });
		writeFileSync(join(authority, "not-a-goal", "notes.md"), "notes\n");
		writeFileSync(join(authority, "g", "T001-a.md"), "Status: READY\nObjective: A\n");
		writeFileSync(join(authority, "g", "T001-b.md"), "Status: READY\nObjective: B\n");
		setPiRoot(root);
		expect(listGoals(root).map((goal) => goal.goalId)).toEqual(["g", "h"]);
		expect(() => listTasks(root, "g")).toThrow(DuplicateTaskIdentityError);
		rmSync(join(authority, "g", "T001-b.md"));
		expect(() => readTask(root, "g", "T999")).toThrow(ControlReadError);
		mkdirSync(join(base, "outside-goal"), { recursive: true });
		writeFileSync(join(base, "outside-goal", "goal.md"), "# Escaped\n");
		symlinkSync(join(base, "outside-goal"), join(authority, "escaped"));
		expect(() => listGoals(root)).toThrow(ControlReadError);
		rmSync(base, { recursive: true, force: true });
	});

	it("returns an empty projection when an available Task authority has no Goals", () => {
		const base = mkdtempSync(join("/tmp", "pi-control-empty-"));
		const root = join(base, "project");
		mkdirSync(join(root, ".pi"), { recursive: true });
		writeFileSync(join(root, ".pi", "AGENTS.md"), "instructions\n");
		writeFileSync(join(root, ".pi", "frontier.md"), "# Frontier\n");
		setPiRoot(root);
		expect(listGoals(root)).toEqual([]);
		expect(() => readGoal(root, "missing-goal")).toThrow(ControlReadError);
		rmSync(base, { recursive: true, force: true });
	});
});
