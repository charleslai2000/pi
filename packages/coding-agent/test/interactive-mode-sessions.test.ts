import { describe, expect, it, vi } from "vitest";
import type { LiveSessionSelector } from "../src/modes/interactive/components/live-session-selector.ts";
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
	it("uses the live pool, switches foreground, and closes a background slot", async () => {
		initTheme("dark");
		const slotA = liveSlot("slot-a", "/repo", "physical-delay");
		const slotB = liveSlot("slot-b", "/repo/design", "procedural-g");
		let component: LiveSessionSelector | undefined;
		const done = vi.fn();
		const runtimeHost = {
			listActiveSessions: () => [{ slot: slotA }, { slot: slotB }],
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
		expect(liveRender).toContain("busy  unread");

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
