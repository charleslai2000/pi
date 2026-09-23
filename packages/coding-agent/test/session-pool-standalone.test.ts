import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setPiRoot } from "../src/core/pi-root.ts";
import { SessionPool } from "../src/core/session-pool.ts";
import { setSessionRegistryForTesting } from "../src/core/session-registry.ts";

const roots: string[] = [];
function temporaryRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "session-pool-standalone-"));
	roots.push(root);
	return root;
}

afterEach(() => {
	setSessionRegistryForTesting(undefined);
	setPiRoot(undefined);
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SessionPool standalone mode", () => {
	it("adopts, changes foreground, and removes slots without registry or PiRoot", () => {
		const firstRoot = temporaryRoot();
		const secondRoot = temporaryRoot();
		setPiRoot(undefined);
		setSessionRegistryForTesting(undefined);
		const fake = (cwd: string, id: string) => ({
			sessionManager: { getSessionId: () => id, getSessionName: () => undefined },
			sessionFile: undefined,
			dispose: () => {},
			abort: async () => {},
			services: { cwd },
		});
		const pool = new SessionPool();
		const first = fake(firstRoot, "session-a");
		const second = fake(secondRoot, "session-b");
		const slotA = pool.adopt(first as never, first.services as never);
		const slotB = pool.adopt(second as never, second.services as never);
		expect(pool.getForeground()).toBe(slotA);
		pool.setForeground(slotB.id);
		expect(pool.getForeground()).toBe(slotB);
		pool.deactivate(slotB.id);
		pool.removeClosed(slotB.id);
		expect(pool.findBySessionId("session-b")).toBeUndefined();
		expect(pool.getForeground()).toBe(slotA);
	});
});
