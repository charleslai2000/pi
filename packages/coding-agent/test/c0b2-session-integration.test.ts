import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setPiRoot } from "../src/core/pi-root.ts";
import { SessionPool } from "../src/core/session-pool.ts";
import { SessionRegistry, setSessionRegistryForTesting } from "../src/core/session-registry.ts";

function state(): { root: string; registry: SessionRegistry; pool: SessionPool } {
	const base = mkdtempSync(join("/tmp", "pi-c0b2-integration-"));
	const root = join(base, "project");
	mkdirSync(join(root, ".pi"), { recursive: true });
	mkdirSync(join(root, "control"), { recursive: true });
	setPiRoot(root, "formal");
	const registry = new SessionRegistry(root);
	setSessionRegistryForTesting(registry);
	return { root, registry, pool: new SessionPool() };
}

function fakeSession(id: string) {
	return { sessionManager: { getSessionId: () => id, getSessionName: () => id }, sessionFile: `/tmp/${id}.jsonl` };
}

afterEach(() => {
	setSessionRegistryForTesting(undefined);
	setPiRoot(undefined);
});

describe("C0B2 registry/session integration", () => {
	it("keeps active and inactive views mutually exclusive", () => {
		const value = state();
		const control = fakeSession("c1");
		const design = fakeSession("d1");
		const controlSlot = value.pool.adopt(control as never, { cwd: join(value.root, ".pi") } as never);
		const designSlot = value.pool.adopt(design as never, { cwd: join(value.root, "design") } as never);
		value.registry.setCanonicalControlSessionId("c1");
		value.pool.deactivate(designSlot.id);
		value.pool.removeClosed(designSlot.id);
		const active = value.registry.activeRows().map((row) => row.session_id);
		const inactive = value.registry.inactiveRows().map((row) => row.session_id);
		expect(active).toEqual(["c1"]);
		expect(inactive).toEqual(["d1"]);
		expect(value.pool.findBySessionId("c1")).toBe(controlSlot);
		value.registry.close();
		rmSync(value.root, { recursive: true, force: true });
	});

	it("detects both directions of Pool/Registry divergence", () => {
		const value = state();
		const design = fakeSession("d1");
		const slot = value.pool.adopt(design as never, { cwd: join(value.root, "design") } as never);
		value.registry.setInactive("d1");
		expect(() => {
			const active = value.registry.activeRows();
			if (!active.some((row) => row.session_id === "d1"))
				throw new Error("Live session slot has no active registry row: d1");
		}).toThrow("Live session slot has no active registry row");
		expect(slot).toBeDefined();
		value.registry.close();
		rmSync(value.root, { recursive: true, force: true });
	});

	it("filters historical control rows from the inactive view", () => {
		const value = state();
		value.registry.rebuild([
			{
				id: "c0",
				path: "/tmp/c0.jsonl",
				cwd: join(value.root, ".pi"),
				name: "old",
				created: new Date(0),
				modified: new Date(0),
				messageCount: 0,
				firstMessage: "",
				allMessagesText: "",
			},
			{
				id: "c1",
				path: "/tmp/c1.jsonl",
				cwd: join(value.root, ".pi"),
				name: "current",
				created: new Date(0),
				modified: new Date(0),
				messageCount: 0,
				firstMessage: "",
				allMessagesText: "",
			},
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
		value.registry.setCanonicalControlSessionId("c1");
		expect(value.registry.inactiveRows().map((row) => row.session_id)).toEqual(["d1"]);
		value.registry.close();
		rmSync(value.root, { recursive: true, force: true });
	});
});
