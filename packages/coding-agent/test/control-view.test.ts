import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import { writeAssociations } from "../src/core/control/associations.ts";
import { writeFrontier } from "../src/core/control/frontier.ts";
import { getTaskControlView, listFrontierControlViews } from "../src/core/control/view.ts";
import { setPiRoot } from "../src/core/pi-root.ts";
import { getDefaultSessionDir } from "../src/core/session-manager.ts";
import { SessionRegistry, setSessionRegistryForTesting } from "../src/core/session-registry.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

function fixture(): { root: string; sessionDir: string; sessionId: string } {
	const root = mkdtempSync(join("/tmp", "pi-control-view-"));
	mkdirSync(join(root, ".pi"), { recursive: true });
	mkdirSync(join(root, "control", "goal-a", "tasks"), { recursive: true });
	writeFileSync(join(root, "control", "goal-a", "goal.md"), "# Goal A\n");
	writeFileSync(
		join(root, "control", "goal-a", "tasks", "T001-work.md"),
		"Status: ACTIVE\nWork area: design\nObjective: integrate\n",
	);
	writeFileSync(join(root, "control", "goal-a", "tasks", "T002-work.md"), "Status: READY\n");
	mkdirSync(join(root, "control", "goal-b", "tasks"), { recursive: true });
	writeFileSync(join(root, "control", "goal-b", "goal.md"), "# Goal B\n");
	writeFileSync(join(root, "control", "goal-b", "tasks", "T004-work.md"), "Status: DONE\n");
	mkdirSync(join(root, "control", "goal-c", "tasks"), { recursive: true });
	writeFileSync(join(root, "control", "goal-c", "goal.md"), "# Goal C\n");
	writeFileSync(join(root, "control", "goal-c", "tasks", "T002-work.md"), "Status: READY\n");
	setPiRoot(root);
	const sessionId = "d1";
	const sessionDir = getDefaultSessionDir(root);
	const cwd = join(root, "design");
	mkdirSync(cwd, { recursive: true });
	writeFileSync(
		join(sessionDir, `${sessionId}.jsonl`),
		`${JSON.stringify({ type: "session", version: 3, id: sessionId, timestamp: new Date().toISOString(), cwd })}\n`,
	);
	const registry = new SessionRegistry(root, { acquire: false });
	registry.rebuild([
		{
			id: sessionId,
			path: join(sessionDir, `${sessionId}.jsonl`),
			cwd,
			name: "design-session",
			created: new Date(),
			modified: new Date(),
			messageCount: 0,
			firstMessage: "",
			allMessagesText: "",
		},
	]);
	setSessionRegistryForTesting(registry);
	return { root, sessionDir, sessionId };
}

afterEach(() => {
	setSessionRegistryForTesting(undefined);
	setPiRoot(undefined);
});

describe("combined control view", () => {
	it("combines Task, frontier, assignment, and inactive runtime state without mutation", () => {
		const value = fixture();
		writeFrontier(value.root, [
			{ goalId: "goal-a", taskId: "T001", state: "active", next: "Validate integration" },
			{ goalId: "goal-c", taskId: "T002", state: "active" },
			{ goalId: "goal-b", taskId: "T004", state: "active", blocker: "waiting" },
		]);
		writeAssociations(value.root, {
			version: 1,
			current: [
				{
					goalId: "goal-a",
					taskId: "T001",
					sessionId: value.sessionId,
					assignedAt: "2026-01-01T00:00:00.000Z",
					generation: 1,
				},
			],
			history: [
				{
					goalId: "goal-a",
					taskId: "T001",
					sessionId: value.sessionId,
					type: "assigned",
					at: "2026-01-01T00:00:00.000Z",
				},
			],
		});
		const before = readFileSync(join(value.root, "control", "goal-a", "tasks", "T001-work.md"));
		const view = getTaskControlView(value.root, "goal-a", "T001");
		expect(view.taskStatus).toBe("ACTIVE");
		expect(view.frontier).toEqual(expect.objectContaining({ state: "active", next: "Validate integration" }));
		expect(view.assignment).toEqual(
			expect.objectContaining({
				sessionId: value.sessionId,
				sessionName: "design-session",
				runtimeState: "inactive",
			}),
		);
		expect(view.warnings).toEqual([]);
		expect(readFileSync(join(value.root, "control", "goal-a", "tasks", "T001-work.md"))).toEqual(before);

		const views = listFrontierControlViews(value.root);
		expect(views.map((entry) => entry.taskId)).toEqual(["T001", "T002", "T004"]);
		expect(views[1]?.assignment).toBeUndefined();
		expect(views[2]?.warnings).toContain("task_done_but_frontier_active");
	});
});

describe("InteractiveMode control view commands", () => {
	it("renders /task and /frontier from the combined runtime view", async () => {
		const value = fixture();
		writeFrontier(value.root, [{ goalId: "goal-a", taskId: "T001", state: "active", next: "Validate integration" }]);
		const runtime = Object.assign(Object.create(AgentSessionRuntime.prototype), {
			getTaskControlView: () => getTaskControlView(value.root, "goal-a", "T001"),
			listFrontierControlViews: () => listFrontierControlViews(value.root),
		});
		const status = vi.fn();
		const context = Object.assign(Object.create(InteractiveMode.prototype), {
			runtimeHost: runtime,
			editor: { setText: vi.fn() },
			defaultEditor: {} as { onSubmit?: (text: string) => Promise<void> },
			showStatus: status,
			showError: vi.fn(),
		});
		(
			InteractiveMode.prototype as unknown as { setupEditorSubmitHandler(this: typeof context): void }
		).setupEditorSubmitHandler.call(context);
		await context.defaultEditor.onSubmit!("/task goal-a/T001");
		expect(status.mock.calls.at(-1)?.[0]).toContain("goal-a/T001");
		expect(status.mock.calls.at(-1)?.[0]).toContain("Frontier: active");
		await context.defaultEditor.onSubmit!("/frontier");
		expect(status.mock.calls.at(-1)?.[0]).toContain("1. goal-a/T001");
	});
});
