import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { setPiRoot } from "../src/core/pi-root.ts";
import { PiRootAlreadyActiveError, SessionRegistry } from "../src/core/session-registry.ts";

function project(): string {
	const base = mkdtempSync(join("/tmp", "pi-registry-owner-"));
	const root = join(base, "project");
	mkdirSync(join(root, ".pi"), { recursive: true });
	mkdirSync(join(root, "control"), { recursive: true });
	return root;
}

describe("SessionRegistry ownership", () => {
	afterEach(() => setPiRoot(undefined));

	it("rejects a fresh second owner without changing the first owner", () => {
		const root = project();
		setPiRoot(root, "formal");
		const first = new SessionRegistry(root);
		const instance = first.runtimeInstance();
		expect(() => new SessionRegistry(root)).toThrow(PiRootAlreadyActiveError);
		expect(first.runtimeInstance()).toEqual(instance);
		first.close();
		rmSync(join(root, ".."), { recursive: true, force: true });
	});

	it("does not release ownership on repeated same-root initialize semantics", () => {
		const root = project();
		setPiRoot(root, "formal");
		const first = new SessionRegistry(root);
		const second = first;
		expect(second).toBe(first);
		first.close();
		rmSync(join(root, ".."), { recursive: true, force: true });
	});

	it("closes the instance and its active rows", () => {
		const root = project();
		setPiRoot(root, "formal");
		const registry = new SessionRegistry(root);
		registry.upsert({ id: "control-1", cwd: join(root, ".pi"), name: "control" });
		registry.close();
		const reopened = new SessionRegistry(root);
		expect(reopened.rows().find((row) => row.session_id === "control-1")?.runtime_state).toBe("inactive");
		reopened.close();
		rmSync(join(root, ".."), { recursive: true, force: true });
	});
});
