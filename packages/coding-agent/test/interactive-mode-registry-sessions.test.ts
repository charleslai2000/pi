import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setPiRoot } from "../src/core/pi-root.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SessionPool } from "../src/core/session-pool.ts";
import { SessionRegistry, setSessionRegistryForTesting } from "../src/core/session-registry.ts";
import { LiveSessionSelector } from "../src/modes/interactive/components/live-session-selector.ts";
import { SessionSelectorComponent } from "../src/modes/interactive/components/session-selector.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function make(): { root: string; registry: SessionRegistry; pool: SessionPool } {
	const base = mkdtempSync(join("/tmp", "pi-interactive-registry-"));
	const root = join(base, "project");
	mkdirSync(join(root, ".pi"), { recursive: true });
	mkdirSync(join(root, "control"), { recursive: true });
	mkdirSync(join(root, "design"), { recursive: true });
	setPiRoot(root, "formal");
	const registry = new SessionRegistry(root);
	setSessionRegistryForTesting(registry);
	return { root, registry, pool: new SessionPool() };
}

type TestSession = {
	sessionManager: { getSessionId: () => string; getSessionName: () => string | undefined };
	sessionFile: string | undefined;
	sessionName?: string;
	isStreaming: boolean;
	subscribe: () => () => void;
	setSessionName?: (name: string) => void;
};

function fakeSession(id: string, name: string): TestSession {
	return {
		sessionManager: { getSessionId: () => id, getSessionName: () => name },
		sessionFile: `/tmp/${id}.jsonl`,
		sessionName: name,
		isStreaming: false,
		subscribe: () => () => {},
	};
}

function fakeServices(cwd: string) {
	return { cwd, agentDir: "/tmp/agent" };
}

afterEach(() => {
	setSessionRegistryForTesting(undefined);
	setPiRoot(undefined);
});

