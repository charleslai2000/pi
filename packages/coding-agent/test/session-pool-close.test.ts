import { describe, expect, it } from "vitest";
import { SessionPool } from "../src/core/session-pool.ts";

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
	it("keeps the only slot foreground when the sole slot is refused", () => {
		const pool = new SessionPool();
		const only = slot("a");
		pool.adopt(only.session, only.services);
		const foreground = pool.getForeground();
		expect(pool.list()).toHaveLength(1);
		expect(foreground.id).toBe("slot-1");
		expect(pool.getForeground()).toBe(foreground);
	});

	it("keeps a background slot close separate from foreground selection", () => {
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
