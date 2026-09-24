import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { migrateLegacyControlAuthority } from "../src/core/control/legacy-migration.ts";
import { readTask } from "../src/core/control/read-model.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { setPiRoot } from "../src/core/pi-root.ts";
import { startPiRootApplication } from "../src/core/pi-root-application.ts";

const cleanups: Array<() => Promise<void> | void> = [];

afterEach(async () => {
	while (cleanups.length > 0) await cleanups.pop()?.();
	setPiRoot(undefined);
});

describe("PiRoot application startup", () => {
	it("creates exactly one canonical control slot from an executor launch root", async () => {
		const base = mkdtempSync(join(tmpdir(), "pi-root-application-"));
		const root = join(base, "project");
		mkdirSync(join(root, ".pi", "agents"), { recursive: true });
		mkdirSync(join(root, "design"), { recursive: true });
		writeFileSync(join(root, ".pi", "agents", "orchestrator.md"), "Canonical Controller prompt.\n");
		const agentDir = join(base, "agent");
		const legacyGoal = join(root, "control", "legacy-goal");
		mkdirSync(legacyGoal, { recursive: true });
		writeFileSync(join(legacyGoal, "goal.md"), "# Legacy goal\nStatus: ACTIVE\nMemory: preserve me\n");
		writeFileSync(join(legacyGoal, "plan.md"), "# Plan\nCoordination memory: preserve strategy\n");
		writeFileSync(
			join(legacyGoal, "T001-work.md"),
			"Status: DONE\nObjective: preserve task\nResult: preserved result\nMemory: preserved Task memory\n",
		);
		const faux = registerFauxProvider();
		faux.setResponses([fauxAssistantMessage("ready")]);
		const authStorage = AuthStorage.inMemory();
		await authStorage.modify(faux.getModel().provider, async () => ({ type: "api_key", key: "test" }));
		const modelRuntime = await ModelRuntime.create({
			credentials: authStorage,
			modelsPath: join(agentDir, "models.json"),
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
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, sessionManager, sessionStartEvent }) => {
			const services = await createAgentSessionServices({
				cwd,
				agentDir,
				modelRuntime,
				resourceLoaderOptions: { noSkills: true, noPromptTemplates: true, noThemes: true },
			});
			return {
				...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent, model })),
				services,
				diagnostics: services.diagnostics,
			};
		};

		expect(migrateLegacyControlAuthority(root)).toEqual({ goals: 1, tasks: 1 });
		const application = await startPiRootApplication({ root, agentDir, createRuntime });
		cleanups.push(async () => {
			await application.shutdown();
			faux.unregister();
			rmSync(base, { recursive: true, force: true });
		});
		expect(application.poolSize).toBe(1);
		expect(readTask(root, "legacy-goal", "T001")).toMatchObject({
			status: "DONE",
			result: "preserved result",
			memory: "preserved Task memory",
		});
		expect(readFileSync(join(root, ".pi", "legacy-goal", "plan.md"), "utf8")).toContain(
			"Coordination memory: preserve strategy",
		);
		expect(application.foregroundSessionId).toBe(application.canonicalControlSessionId);
		expect(application.foregroundCwd).toBe(join(root, ".pi"));
		expect(application.runtimeHost.session.sessionManager.getCwd()).toBe(join(root, ".pi"));
		expect(application.runtimeHost.session.systemPrompt).toContain("Canonical Controller prompt.");
		expect(application.registry.activeRows().map((row) => row.session_id)).toEqual([
			application.canonicalControlSessionId,
		]);
	});
});
