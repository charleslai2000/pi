import { getSessionRegistry } from "../session-registry.ts";
import { type AssociationRecord, readAssociations } from "./associations.ts";
import { type FrontierEntry, readFrontier } from "./frontier.ts";
import { readTask, type TaskRecord } from "./read-model.ts";
import { isTerminalTaskStatus } from "./task-status.ts";

export interface ControlTaskView {
	readonly goalId: string;
	readonly taskId?: string;
	readonly taskStatus?: string;
	readonly workArea?: string;
	readonly objective?: string;
	readonly frontier?: {
		readonly state: "active" | "deferred";
		readonly blocker?: string;
		readonly next?: string;
	};
	readonly assignment?: {
		readonly sessionId: string;
		readonly sessionName?: string;
		readonly cwd?: string;
		readonly runtimeState: "active" | "inactive";
	};
	readonly warnings: readonly string[];
}

function assignmentFor(
	association: AssociationRecord,
	goalId: string,
	taskId: string,
): AssociationRecord["current"][number] | undefined {
	return association.current.find((item) => item.goalId === goalId && item.taskId === taskId);
}

function makeView(
	_piRoot: string,
	entry: FrontierEntry | undefined,
	goalId: string,
	taskId: string | undefined,
	task: TaskRecord | undefined,
	association: AssociationRecord,
): ControlTaskView {
	const assignment = taskId === undefined ? undefined : assignmentFor(association, goalId, taskId);
	const registry = getSessionRegistry();
	const row = assignment
		? registry?.rows().find((candidate) => candidate.session_id === assignment.sessionId)
		: undefined;
	const warnings: string[] = [];
	const terminal = isTerminalTaskStatus(task?.status);
	if (terminal && task?.status === "DONE" && entry?.state === "active") warnings.push("task_done_but_frontier_active");
	if (task?.status === "DONE" && assignment) warnings.push("task_done_but_currently_assigned");
	if (task?.status === "CANCELLED" && entry?.state === "active") warnings.push("task_cancelled_but_frontier_active");
	if (task?.status === "CANCELLED" && assignment) warnings.push("task_cancelled_but_currently_assigned");
	return {
		goalId,
		taskId,
		taskStatus: task?.status,
		workArea: task?.workArea,
		objective: task?.objective,
		frontier: entry ? { state: entry.state, blocker: entry.blocker, next: entry.next } : undefined,
		assignment: assignment
			? {
					sessionId: assignment.sessionId,
					sessionName: row?.name ?? undefined,
					cwd: row?.cwd,
					runtimeState: row?.runtime_state ?? "inactive",
				}
			: undefined,
		warnings,
	};
}

export function getTaskControlView(piRoot: string, goalId: string, taskId: string): ControlTaskView {
	const task = readTask(piRoot, goalId, taskId);
	const frontier = readFrontier(piRoot);
	const entry = frontier.entries.find((item) => item.goalId === goalId && item.taskId === taskId);
	return makeView(piRoot, entry, goalId, taskId, task, readAssociations(piRoot));
}

export function listFrontierControlViews(piRoot: string): ControlTaskView[] {
	const frontier = readFrontier(piRoot);
	const association = readAssociations(piRoot);
	return frontier.entries.map((entry) => {
		if (entry.taskId === undefined) return makeView(piRoot, entry, entry.goalId, undefined, undefined, association);
		return makeView(
			piRoot,
			entry,
			entry.goalId,
			entry.taskId,
			readTask(piRoot, entry.goalId, entry.taskId),
			association,
		);
	});
}
