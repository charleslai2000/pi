import type { Component } from "@earendil-works/pi-tui";
import type { SessionSlot } from "../../../core/session-pool.ts";
import { theme } from "../theme/theme.ts";

export interface LiveSessionSelectorOptions {
	foregroundSlotId: string;
	onSwitch: (slotId: string) => void | Promise<void>;
	onClose: (slotId: string) => void | Promise<void>;
	onAbort: (slotId: string) => void | Promise<void>;
	onCancel: () => void;
}

/** Minimal selector for already-live session slots. It never reads session files from disk. */
export class LiveSessionSelector implements Component {
	private readonly slots: readonly SessionSlot[];
	private readonly options: LiveSessionSelectorOptions;
	private selectedIndex: number;
	focused = false;

	constructor(slots: readonly SessionSlot[], options: LiveSessionSelectorOptions) {
		this.slots = slots;
		this.options = options;
		this.selectedIndex = Math.max(
			0,
			slots.findIndex((slot) => slot.id === options.foregroundSlotId),
		);
	}

	handleInput(data: string): void {
		if (data === "\x1b" || data === "q") {
			this.options.onCancel();
			return;
		}
		if (data === "\x1b[A" || data === "k") {
			this.selectedIndex = Math.max(0, this.selectedIndex - 1);
			return;
		}
		if (data === "\x1b[B" || data === "j") {
			this.selectedIndex = Math.min(this.slots.length - 1, this.selectedIndex + 1);
			return;
		}
		const slot = this.slots[this.selectedIndex];
		if (!slot) return;
		if (data === "x") {
			void this.options.onClose(slot.id);
			return;
		}
		if (data === "a") {
			if (slot.activity.busy) void this.options.onAbort(slot.id);
			return;
		}
		if (data === "\r" || data === "\n") {
			void this.options.onSwitch(slot.id);
		}
	}

	render(width: number): string[] {
		const lines = [theme.bold("Live sessions"), ""];
		for (let index = 0; index < this.slots.length; index++) {
			const slot = this.slots[index];
			const marker = slot.id === this.options.foregroundSlotId ? "●" : " ";
			const title = slot.session.sessionName ?? slot.cwd.split(/[\\/]/).filter(Boolean).pop() ?? slot.id;
			const status = slot.activity.busy ? "busy" : "idle";
			const unread = slot.activity.unread ? "  unread" : "";
			const suffix = ` · ${slot.id}`;
			const prefix = index === this.selectedIndex ? ">" : " ";
			lines.push(`${prefix} ${marker} ${title}${suffix}  ${status}${unread}  ${slot.cwd}`.slice(0, width));
		}
		lines.push("", theme.fg("muted", "Enter switch · a abort · x close · Esc cancel"));
		return lines;
	}

	invalidate(): void {}
}
