import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
} from "../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import type { ExtensionFactory } from "../src/core/extensions/types.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

function widgetKeys(mode: InteractiveMode): string[] {
	const state = mode as unknown as {
		extensionWidgetsAbove: Map<string, unknown>;
		extensionWidgetsBelow: Map<string, unknown>;
	};
	return [...state.extensionWidgetsAbove.keys(), ...state.extensionWidgetsBelow.keys()];
}

describe("InteractiveMode foreground extension UI lifetime", () => {
	const cleanups: Array<() => Promise<void> | void> = [];

	afterEach(async () => {
		while (cleanups.length > 0) await cleanups.pop()?.();
	});

	it("detaches foreground widget UI without invalidating parked slot runtimes", async () => {
		initTheme("dark");
		const root = join(tmpdir(), `pi-interactive-foreground-ui-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const cwdA = join(root, "a");
		const cwdB = join(root, "b");
		mkdirSync(cwdA, { recursive: true });
		mkdirSync(cwdB, { recursive: true });
		writeFileSync(join(cwdA, "AGENTS.md"), "ui-A\n");
		writeFileSync(join(cwdB, "AGENTS.md"), "ui-B\n");

		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage("ok"), fauxAssistantMessage("ok")]);
		const authStorage = AuthStorage.inMemory();
		await authStorage.modify(faux.getModel().provider, async () => ({ type: "api_key", key: "faux-key" }));
		const agentDir = join(root, "agent");
		mkdirSync(agentDir, { recursive: true });
		const extensionFor =
			(label: string): ExtensionFactory =>
			(pi) => {
				pi.on("session_start", (_event, ctx) => {
					ctx.ui.setWidget("foreground-marker", [`UI-${label}`]);
				});
			};
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const modelRuntime = await ModelRuntime.create({
				credentials: authStorage,
				modelsPath: join(agentDir, `${cwd === cwdA ? "a" : "b"}-models.json`),
			});
			const model = faux.getModel();
			modelRuntime.registerProvider(model.provider, {
				baseUrl: model.baseUrl,
				api: model.api,
				models: [
					{
						id: model.id,
						name: model.name,
						api: model.api,
						reasoning: model.reasoning,
						input: model.input,
						cost: model.cost,
						contextWindow: model.contextWindow,
						maxTokens: model.maxTokens,
						baseUrl: model.baseUrl,
					},
				],
			});
			const services = await createAgentSessionServices({
				cwd,
				agentDir,
				modelRuntime,
				resourceLoaderOptions: {
					extensionFactories: [extensionFor(cwd === cwdA ? "A" : "B")],
					noSkills: true,
					noPromptTemplates: true,
					noThemes: true,
				},
			});
			return {
				...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model })),
				services,
				diagnostics: services.diagnostics,
			};
		};
		const runtimeHost = await createAgentSessionRuntime(createRuntime, {
			cwd: cwdA,
			agentDir,
			sessionManager: SessionManager.create(cwdA, join(agentDir, "sessions-a")),
		});
		const mode = new InteractiveMode(runtimeHost, { terminal: new VirtualTerminal(120, 40) });
		cleanups.push(async () => {
			await runtimeHost.dispose();
			faux.unregister();
			if (existsSync(root)) rmSync(root, { recursive: true, force: true });
		});

		await runtimeHost.session.bindExtensions({});
		await (mode as unknown as { bindCurrentSessionExtensions(): Promise<void> }).bindCurrentSessionExtensions();
		const slotA = runtimeHost.sessionPool.getForeground();
		expect(widgetKeys(mode)).toEqual(["foreground-marker"]);
		expect(() => slotA.session.extensionRunner.createContext().cwd).not.toThrow();

		await runtimeHost.newSession({ cwd: cwdB, keepCurrent: true });
		const slotB = runtimeHost.sessionPool.getForeground();
		expect(slotB.id).not.toBe(slotA.id);
		expect(widgetKeys(mode)).toEqual(["foreground-marker"]);
		expect(() => slotA.session.extensionRunner.createContext().cwd).not.toThrow();
		expect(() => slotB.session.extensionRunner.createContext().cwd).not.toThrow();
		expect(runtimeHost.sessionPool.list()).toHaveLength(2);

		await runtimeHost.switchForeground(slotA.id);
		expect(runtimeHost.session).toBe(slotA.session);
		expect(widgetKeys(mode)).toEqual(["foreground-marker"]);
		expect(() => slotA.session.extensionRunner.createContext().cwd).not.toThrow();
		expect(() => slotB.session.extensionRunner.createContext().cwd).not.toThrow();
	});
});