describe("InteractiveMode Registry session paths", () => {
	it("keeps the renamed identity across command, close, and resume selectors", async () => {
		initTheme("dark");
		const value = make();
		const sessionDir = join(value.root, "sessions");
		const controlManager = SessionManager.create(join(value.root, ".pi"), sessionDir);
		controlManager.persistSessionHeader();
		const designManager = SessionManager.create(join(value.root, "design"), sessionDir);
		designManager.persistSessionHeader();
		const control = fakeSession(controlManager.getSessionId(), "control");
		const design = fakeSession(designManager.getSessionId(), "design");
		control.sessionManager = controlManager;
		design.sessionManager = designManager;
		control.sessionFile = controlManager.getSessionFile();
		design.sessionFile = designManager.getSessionFile();
		design.setSessionName = (name: string) => {
			designManager.appendSessionInfo(name);
			design.sessionName = designManager.getSessionName();
		};
		const controlSlot = value.pool.adopt(control as never, fakeServices(join(value.root, ".pi")) as never);
		value.pool.adopt(design as never, fakeServices(join(value.root, "design")) as never);
		value.registry.setCanonicalControlSessionId(controlManager.getSessionId());
		const originalId = designManager.getSessionId();
		const originalFile = designManager.getSessionFile();
		const fakeThis = {
			session: design,
			sessionManager: designManager,
			chatContainer: { addChild: vi.fn() },
			ui: { requestRender: vi.fn() },
			showWarning: vi.fn(),
		} as unknown as InteractiveMode;
		(
			InteractiveMode.prototype as unknown as { handleNameCommand(this: InteractiveMode, text: string): void }
		).handleNameCommand.call(fakeThis, "/rename architecture");
		expect(designManager.getSessionName()).toBe("architecture");
		expect(value.registry.rows().find((row) => row.session_id === originalId)?.name).toBe("architecture");
		expect(designManager.getSessionFile()).toBe(originalFile);
		const entries = designManager.getEntries();
		expect([...entries].reverse().find((entry) => entry.type === "session_info")?.name).toBe("architecture");
		const live: LiveSessionSelector = new LiveSessionSelector(value.pool.list() as never, {
			foregroundSlotId: controlSlot.id,
			onSwitch: () => {},
			onAbort: () => {},
			onCancel: () => {},
			onClose: async (slotId) => {
				value.pool.deactivate(slotId);
				value.pool.removeClosed(slotId);
			},
		});
		live.handleInput("j");
		live.handleInput("x");
		await vi.waitFor(() => expect(value.pool.findBySessionId(originalId)).toBeUndefined());
		const inactive = value.registry.inactiveRows().find((row) => row.session_id === originalId)!;
		expect(inactive.name).toBe("architecture");
		const resume = new SessionSelectorComponent(
			async () => [
				{
					path: inactive.session_file!,
					id: inactive.session_id,
					cwd: inactive.cwd,
					name: inactive.name ?? undefined,
					created: new Date(inactive.updated_at),
					modified: new Date(inactive.updated_at),
					messageCount: 0,
					firstMessage: "",
					allMessagesText: "",
				},
			],
			async () => [],
			async () => {
				const restored = fakeSession(originalId, inactive.name!);
				restored.sessionManager = designManager;
				restored.sessionFile = originalFile;
				const slot = value.pool.adopt(restored as never, fakeServices(inactive.cwd) as never);
				value.pool.setForeground(slot.id);
			},
			() => {},
			() => {},
			() => {},
			{ keybindings: undefined },
			controlManager.getSessionFile(),
		);
		await new Promise((resolve) => setTimeout(resolve, 10));
		resume.handleInput("\r");
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(value.pool.findBySessionId(originalId)).toBeDefined();
		expect(value.registry.rows().find((row) => row.session_id === originalId)?.name).toBe("architecture");
		expect(value.pool.getForeground().session.sessionName).toBe("architecture");
	});
	it("rejects a corrupt inactive catalog entry through the resume loader", async () => {
		initTheme("dark");
		const value = make();
		const c1 = fakeSession("c1", "control");
		const controlSlot = value.pool.adopt(c1 as never, fakeServices(join(value.root, ".pi")) as never);
		value.registry.setCanonicalControlSessionId("c1");
		value.registry.rebuild([
			{
				id: "d1",
				path: "/tmp/d1.jsonl",
				cwd: join(value.root, "design"),
				name: "design",
				created: new Date(0),
				modified: new Date(0),
				messageCount: 0,
				firstMessage: "",
				allMessagesText: "",
			},
		]);
		let prepareCalls = 0;
		const loader = () => {
			const rows = value.registry.inactiveRows();
			return rows.map((row) => {
				if (!row.session_file)
					throw new Error(`Session catalog entry is invalid: missing session file (${row.session_id})`);
				prepareCalls++;
				return row.session_file;
			});
		};
		value.registry.setInactive("d1");
		const rows = value.registry.rows();
		const dbRow = rows.find((row) => row.session_id === "d1");
		expect(dbRow).toBeDefined();
		const database = new DatabaseSync(join(value.root, ".pi", "state", "control.sqlite3"));
		database.prepare("UPDATE sessions SET session_file=NULL WHERE session_id='d1'").run();
		database.close();
		const selectorLoader = () => {
			const row = value.registry.rows().find((candidate) => candidate.session_id === "d1");
			if (!row?.session_file) throw new Error(`Session catalog entry is invalid: missing session file (d1)`);
			return loader();
		};
		expect(() => selectorLoader()).toThrow("Session catalog entry is invalid: missing session file (d1)");
		expect(prepareCalls).toBe(0);
		expect(value.pool.getForeground()).toBe(controlSlot);
	});

	it("uses real selector actions for close then resume with stable identity", async () => {
		initTheme("dark");
		const value = make();
		const c1 = fakeSession("c1", "control");
		const d1 = fakeSession("d1", "design");
		const controlSlot = value.pool.adopt(c1 as never, fakeServices(join(value.root, ".pi")) as never);
		const _designSlot = value.pool.adopt(d1 as never, fakeServices(join(value.root, "design")) as never);
		value.registry.setCanonicalControlSessionId("c1");
		const originalFile = d1.sessionFile;
		let live: LiveSessionSelector | undefined;
		let resume: SessionSelectorComponent | undefined;
		const done = vi.fn();
		const runtimeHost = {
			listActiveSessions: () =>
				value.registry.activeRows().map((row) => ({ row, slot: value.pool.findBySessionId(row.session_id)! })),
			listInactiveSessions: () => value.registry.inactiveRows().filter((row) => row.session_file),
			sessionPool: value.pool,
			closeSession: vi.fn(async (slotId: string) => {
				value.pool.deactivate(slotId);
				value.pool.removeClosed(slotId);
				return true;
			}),
			abortSession: vi.fn(async () => true),
			switchForeground: vi.fn(async (slotId: string) => value.pool.setForeground(slotId)),
			prepareSession: vi.fn(async () => {
				throw new Error("not used in fake presentation");
			}),
			resumePrepared: vi.fn(async () => {}),
		};
		const fakeThis = {
			runtimeHost,
			showStatus: vi.fn(),
			ui: { requestRender: vi.fn() },
			keybindings: undefined,
			showSelector: (
				create: (done: () => void) => { component: LiveSessionSelector | SessionSelectorComponent },
			) => {
				const result = create(done).component;
				if (result.constructor.name === "LiveSessionSelector") live = result as LiveSessionSelector;
				else resume = result as SessionSelectorComponent;
			},
			sessionManager: { getSessionFile: () => c1.sessionFile },
		} as unknown as InteractiveMode;

		(
			InteractiveMode.prototype as unknown as { showLiveSessionSelector(this: InteractiveMode): void }
		).showLiveSessionSelector.call(fakeThis);
		expect(live?.render(200).join("\n")).toContain("control");
		expect(live?.render(200).join("\n")).toContain("design");
		live?.handleInput("j");
		live?.handleInput("x");
		await vi.waitFor(() => expect(runtimeHost.closeSession).toHaveBeenCalledWith("slot-2"));
		expect(value.pool.findBySessionId("d1")).toBeUndefined();
		expect(value.registry.inactiveRows().map((row) => row.session_id)).toContain("d1");

		const load = async () =>
			value.registry.inactiveRows().map((row) => ({
				path: row.session_file!,
				id: row.session_id,
				cwd: row.cwd,
				name: row.name ?? undefined,
				created: new Date(row.updated_at),
				modified: new Date(row.updated_at),
				messageCount: 0,
				firstMessage: "",
				allMessagesText: "",
			}));
		const selector = new SessionSelectorComponent(
			load,
			load,
			async (path) => {
				const row = value.registry.inactiveRows().find((candidate) => candidate.session_file === path)!;
				const restored = fakeSession(row.session_id, row.name ?? "design");
				const slot = value.pool.adopt(restored as never, fakeServices(row.cwd) as never);
				value.pool.setForeground(slot.id);
			},
			done,
			vi.fn(),
			vi.fn(),
			{ keybindings: undefined },
			c1.sessionFile,
		);
		resume = selector;
		await new Promise((resolve) => setTimeout(resolve, 0));
		resume.handleInput("\r");
		await Promise.resolve();
		expect(value.pool.findBySessionId("d1")).toBeDefined();
		expect(value.pool.findBySessionId("d1")?.session.sessionFile).toBe(originalFile);
		expect(value.registry.activeRows().map((row) => row.session_id)).toContain("d1");
		expect(controlSlot).toBeDefined();
		rmSync(value.root, { recursive: true, force: true });
	});
});
