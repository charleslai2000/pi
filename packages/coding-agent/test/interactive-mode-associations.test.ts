import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import { readAssociations } from "../src/core/control/associations.ts";
import { getPiRoot, setPiRoot } from "../src/core/pi-root.ts";
import { getDefaultSessionDir } from "../src/core/session-manager.ts";
import { SessionRegistry, setSessionRegistryForTesting } from "../src/core/session-registry.ts";
import { BUILTIN_SLASH_COMMANDS } from "../src/core/slash-commands.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";

function makeFixture(): { root: string; sessionDir: string; d1: string; d2: string; control: string } {
	const root = mkdtempSync(join("/tmp", "pi-interactive-associations-"));
	const control = join(root, "control");
	const taskDir = join(control, "goal-a", "tasks");
	mkdirSync(taskDir, { recursive: true });
	writeFileSync(join(control, "goal-a", "goal.md"), "# Goal A\n");
	writeFileSync(join(taskDir, "T001-work.md"), "Status: READY\n");
	writeFileSync(join(taskDir, "T002-work.md"), "Status: READY\n");
	setPiRoot(root, "legacy");
	const sessionDir = getDefaultSessionDir(root);
	const d1 = "d1-session";
	const d2 = "d2-session";
	for (const [id, cwd] of [
		[d1, join(root, "work-1")],
		[d2, join(root, "work-2")],
	]) {
		mkdirSync(cwd, { recursive: true });
		writeFileSync(
			join(sessionDir, `${id}.jsonl`),
			`${JSON.stringify({ type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd })}\n`,
		);
	}
	return { root, sessionDir, d1, d2, control };
}

function runtimeFor(_root: string, foregroundId: string, name: string): AgentSessionRuntime {
	const fakeSession = {
		sessionManager: { getSessionId: () => foregroundId, getSessionName: () => name },
	};
	const pool = {
		getForeground: () => ({ session: fakeSession }),
	};
	return Object.assign(Object.create(AgentSessionRuntime.prototype) as AgentSessionRuntime, {
		_sessionPool: pool,
	});
}

function commandContext(
	runtimeHost: AgentSessionRuntime,
	status: ReturnType<typeof vi.fn>,
	error: ReturnType<typeof vi.fn>,
) {
	const context = Object.assign(Object.create(InteractiveMode.prototype), {
		runtimeHost,
		editor: { setText: vi.fn() },
		defaultEditor: {} as { onSubmit?: (text: string) => Promise<void> },
		showStatus: status,
		showError: error,
	});
	(
		InteractiveMode.prototype as unknown as { setupEditorSubmitHandler(this: typeof context): void }
	).setupEditorSubmitHandler.call(context);
	return context.defaultEditor.onSubmit!;
}

afterEach(() => {
	const registry = undefined;
	setSessionRegistryForTesting(registry);
	setPiRoot(undefined);
});

