const taskMutationQueues = new Map<string, Promise<unknown>>();

export function withTaskMutationLock<T>(taskKey: string, operation: () => T | Promise<T>): Promise<T> {
	const previous = taskMutationQueues.get(taskKey) ?? Promise.resolve();
	const next = previous.catch(() => undefined).then(operation);
	taskMutationQueues.set(taskKey, next);
	void next
		.finally(() => {
			if (taskMutationQueues.get(taskKey) === next) taskMutationQueues.delete(taskKey);
		})
		.catch(() => undefined);
	return next;
}
