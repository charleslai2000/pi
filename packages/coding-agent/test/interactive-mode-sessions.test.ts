import { describe, expect, it, vi } from "vitest";
import { getSessionRegistry, setSessionRegistryForTesting } from "../src/core/session-registry.ts";
import { CustomEditor } from "../src/modes/interactive/components/custom-editor.ts";
import {
	formatSessionCwd,
	projectLiveSessionCounts,
} from "../src/modes/interactive/components/live-session-projection.ts";
import { LiveSessionSelector } from "../src/modes/interactive/components/live-session-selector.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

type TestLiveSlot = {
	id: string;
	cwd: string;
	sessionFile: undefined;
	session: { sessionName?: string };
	services: Record<string, never>;
	activity: { busy: boolean; unread: boolean; mutationCapable: boolean };
};

function liveSlot(id: string, cwd: string, name?: string): TestLiveSlot {
	return {
		id,
		cwd,
		sessionFile: undefined,
		session: { sessionName: name },
		services: {},
		activity: { busy: false, unread: false, mutationCapable: false },
	};
}

describe("InteractiveMode /sessions live selector", () => {
	it("projects PiRoot-relative cwd and excludes Controller from Execution counts", () => {
		const root = "/workspace/project";
		expect(formatSessionCwd(`${root}/.pi`, root)).toBe(".pi");
		expect(formatSessionCwd(root, root)).toBe(".");
		expect(formatSessionCwd(`${root}/src/routing`, root)).toBe("src/routing");
		expect(formatSessionCwd("/tmp/external", root)).toBe("/tmp/external");
		const controller = liveSlot("controller", root);
		const active = liveSlot("active", root);
		active.activity.busy = true;
		const blocked = liveSlot("blocked", root);
		const idle = liveSlot("idle", root);
		const row = (session_id: string, role: "controller" | "executor") => ({ session_id, role }) as never;
		const counts = projectLiveSessionCounts(
			[
				{ slot: controller as never, row: row("controller", "controller"), task: { status: "BLOCKED" } },
				{ slot: active as never, row: row("active", "executor"), task: { status: "ACTIVE" } },
				{ slot: blocked as never, row: row("blocked", "executor"), task: { status: "BLOCKED" } },
				{ slot: idle as never, row: row("idle", "executor"), task: { status: "DONE" } },
			],
			"controller",
		);
		expect(counts).toEqual({ active: 1, blocked: 1, total: 3 });
	});

	it("keeps selected rows subordinate to Controller/Executions headings", () => {
		initTheme("dark");
		const controller = liveSlot("controller", "/repo/.pi");
		const execution = liveSlot("execution", "/repo/src/routing");
		const selector = new LiveSessionSelector(
			[
				{ slot: controller as never, row: { session_id: "c", role: "controller" } as never },
				{ slot: execution as never, row: { session_id: "e", role: "executor", agent_slug: "debugger" } as never },
			],
			{
				foregroundSlotId: controller.id,
				controllerSlotId: controller.id,
				piRoot: "/repo",
				onSwitch: () => {},
				onClose: () => {},
				onAbort: () => {},
				onCancel: () => {},
			},
		);
		const initial = selector.render(160).join("\n");
		expect(initial.indexOf("Controller")).toBeLessThan(initial.indexOf("Executions"));
		expect(initial).toContain(".pi");
		expect(initial).toContain("src/routing");
		selector.handleInput("\x1b[B");
		const moved = selector.render(160).join("\n");
		expect(moved.indexOf("Controller")).toBeLessThan(moved.indexOf("Executions"));
		expect(moved).toContain("    >");
	});
	it("routes empty-composer Left by canonical Controller role", async () => {
		const originalRegistry = getSessionRegistry();
		setSessionRegistryForTesting({ canonicalControlSessionId: () => "controller-id" } as never);
		const controllerSlot = { id: "controller-slot" };
		const switchForeground = vi.fn(async () => {});
		const context = {
			runtimeHost: { sessionPool: { findBySessionId: vi.fn(() => controllerSlot) }, switchForeground },
			sessionManager: { getSessionId: () => "execution-id" },
			showError: vi.fn(),
		};
		try {
			const route = Reflect.get(InteractiveMode.prototype, "handleEmptyComposerLeft") as (
				this: typeof context,
			) => boolean;
			expect(route.call(context)).toBe(true);
			await Promise.resolve();
			expect(context.runtimeHost.sessionPool.findBySessionId).toHaveBeenCalledWith("controller-id");
			expect(switchForeground).toHaveBeenCalledWith("controller-slot");
			const picker = vi.fn();
			const controllerContext = {
				runtimeHost: context.runtimeHost,
				sessionManager: { getSessionId: () => "controller-id" },
				showLiveSessionSelector: picker,
			};
			expect(route.call(controllerContext as never)).toBe(true);
			expect(picker).toHaveBeenCalledOnce();
		} finally {
			setSessionRegistryForTesting(originalRegistry);
		}
	});

	it("routes empty Left from CustomEditor unless a higher-priority owner declines it", () => {
		const editor = new CustomEditor(
			{} as never,
			{} as never,
			{
				matches: (data: string, key: string) => key === "tui.editor.cursorLeft" && data === "\x1b[D",
			} as never,
		);
		const route = vi.fn(() => true);
		editor.onEmptyCursorLeft = route;
		editor.handleInput("\x1b[D");
		expect(route).toHaveBeenCalledOnce();
		expect(editor.getCursor()).toEqual({ line: 0, col: 0 });
		editor.onEmptyCursorLeft = vi.fn(() => false);
		editor.setText("abc");
		editor.handleInput("\x1b[D");
		expect(editor.getCursor()).toEqual({ line: 0, col: 2 });
	});

	it("uses the live pool, switches foreground, and closes a background slot", async () => {
		initTheme("dark");
		const slotA = liveSlot("slot-a", "/repo", "physical-delay");
		const slotB = liveSlot("slot-b", "/repo/design", "procedural-g");
		let component: LiveSessionSelector | undefined;
		const done = vi.fn();
		const runtimeHost = {
			listActiveSessions: () => [
				{ slot: slotA, row: { role: "executor", session_id: "a", agent_slug: "physical-delay" } },
				{ slot: slotB, row: { role: "executor", session_id: "b", agent_slug: "procedural-g" } },
			],
			sessionPool: {
				foregroundSlotId: slotA.id,
				list: () => [slotA, slotB],
			},
			switchForeground: vi.fn(async () => {}),
			closeSession: vi.fn(async () => true),
			abortSession: vi.fn(async () => true),
		};
		const fakeThis = {
			showStatus: vi.fn(),
			runtimeHost,
			getPiRoot: () => "/repo",
			showSelector: (create: (done: () => void) => { component: LiveSessionSelector }) => {
				component = create(done).component;
			},
		} as unknown as InteractiveMode;

		(
			InteractiveMode.prototype as unknown as { showLiveSessionSelector(this: InteractiveMode): void }
		).showLiveSessionSelector.call(fakeThis);
		expect(component).toBeDefined();
		expect(component!.render(160).join("\n")).toContain("physical-delay");
		expect(component!.render(160).join("\n")).toContain("procedural-g");
		slotA.activity.busy = true;
		slotB.activity.busy = true;
		slotB.activity.unread = true;
		const liveRender = component!.render(160).join("\n");
		expect(liveRender).toContain("busy");
		expect(liveRender).toContain("running/busy · unread");

		component!.handleInput("\x1b[B");
		component!.handleInput("\r");
		await Promise.resolve();
		await Promise.resolve();
		expect(runtimeHost.switchForeground).toHaveBeenCalledWith(slotB.id);
		expect(done).toHaveBeenCalledOnce();

		component!.handleInput("a");
		await Promise.resolve();
		expect(runtimeHost.abortSession).toHaveBeenCalledWith(slotB.id);
		component!.handleInput("x");
		await Promise.resolve();
		expect(runtimeHost.closeSession).toHaveBeenCalledWith(slotB.id);
	});
});