describe("InteractiveMode association commands", () => {
	it("drives assign/no-op, conflict, reassign inactive target, unassign, and queries through input", async () => {
		const value = makeFixture();
		const registry = new SessionRegistry(value.root, { acquire: false });
		setSessionRegistryForTesting(registry);
		const runtime = runtimeFor(value.root, value.d1, "D1");
		const status = vi.fn();
		const error = vi.fn();
		const submit = commandContext(runtime, status, error);
		const taskBefore = readFileSync(join(value.control, "goal-a", "tasks", "T001-work.md"));
		await submit("/assign goal-a/T001");
		let record = readAssociations(value.root);
		expect(record.current).toEqual([
			expect.objectContaining({ goalId: "goal-a", taskId: "T001", sessionId: value.d1 }),
		]);
		expect(record.history).toHaveLength(1);
		expect(readFileSync(join(value.control, "goal-a", "tasks", "T001-work.md"))).toEqual(taskBefore);
		await submit("/assign goal-a/T001");
		expect(readAssociations(value.root).history).toHaveLength(1);

		Object.assign(runtime, {
			_sessionPool: {
				getForeground: () => ({
					session: { sessionManager: { getSessionId: () => value.d2, getSessionName: () => "D2" } },
				}),
			},
		});
		await submit("/assign goal-a/T001");
		expect(error.mock.calls.at(-1)?.[0]).toContain("Task is already assigned");
		expect(readAssociations(value.root).history).toHaveLength(1);

		await submit(`/reassign goal-a/T001 ${value.d2}`);
		record = readAssociations(value.root);
		expect(record.current[0]?.sessionId).toBe(value.d2);
		expect(record.history.slice(-2).map((event) => [event.type, event.sessionId])).toEqual([
			["unassigned", value.d1],
			["assigned", value.d2],
		]);
		await submit(`/reassign goal-a/T001 ${value.d2}`);
		expect(readAssociations(value.root).history).toHaveLength(3);
		await submit("/unassign goal-a/T001");
		expect(readAssociations(value.root).current).toHaveLength(0);
		expect(readAssociations(value.root).history).toHaveLength(4);
		await submit("/unassign goal-a/T001");
		expect(readAssociations(value.root).history).toHaveLength(4);

		await submit("/assignment");
		expect(status.mock.calls.at(-1)?.[0]).toContain("No current task assignment");
		await submit("/assignment goal-a/T001");
		expect(status.mock.calls.at(-1)?.[0]).toContain("No current task assignment");
		expect(getPiRoot()).toBe(value.root);
		rmSync(value.root, { recursive: true, force: true });
	});

	it("rejects identity forms and missing references without mutation", async () => {
		const value = makeFixture();
		const registry = new SessionRegistry(value.root, { acquire: false });
		setSessionRegistryForTesting(registry);
		const runtime = runtimeFor(value.root, value.d1, "D1");
		const submit = commandContext(runtime, vi.fn(), vi.fn());
		for (const input of [
			"/assign ../T001",
			"/assign /goal-a/T001",
			"/assign control/goal-a/tasks/T001.md",
			"/assign goal-a/T001/extra",
			"/assign missing/T001",
			"/assign goal-a/T999",
		]) {
			await submit(input);
		}
		expect(readAssociations(value.root).exists).toBe(false);
		rmSync(value.root, { recursive: true, force: true });
	});

	it("assigns an explicit foreground canonical control Session through /assign", async () => {
		const value = makeFixture();
		const controlId = "canonical-control";
		const controlCwd = join(value.root, "control");
		writeFileSync(
			join(value.sessionDir, `${controlId}.jsonl`),
			`${JSON.stringify({ type: "session", version: 3, id: controlId, timestamp: new Date().toISOString(), cwd: controlCwd })}\n`,
		);
		const registry = new SessionRegistry(value.root, { acquire: false });
		registry.rebuild([
			{
				id: controlId,
				path: join(value.sessionDir, `${controlId}.jsonl`),
				cwd: controlCwd,
				name: "control",
				created: new Date(),
				modified: new Date(),
				messageCount: 0,
				firstMessage: "",
				allMessagesText: "",
			},
		]);
		registry.setCanonicalControlSessionId(controlId);
		setSessionRegistryForTesting(registry);
		const runtime = runtimeFor(value.root, controlId, "control");
		const status = vi.fn();
		const error = vi.fn();
		const submit = commandContext(runtime, status, error);

		await submit("/assign goal-a/T001");
		expect(error).not.toHaveBeenCalled();
		expect(readAssociations(value.root).current).toEqual([
			expect.objectContaining({ goalId: "goal-a", taskId: "T001", sessionId: controlId }),
		]);
		expect(readAssociations(value.root).history).toHaveLength(1);
		expect(registry.rows().find((row) => row.session_id === controlId)?.role).toBe("control");
		expect(runtime.session.sessionManager.getSessionId()).toBe(controlId);

		await submit("/assign goal-a/T001");
		expect(readAssociations(value.root).history).toHaveLength(1);
		rmSync(value.root, { recursive: true, force: true });
	});

	it("reconstructs /assignment from assignments.json after a new control plane", async () => {
		const value = makeFixture();
		const registryA = new SessionRegistry(value.root, { acquire: false });
		registryA.rebuild([
			{
				id: value.d1,
				path: join(value.sessionDir, `${value.d1}.jsonl`),
				cwd: join(value.root, "work-1"),
				name: "D1",
				created: new Date(),
				modified: new Date(),
				messageCount: 0,
				firstMessage: "",
				allMessagesText: "",
			},
		]);
		setSessionRegistryForTesting(registryA);
		const runtimeA = runtimeFor(value.root, value.d1, "D1");
		const submitA = commandContext(runtimeA, vi.fn(), vi.fn());
		await submitA("/assign goal-a/T001");
		expect(readAssociations(value.root).current[0]?.sessionId).toBe(value.d1);
		registryA.close();
		setSessionRegistryForTesting(undefined);
		setPiRoot(undefined);

		setPiRoot(value.root, "legacy");
		const registryB = new SessionRegistry(value.root, { acquire: false });
		registryB.rebuild([
			{
				id: value.d1,
				path: join(value.sessionDir, `${value.d1}.jsonl`),
				cwd: join(value.root, "work-1"),
				name: "D1-restarted",
				created: new Date(),
				modified: new Date(),
				messageCount: 0,
				firstMessage: "",
				allMessagesText: "",
			},
		]);
		setSessionRegistryForTesting(registryB);
		const runtimeB = runtimeFor(value.root, value.d2, "new-foreground");
		const status = vi.fn();
		const submitB = commandContext(runtimeB, status, vi.fn());
		await submitB("/assignment goal-a/T001");
		expect(status.mock.calls.at(-1)?.[0]).toContain("goal-a/T001");
		expect(status.mock.calls.at(-1)?.[0]).toContain("D1-restarted");
		expect(status.mock.calls.at(-1)?.[0]).toContain("active");
		expect(status.mock.calls.at(-1)?.[0]).toContain(join(value.root, "work-1"));
		rmSync(value.root, { recursive: true, force: true });
	});

	it("permits explicit control-session assignment and exposes command discovery", () => {
		expect(BUILTIN_SLASH_COMMANDS.map((command) => command.name)).toEqual(
			expect.arrayContaining(["assign", "reassign", "unassign", "assignment"]),
		);
	});
});
