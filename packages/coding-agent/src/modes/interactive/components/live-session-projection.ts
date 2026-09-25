import { relative, resolve, sep } from "node:path";
import { isPathInsidePiRoot } from "../../../core/pi-root.ts";
import type { SessionSlot } from "../../../core/session-pool.ts";
import type { RegistryRow } from "../../../core/session-registry.ts";

export interface LiveSessionProjection {
	active: number;
	blocked: number;
	total: number;
}

export function projectLiveSessionCounts(
	sessions: readonly { slot: SessionSlot; row?: RegistryRow; task?: { status?: string; remaining?: string } }[],
	controllerSessionId: string | undefined,
): LiveSessionProjection {
	let active = 0;
	let blocked = 0;
	for (const { slot, row, task } of sessions) {
		if (row?.role !== "executor" || row.session_id === controllerSessionId) continue;
		if (slot.activity.busy) active++;
		if (task?.status === "BLOCKED") blocked++;
	}
	return {
		active,
		blocked,
		total: sessions.filter(
			(session) => session.row?.role === "executor" && session.row.session_id !== controllerSessionId,
		).length,
	};
}

export function formatSessionCwd(cwd: string, piRoot: string): string {
	if (!isPathInsidePiRoot(cwd, piRoot)) return resolve(cwd);
	const relativePath = relative(resolve(piRoot), resolve(cwd));
	return relativePath === "" ? "." : relativePath.split(sep).join("/");
}
