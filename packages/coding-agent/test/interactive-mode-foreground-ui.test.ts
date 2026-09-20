import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
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
import { setPiRoot } from "../src/core/pi-root.ts";
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
		const cwdA = join(root, "control");
		const cwdB = join(root, "design");
		const cwdC = join(root, "experiments");
		mkdirSync(cwdA, { recursive: true });
		mkdirSync(cwdB, { recursive: true });
		mkdirSync(cwdC, { recursive: true });
		setPiRoot(root);
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
				pi.on("session_before_switch", () => ({ cancel: true }));
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
			setPiRoot(undefined);
			faux.unregister();
			if (existsSync(root)) rmSync(root, { recursive: true, force: true });
		});

		await runtimeHost.session.bindExtensions({});
		await (mode as unknown as { bindCurrentSessionExtensions(): Promise<void> }).bindCurrentSessionExtensions();
		(mode as unknown as { setupEditorSubmitHandler(): void }).setupEditorSubmitHandler();
		const submit = (mode as unknown as { defaultEditor: { onSubmit?: (text: string) => Promise<void> } })
			.defaultEditor.onSubmit;
		expect(submit).toBeDefined();
		const slotA = runtimeHost.sessionPool.getForeground();
		expect(widgetKeys(mode)).toEqual(["foreground-marker"]);
		expect(() => slotA.session.extensionRunner.createContext().cwd).not.toThrow();

		await submit!("/new design");
		const slotB = runtimeHost.sessionPool.getForeground();
		expect(slotB.id).not.toBe(slotA.id);
		expect(widgetKeys(mode)).toEqual(["foreground-marker"]);
		expect(() => slotA.session.extensionRunner.createContext().cwd).not.toThrow();
		expect(() => slotB.session.extensionRunner.createContext().cwd).not.toThrow();
		expect(runtimeHost.cwd).toBe(cwdB);
		expect(slotB.services.cwd).toBe(cwdB);
		expect((mode as unknown as { footerDataProvider: { cwd: string } }).footerDataProvider.cwd).toBe(cwdB);
		expect(runtimeHost.sessionPool.list()).toHaveLength(2);

		await submit!("/new experiments");
		const slotC = runtimeHost.sessionPool.getForeground();
		expect(slotC.id).not.toBe(slotA.id);
		expect(slotC.id).not.toBe(slotB.id);
		expect(slotC.services.cwd).toBe(cwdC);
		expect(runtimeHost.cwd).toBe(cwdC);
		expect((mode as unknown as { footerDataProvider: { cwd: string } }).footerDataProvider.cwd).toBe(cwdC);
		expect(runtimeHost.sessionPool.list()).toHaveLength(3);

		let liveSelector: { render(width: number): string[] } | undefined;
		vi.spyOn(
			mode as unknown as { showSelector: (create: (done: () => void) => { component: unknown }) => void },
			"showSelector",
		).mockImplementation((create) => {
			liveSelector = create(() => {}).component as { render(width: number): string[] };
		});
		await submit!("/sessions");
		expect(liveSelector).toBeDefined();
		const selectorText = liveSelector!.render(160).join("\n");
		expect(selectorText).toContain(cwdA);
		expect(selectorText).toContain(cwdB);
		expect(selectorText).toContain(cwdC);

		await runtimeHost.switchForeground(slotA.id);
		expect(runtimeHost.session).toBe(slotA.session);
		expect(widgetKeys(mode)).toEqual(["foreground-marker"]);
		expect(() => slotA.session.extensionRunner.createContext().cwd).not.toThrow();
		expect(() => slotB.session.extensionRunner.createContext().cwd).not.toThrow();
	});
});
