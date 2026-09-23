import type { Component } from "@earendil-works/pi-tui";
import type { SessionSlot } from "../../../core/session-pool.ts";
import type { RegistryRow } from "../../../core/session-registry.ts";
import { theme } from "../theme/theme.ts";

export interface LiveSessionDisplay {
	slot: SessionSlot;
	row?: RegistryRow;
	task?: { goalId: string; taskId: string; status?: string };
}

export interface LiveSessionSelectorOptions {
	foregroundSlotId: string;
	onSwitch: (slotId: string) => void | Promise<void>;
	onClose: (slotId: string) => void | Promise<void>;
	onAbort: (slotId: string) => void | Promise<void>;
	onCancel: () => void;
}

/** Minimal selector for already-live session slots. It never reads session files from disk. */
export class LiveSessionSelector implements Component {
	private readonly slots: readonly LiveSessionDisplay[];
	private readonly options: LiveSessionSelectorOptions;
	private selectedIndex: number;
	focused = false;

	constructor(slots: readonly (LiveSessionDisplay | SessionSlot)[], options: LiveSessionSelectorOptions) {
		this.slots = slots.map((entry) => ("slot" in entry ? entry : { slot: entry }));
		this.options = options;
		this.selectedIndex = Math.max(
			0,
			this.slots.findIndex((display) => display.slot.id === options.foregroundSlotId),
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
		const display = this.slots[this.selectedIndex];
		if (!display) return;
		const slot = display.slot;
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
			const display = this.slots[index]!;
			const slot = display.slot;
			const marker = slot.id === this.options.foregroundSlotId ? "●" : " ";
			const role = display.row?.role ?? "unassigned";
			const title = slot.session.sessionName ?? slot.cwd.split(/[\\/]/).filter(Boolean).pop() ?? slot.id;
			const status = slot.activity.busy ? "running/busy" : "idle";
			const task = display.task ? ` · ${display.task.goalId}/${display.task.taskId}` : "";
			const unread = slot.activity.unread ? "  unread" : "";
			const indent = role === "executor" ? "  " : "";
			const prefix = index === this.selectedIndex ? ">" : " ";
			lines.push(
				`${prefix} ${indent}${marker} ${role} · ${title} · ${slot.id} · ${status}${unread}${task}  ${slot.cwd}`.slice(
					0,
					width,
				),
			);
		}
		lines.push("", theme.fg("muted", "Enter switch · a abort · x close · Esc cancel"));
		return lines;
	}

	invalidate(): void {}
}
