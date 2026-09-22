import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setPiRoot } from "../src/core/pi-root.ts";
import { SessionPool } from "../src/core/session-pool.ts";
import { SessionRegistry, setSessionRegistryForTesting } from "../src/core/session-registry.ts";

function setup(): {
	root: string;
	registry: SessionRegistry;
	pool: SessionPool;
	session: { sessionManager: { getSessionId: () => string }; dispose: () => void; abort: () => Promise<void> };
	services: { cwd: string };
} {
	const base = mkdtempSync(join("/tmp", "pi-close-atomicity-"));
	const root = join(base, "project");
	mkdirSync(join(root, ".pi"), { recursive: true });
	setPiRoot(root, "formal");
	const registry = new SessionRegistry(root);
	const id = "d1";
	const session = {
		sessionManager: { getSessionId: () => id, getSessionName: () => undefined },
		dispose: () => {},
		abort: async () => {},
	};
	setSessionRegistryForTesting(registry);
	const pool = new SessionPool();
	const services = { cwd: join(root, "design") };
	pool.adopt(session as never, services as never);
	return { root, registry, pool, session, services };
}

afterEach(() => {
	setSessionRegistryForTesting(undefined);
	setPiRoot(undefined);
});

describe("close atomicity", () => {
	it("deactivation failure keeps active live state", () => {
		const state = setup();
		state.registry.setFaults({ nextDeactivate: true });
		expect(() => state.pool.deactivate("slot-1")).toThrow("deactivation failure");
		expect(state.pool.findBySessionId("d1")).toBeDefined();
		expect(state.registry.activeRows().map((row) => row.session_id)).toEqual(["d1"]);
		state.registry.close();
		rmSync(state.root, { recursive: true, force: true });
	});

	it("removes the slot after post-commit cleanup failure", () => {
		const state = setup();
		state.registry.setInactive("d1");
		state.pool.setFaults({ nextClose: true });
		expect(() => state.pool.removeClosed("slot-1")).toThrow("runtime cleanup failure");
		expect(state.pool.findBySessionId("d1")).toBeUndefined();
		expect(state.registry.inactiveRows().map((row) => row.session_id)).toEqual(["d1"]);
		state.registry.close();
		rmSync(state.root, { recursive: true, force: true });
	});

	it("keeps post-commit state inactive when multiple cleanup actions fail", () => {
		const state = setup();
		state.pool.setFaults({ nextClose: true });
		state.registry.setInactive("d1");
		try {
			state.pool.removeClosed("slot-1");
			expect.fail("expected consistency failure");
		} catch (error) {
			const message = String(error);
			expect(message).toContain("d1");
			expect(message).toContain("cleanup failure");
		}
		state.registry.close();
		rmSync(state.root, { recursive: true, force: true });
	});

	it("completes a normal close with inactive registry and no slot", () => {
		const state = setup();
		state.pool.deactivate("slot-1");
		state.pool.removeClosed("slot-1");
		expect(state.pool.findBySessionId("d1")).toBeUndefined();
		expect(state.registry.inactiveRows().map((row) => row.session_id)).toEqual(["d1"]);
		state.registry.close();
		rmSync(state.root, { recursive: true, force: true });
	});
});
