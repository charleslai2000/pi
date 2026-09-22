export type TaskStatus = "READY" | "ACTIVE" | "BLOCKED" | "DEFERRED" | "DONE" | "CANCELLED";

const taskStatuses = new Set<TaskStatus>(["READY", "ACTIVE", "BLOCKED", "DEFERRED", "DONE", "CANCELLED"]);
const terminalTaskStatuses = new Set<TaskStatus>(["DONE", "CANCELLED"]);

export function parseTaskStatus(status: string | undefined): TaskStatus | undefined {
	if (status === undefined) return undefined;
	const normalized = status.trim();
	return taskStatuses.has(normalized as TaskStatus) ? (normalized as TaskStatus) : undefined;
}

export function isTerminalTaskStatus(status: string | undefined): boolean {
	const parsed = parseTaskStatus(status);
	return parsed !== undefined && terminalTaskStatuses.has(parsed);
}

export function isDispatchableTaskStatus(status: string | undefined): boolean {
	const parsed = parseTaskStatus(status);
	return parsed !== undefined && !terminalTaskStatuses.has(parsed);
}

export function isTaskStatus(status: string | undefined): status is TaskStatus {
	return parseTaskStatus(status) !== undefined;
}
