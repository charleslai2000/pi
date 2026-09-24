import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentSessionRuntime } from "../src/core/agent-session-runtime.ts";
import { resolveCliPiRoot, setPiRoot } from "../src/core/pi-root.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { getSessionRegistry, setSessionRegistryForTesting } from "../src/core/session-registry.ts";

const roots: string[] = [];
function project(): string {
	const root = mkdtempSync(join("/tmp", "piroot-init-"));
	roots.push(root);
	return root;
}

afterEach(() => {
	setSessionRegistryForTesting(undefined);
	setPiRoot(undefined);
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("PiRoot CLI resolution and initialization", () => {
	it("explicit root initializes missing .pi and is idempotent", async () => {
		const root = project();
		expect(await resolveCliPiRoot({ explicitRoot: root, cwd: "/unused", interactive: false })).toBe(root);
		for (const path of [join(root, ".pi"), join(root, ".pi", "sessions")])
			expect(statSync(path).isDirectory()).toBe(true);

		expect(() => statSync(join(root, "control"))).toThrow();
		expect(await resolveCliPiRoot({ explicitRoot: root, cwd: "/unused", interactive: false })).toBe(root);
	});

	it("explicit root rejects missing roots and .pi files without fallback", async () => {
		const missing = join(project(), "missing");
		await expect(resolveCliPiRoot({ explicitRoot: missing, cwd: "/tmp", interactive: true })).rejects.toThrow(
			"does not exist or is not a directory",
		);
		const fileMarker = project();
		writeFileSync(join(fileMarker, ".pi"), "not a directory");
		await expect(resolveCliPiRoot({ explicitRoot: fileMarker, cwd: "/tmp", interactive: false })).rejects.toThrow(
			"not a directory",
		);
	});

	it("fails closed on an unwritable explicit root", async () => {
		const readonlyRoot = project();
		chmodSync(readonlyRoot, 0o555);
		try {
			await expect(
				resolveCliPiRoot({ explicitRoot: readonlyRoot, cwd: "/tmp", interactive: false }),
			).rejects.toThrow("not writable");
		} finally {
			chmodSync(readonlyRoot, 0o755);
		}
	});

	it("chooses the nearest marker, ignoring control and Git roots", async () => {
		const outer = project();
		mkdirSync(join(outer, ".pi"));
		const inner = join(outer, "nested");
		mkdirSync(join(inner, "control"), { recursive: true });
		mkdirSync(join(inner, ".git"), { recursive: true });
		const cwd = join(inner, "work");
		mkdirSync(cwd);
		await expect(resolveCliPiRoot({ cwd, interactive: false })).resolves.toBe(outer);
		mkdirSync(join(inner, ".pi"));
		await expect(resolveCliPiRoot({ cwd, interactive: false })).resolves.toBe(inner);
	});

	it("interactive implicit startup asks to initialize; decline stays standalone", async () => {
		const root = project();
		const confirm = vi.fn(async () => false);
		await expect(
			resolveCliPiRoot({ cwd: root, interactive: true, confirmInitialize: confirm }),
		).resolves.toBeUndefined();
		expect(confirm).toHaveBeenCalledWith(root);
		expect(() => statSync(join(root, ".pi"))).toThrow();
	});

	it("interactive accept initializes; non-interactive startup neither prompts nor mutates", async () => {
		const accepted = project();
		await expect(
			resolveCliPiRoot({ cwd: accepted, interactive: true, confirmInitialize: async () => true }),
		).resolves.toBe(accepted);
		const standalone = project();
		const confirm = vi.fn(async () => true);
		await expect(
			resolveCliPiRoot({ cwd: standalone, interactive: false, confirmInitialize: confirm }),
		).resolves.toBeUndefined();
		expect(confirm).not.toHaveBeenCalled();
		expect(() => statSync(join(standalone, ".pi"))).toThrow();
	});

	it("standalone Session storage remains available and Control Plane tools fail clearly", async () => {
		const cwd = project();
		setPiRoot(undefined);
		const standaloneSession = SessionManager.create(cwd);
		expect(standaloneSession.getSessionId()).toBeTruthy();
		const runtime = Object.assign(Object.create(AgentSessionRuntime.prototype) as AgentSessionRuntime, {});
		expect(() => (runtime as unknown as { associationRoot(): string }).associationRoot()).toThrow(
			"PiRoot unavailable. Start with --root <path>",
		);
		expect(getSessionRegistry()).toBeUndefined();
	});
});
