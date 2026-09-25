import { describe, expect, it } from "vitest";
import { setPiRoot } from "../src/core/pi-root.ts";
import type { SessionSlot } from "../src/core/session-pool.ts";
import {
	formatSessionCwd,
	projectLiveSessionCounts,
} from "../src/modes/interactive/components/live-session-projection.ts";
import { LiveSessionSelector } from "../src/modes/interactive/components/live-session-selector.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function slot(id: string, cwd: string, busy = false): SessionSlot {
	return {
		id,
		cwd,
		session: { sessionManager: { getSessionId: () => id }, sessionName: id } as never,
		services: {} as never,
		sessionFile: undefined,
		gitWorktreeRoot: undefined,
		activity: { busy, unread: false, mutationCapable: false },
	};
}

function row(session_id: string, role: "controller" | "executor" | "unassigned", task_id?: string) {
	return { session_id, role, task_id, runtime_state: "active" } as never;
}

describe("live Session projection", () => {
	it("counts only active and currently BLOCKED Execution Sessions", () => {
		const sessions = [
			{ slot: slot("controller", "/root", true), row: row("controller", "controller"), task: { status: "BLOCKED" } },
			{ slot: slot("busy", "/root", true), row: row("busy", "executor"), task: { status: "ACTIVE" } },
			{ slot: slot("waiting", "/root"), row: row("waiting", "executor"), task: { status: "BLOCKED" } },
			{ slot: slot("idle", "/root"), row: row("idle", "executor"), task: { status: "READY" } },
			{ slot: slot("done", "/root"), row: row("done", "executor"), task: { status: "DONE" } },
			{ slot: slot("terminated", "/root"), row: row("terminated", "executor"), task: { status: "DEFERRED" } },
			{ slot: slot("unassigned", "/root"), row: row("unassigned", "unassigned") },
		];
		expect(projectLiveSessionCounts(sessions, "controller")).toEqual({ active: 1, blocked: 1, total: 5 });
	});

	it("projects cwd relative to PiRoot and preserves outside paths", () => {
		setPiRoot("/root");
		try {
			expect(formatSessionCwd("/root/.pi", "/root")).toBe(".pi");
			expect(formatSessionCwd("/root", "/root")).toBe(".");
			expect(formatSessionCwd("/root/src/routing", "/root")).toBe("src/routing");
			expect(formatSessionCwd("/outside/work", "/root")).toBe("/outside/work");
		} finally {
			setPiRoot(undefined);
		}
	});

	it("keeps Controller first and preserves Execution indentation while moving selection", () => {
		initTheme("dark");
		const controller = slot("slot-c", "/root/.pi");
		const execution = slot("slot-e", "/root/src/routing");
		const selector = new LiveSessionSelector(
			[
				{ slot: controller, row: row("c", "controller") },
				{
					slot: execution,
					row: {
						session_id: "e",
						role: "executor",
						runtime_state: "active",
						agent_slug: "debugger",
						task_id: "T004",
					} as never,
				},
			],
			{
				foregroundSlotId: controller.id,
				controllerSlotId: controller.id,
				piRoot: "/root",
				onSwitch: () => {},
				onClose: () => {},
				onAbort: () => {},
				onCancel: () => {},
			},
		);
		const initial = selector.render(160).join("\n");
		expect(initial.indexOf("Controller")).toBeLessThan(initial.indexOf("Executions"));
		expect(initial).toContain(".pi");
		expect(initial).toContain("T004");
		selector.handleInput("\x1b[B");
		const moved = selector.render(160).join("\n");
		expect(moved.indexOf("Controller")).toBeLessThan(moved.indexOf("Executions"));
		expect(moved).toMatch(/\n\s{4}>/);
	});
});
