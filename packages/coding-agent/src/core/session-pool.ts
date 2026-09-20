import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import type { AgentSession } from "./agent-session.ts";
import type { AgentSessionServices } from "./agent-session-services.ts";

export interface SessionActivity {
	busy: boolean;
	unread: boolean;
	mutationCapable: boolean;
}

export type SessionActivityEvent =
	| { slot: SessionSlot; type: "started" | "settled" | "completed"; outcome?: "success" | "error" }
	| { type: "conflict"; worktreeRoot: string; slots: readonly SessionSlot[] };

export interface SessionSlot {
	readonly id: string;
	readonly session: AgentSession;
	readonly services: AgentSessionServices;
	readonly cwd: string;
	readonly sessionFile: string | undefined;
	readonly gitWorktreeRoot: string | undefined;
	readonly activity: SessionActivity;
}

class RuntimeSessionSlot implements SessionSlot {
	readonly id: string;
	readonly session: AgentSession;
	readonly services: AgentSessionServices;
	readonly activity: SessionActivity;
	private readonly unsubscribeActivity: () => void;
	private suppressNextCompletion = false;

	constructor(
		id: string,
		session: AgentSession,
		services: AgentSessionServices,
		onForeground: () => boolean,
		onActivity: (slot: SessionSlot, event: Omit<Exclude<SessionActivityEvent, { type: "conflict" }>, "slot">) => void,
		gitWorktreeRoot: string | undefined,
	) {
		this.id = id;
		this.session = session;
		this.services = services;
		this.gitWorktreeRoot = gitWorktreeRoot;
		this.activity = { busy: session.isStreaming, unread: false, mutationCapable: false };
		this.unsubscribeActivity =
			typeof session.subscribe === "function"
				? session.subscribe((event) => {
						if (event.type === "agent_start") {
							this.activity.busy = true;
							this.activity.mutationCapable = session.agent.state.tools.some((tool) =>
								["write", "edit", "bash"].includes(tool.name),
							);
							onActivity(this, { type: "started" });
						}
						if (event.type === "agent_settled") {
							this.activity.busy = false;
							this.activity.mutationCapable = false;
							this.suppressNextCompletion = false;
							onActivity(this, { type: "settled" });
						}
						if (
							event.type === "agent_end" &&
							!onForeground() &&
							!event.willRetry &&
							!this.suppressNextCompletion
						) {
							this.activity.unread = true;
							const outcome = event.messages.some(
								(message) => message.role === "assistant" && message.stopReason === "error",
							)
								? "error"
								: "success";
							onActivity(this, { type: "completed", outcome });
						}
						if (event.type === "agent_end" && this.suppressNextCompletion) this.suppressNextCompletion = false;
					})
				: () => {};
	}

	suppressCompletion(): void {
		this.suppressNextCompletion = true;
	}

	close(): void {
		this.unsubscribeActivity();
	}

	get cwd(): string {
		return this.services.cwd;
	}

	get sessionFile(): string | undefined {
		return this.session.sessionFile;
	}
}

function resolveGitWorktreeRoot(cwd: string): string | undefined {
	try {
		const root = execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		return root ? realpathSync(root) : undefined;
	} catch {
		return undefined;
	}
}

/** Owns live session slots and the current foreground selection. */
export class SessionPool {
	private readonly slots = new Map<string, RuntimeSessionSlot>();
	private nextId = 1;
	private _foregroundSlotId: string | undefined;
	private readonly activityListeners = new Set<(event: SessionActivityEvent) => void>();
	private readonly conflictRoots = new Set<string>();

	suppressCompletion(slotId: string): void {
		this.slots.get(slotId)?.suppressCompletion();
	}

	subscribeActivity(listener: (event: SessionActivityEvent) => void): () => void {
		this.activityListeners.add(listener);
		return () => this.activityListeners.delete(listener);
	}

	private emitActivity(event: Exclude<SessionActivityEvent, { type: "conflict" }>): void {
		for (const listener of this.activityListeners) listener(event);
		this.updateConflicts();
	}

	private updateConflicts(): void {
		const groups = new Map<string, SessionSlot[]>();
		for (const slot of this.slots.values()) {
			if (!slot.gitWorktreeRoot || !slot.activity.busy || !slot.activity.mutationCapable) continue;
			const group = groups.get(slot.gitWorktreeRoot) ?? [];
			group.push(slot);
			groups.set(slot.gitWorktreeRoot, group);
		}
		for (const [root, slots] of groups) {
			if (slots.length >= 2 && !this.conflictRoots.has(root)) {
				this.conflictRoots.add(root);
				for (const listener of this.activityListeners) listener({ type: "conflict", worktreeRoot: root, slots });
			}
		}
		for (const root of this.conflictRoots) if (!groups.has(root)) this.conflictRoots.delete(root);
	}

	adopt(session: AgentSession, services: AgentSessionServices): SessionSlot {
		const id = `slot-${this.nextId++}`;
		const gitWorktreeRoot = resolveGitWorktreeRoot(services.cwd);
		const slot = new RuntimeSessionSlot(
			id,
			session,
			services,
			() => this._foregroundSlotId === id,
			(slot, event) => this.emitActivity({ slot, ...event }),
			gitWorktreeRoot,
		);
		this.slots.set(id, slot);
		if (this._foregroundSlotId === undefined) this._foregroundSlotId = id;
		return slot;
	}

	get foregroundSlotId(): string | undefined {
		return this._foregroundSlotId;
	}

	get(slotId: string): SessionSlot | undefined {
		return this.slots.get(slotId);
	}

	has(slotId: string): boolean {
		return this.slots.has(slotId);
	}

	list(): readonly SessionSlot[] {
		return [...this.slots.values()];
	}

	getForeground(): SessionSlot {
		if (this._foregroundSlotId === undefined) {
			throw new Error("Session pool has no foreground slot");
		}
		const slot = this.slots.get(this._foregroundSlotId);
		if (!slot) throw new Error(`Foreground session slot ${this._foregroundSlotId} is missing`);
		return slot;
	}

	/** Change presentation ownership only; this never aborts, shuts down, invalidates, or disposes a slot. */
	setForeground(slotId: string): void {
		if (!this.slots.has(slotId)) throw new Error(`Unknown session slot: ${slotId}`);
		this._foregroundSlotId = slotId;
		const slot = this.slots.get(slotId);
		if (slot) slot.activity.unread = false;
	}

	/** Remove a slot after its owner has completed any required close/dispose sequence. */
	remove(slotId: string): SessionSlot | undefined {
		const slot = this.slots.get(slotId);
		if (!slot) return undefined;
		if (this._foregroundSlotId === slotId) {
			throw new Error("Cannot remove the foreground session slot");
		}
		this.slots.delete(slotId);
		slot.close();
		this.updateConflicts();
		return slot;
	}

	/** Remove a slot after it has been disposed, including the current foreground slot. */
	removeClosed(slotId: string): SessionSlot | undefined {
		const slot = this.slots.get(slotId);
		if (!slot) return undefined;
		this.slots.delete(slotId);
		if (this._foregroundSlotId === slotId) this._foregroundSlotId = undefined;
		slot.close();
		this.updateConflicts();
		return slot;
	}
}
