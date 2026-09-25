import type { Component } from "@earendil-works/pi-tui";
import type { SessionSlot } from "../../../core/session-pool.ts";
import type { RegistryRow } from "../../../core/session-registry.ts";
import { theme } from "../theme/theme.ts";
import { formatSessionCwd } from "./live-session-projection.ts";

export interface LiveSessionDisplay {
	slot: SessionSlot;
	row?: RegistryRow;
	task?: { goalId: string; taskId: string; status?: string };
}

export interface LiveSessionSelectorOptions {
	foregroundSlotId: string;
	controllerSlotId?: string;
	piRoot: string;
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
	private readonly controllerSlotId: string | undefined;
	private readonly piRoot: string;
	focused = false;

	constructor(slots: readonly (LiveSessionDisplay | SessionSlot)[], options: LiveSessionSelectorOptions) {
		this.slots = slots.map((entry) => ("slot" in entry ? entry : { slot: entry }));
		this.options = options;
		this.controllerSlotId = options.controllerSlotId;
		this.piRoot = options.piRoot;
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
		const controllerIndex = this.slots.findIndex(
			(display) => display.slot.id === this.controllerSlotId || display.row?.role === "controller",
		);
		if (controllerIndex >= 0) {
			lines.push("  Controller");
			lines.push(this.renderRow(controllerIndex, false, width));
		}
		const executionIndexes = this.slots
			.map((display, index) => ({ display, index }))
			.filter(({ display, index }) => index !== controllerIndex && display.row?.role === "executor")
			.map(({ index }) => index);
		if (executionIndexes.length > 0) {
			lines.push("", "  Executions");
			for (const index of executionIndexes) lines.push(this.renderRow(index, true, width));
		}
		const otherIndexes = this.slots
			.map((display, index) => ({ display, index }))
			.filter(
				({ display, index }) =>
					index !== controllerIndex && display.row?.role !== "executor" && display.row?.role !== "controller",
			)
			.map(({ index }) => index);
		if (otherIndexes.length > 0) {
			lines.push("", "  Other sessions");
			for (const index of otherIndexes) lines.push(this.renderRow(index, true, width));
		}
		lines.push("", theme.fg("muted", "Enter switch · a abort · x close · Esc cancel"));
		return lines;
	}

	private renderRow(index: number, execution: boolean, width: number): string {
		const display = this.slots[index]!;
		const slot = display.slot;
		const selected = index === this.selectedIndex;
		const marker = slot.id === this.options.foregroundSlotId ? "●" : " ";
		const role = display.row?.role ?? "unassigned";
		const status = slot.activity.busy ? "running/busy" : "idle";
		const taskId = display.task?.taskId ?? display.row?.task_id;
		const task = taskId ? ` · ${taskId}` : "";
		const agent = display.row?.agent_slug ?? slot.session.sessionName ?? (execution ? "execution" : role);
		const unread = slot.activity.unread ? " · unread" : "";
		const indent = execution ? "    " : "  ";
		const prefix = selected ? ">" : " ";
		return `${indent}${prefix} ${marker} ${agent} · ${slot.id} · ${status}${task}${unread} · ${formatSessionCwd(slot.cwd, this.piRoot)}`.slice(
			0,
			width,
		);
	}

	invalidate(): void {}
}
