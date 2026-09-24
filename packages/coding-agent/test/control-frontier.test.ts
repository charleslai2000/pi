import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FrontierError, readFrontier, writeFrontier } from "../src/core/control/frontier.ts";
import { setPiRoot } from "../src/core/pi-root.ts";

function fixture(): string {
	const root = mkdtempSync(join("/tmp", "pi-frontier-"));
	mkdirSync(join(root, ".pi", "warm-multi-session"), { recursive: true });
	writeFileSync(join(root, ".pi", "warm-multi-session", "goal.md"), "# Warm\n");
	mkdirSync(join(root, ".pi", "warm-multi-session-2"));
	writeFileSync(join(root, ".pi", "warm-multi-session-2", "goal.md"), "# Second\n");
	writeFileSync(join(root, ".pi", "warm-multi-session", "T001-work.md"), "Status: DONE\n");
	setPiRoot(root);
	return root;
}

afterEach(() => setPiRoot(undefined));

describe("control frontier read/write model", () => {
	it("bootstraps a missing frontier and reads the real fixture shape", () => {
		const root = fixture();
		const missing = readFrontier(root);
		expect(missing.exists).toBe(false);
		expect(missing.entries).toEqual([]);
		const result = writeFrontier(root, [
			{
				goalId: "warm-multi-session",
				taskId: "T001",
				state: "active",
				blocker: "",
				next: "Freeze validated implementation.",
			},
			{ goalId: "warm-multi-session-2", state: "deferred", blocker: "Waiting for evidence.", next: "Resume later." },
		]);
		expect(result.entries).toHaveLength(2);
	});

	it("round-trips order, optional Task, and empty fields", () => {
		const root = fixture();
		const entries = [
			{ goalId: "warm-multi-session", taskId: "T001", state: "active" as const, blocker: "", next: "" },
			{ goalId: "warm-multi-session-2", state: "deferred" as const, blocker: "Wait", next: "Resume" },
		];
		writeFrontier(root, entries);
		expect(readFrontier(root).entries).toEqual(entries);
		expect(readFileSync(join(root, ".pi", "frontier.md"), "utf8")).toContain("## warm-multi-session\nTask: T001");
	});

	it("fails fast for malformed syntax and references", () => {
		const root = fixture();
		const bad = (content: string): void => {
			writeFileSync(join(root, ".pi", "frontier.md"), content);
			expect(() => readFrontier(root)).toThrow(FrontierError);
		};
		bad("# Frontier\n\n## warm-multi-session\nState: active\nState: deferred\n");
		bad("# Frontier\n\n## warm-multi-session\nState: paused\n");
		bad("# Frontier\n\n## warm-multi-session\nUnknown: x\nState: active\n");
		bad("# Frontier\n\n## warm-multi-session\nTask: T999\nState: active\n");
		bad("# Frontier\n\n## missing\nState: active\n");
		bad("# Frontier\n\n## warm-multi-session\nState: active\n\n## warm-multi-session\nState: deferred\n");
	});

	it("validates before atomic replacement and leaves no temporary file", () => {
		const root = fixture();
		const path = join(root, ".pi", "frontier.md");
		writeFrontier(root, [{ goalId: "warm-multi-session", taskId: "T001", state: "active" }]);
		const before = readFileSync(path);
		expect(() => writeFrontier(root, [{ goalId: "warm-multi-session", taskId: "T999", state: "active" }])).toThrow(
			FrontierError,
		);
		expect(readFileSync(path)).toEqual(before);
		writeFrontier(root, [{ goalId: "warm-multi-session", state: "deferred", blocker: "x" }]);
		expect(readFileSync(path, "utf8")).toContain("State: deferred");
		expect(readdirSync(join(root, ".pi")).filter((name) => name.includes(".frontier.md.")).length).toBe(0);
		rmSync(root, { recursive: true, force: true });
	});

	it("reports a missing control directory", () => {
		const root = mkdtempSync(join("/tmp", "pi-frontier-no-control-"));
		setPiRoot(root);
		expect(() => readFrontier(root)).toThrow(FrontierError);
		expect(() => writeFrontier(root, [])).toThrow(FrontierError);
		expect(existsSync(join(root, "control"))).toBe(false);
		rmSync(root, { recursive: true, force: true });
	});
});
