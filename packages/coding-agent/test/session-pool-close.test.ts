import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setPiRoot } from "../src/core/pi-root.ts";
import { SessionPool } from "../src/core/session-pool.ts";
import { SessionRegistry, setSessionRegistryForTesting } from "../src/core/session-registry.ts";

function slot(id: string) {
	return {
		id,
		session: { sessionFile: undefined } as never,
		services: { cwd: `/repo/${id}` } as never,
		cwd: `/repo/${id}`,
		sessionFile: undefined,
	};
}

describe("SessionPool close selection", () => {
	const roots: string[] = [];
	function enableRegistry(): void {
		const root = mkdtempSync(join("/tmp", "session-pool-close-"));
		roots.push(root);
		mkdirSync(join(root, ".pi"), { recursive: true });
		setPiRoot(root);
		setSessionRegistryForTesting(new SessionRegistry(root));
	}
	afterEach(() => {
		setSessionRegistryForTesting(undefined);
		setPiRoot(undefined);
		for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
	});
	it("keeps the only slot foreground when the sole slot is refused", () => {
		enableRegistry();
		const pool = new SessionPool();
		const only = slot("a");
		pool.adopt(only.session, only.services);
		const foreground = pool.getForeground();
		expect(pool.list()).toHaveLength(1);
		expect(foreground.id).toBe("slot-1");
		expect(pool.getForeground()).toBe(foreground);
	});

	it("keeps a background slot close separate from foreground selection", () => {
		enableRegistry();
		const pool = new SessionPool();
		const a = pool.adopt(slot("a").session, slot("a").services);
		const b = pool.adopt(slot("b").session, slot("b").services);
		pool.setForeground(a.id);
		const before = pool.getForeground();
		pool.removeClosed(b.id);
		expect(pool.getForeground()).toBe(before);
		expect(pool.list()).toHaveLength(1);
	});
});
