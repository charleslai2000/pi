import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fauxAssistantMessage, registerFauxProvider } from "@earendil-works/pi-ai/compat";
import {
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionFromServices,
	createAgentSessionServices,
} from "../../src/core/agent-session-runtime.ts";
import { AuthStorage } from "../../src/core/auth-storage.ts";
import { ModelRuntime } from "../../src/core/model-runtime.ts";
import { startPiRootApplication } from "../../src/core/pi-root-application.ts";

const root = process.env.PI_TEST_ROOT;
const agentDir = process.env.PI_TEST_AGENT_DIR;
if (!root || !agentDir) throw new Error("PI_TEST_ROOT and PI_TEST_AGENT_DIR are required");
mkdirSync(agentDir, { recursive: true });

const faux = registerFauxProvider();
faux.setResponses([fauxAssistantMessage("ready"), fauxAssistantMessage("activated")]);
const authStorage = AuthStorage.inMemory();
await authStorage.modify(faux.getModel().provider, async () => ({ type: "api_key", key: "test" }));
const model = faux.getModel();
const modelRuntime = await ModelRuntime.create({ credentials: authStorage, modelsPath: join(agentDir, "models.json") });
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

const application = await startPiRootApplication({
	root,
	agentDir,
	sessionDir: join(root, ".pi", "sessions"),
	registryOptions: { heartbeatIntervalMs: 100, staleAfterMs: 300, sessionDir: join(root, ".pi", "sessions") },
	createRuntime,
});
const ready = {
	type: "ready",
	pid: process.pid,
	instanceId: application.registry.runtimeInstance().instance_id,
	canonicalSessionId: application.canonicalControlSessionId,
	sessionFile: application.canonicalControlSessionFile,
	poolSize: application.poolSize,
	foregroundSessionId: application.foregroundSessionId,
	foregroundCwd: application.foregroundCwd,
};
console.log(JSON.stringify(ready));

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
	const [command, argument] = line.trim().split(/\s+/, 2);
	if (command === "activate" && argument && existsSync(argument)) {
		const prepared = await application.runtimeHost.prepareSession(argument);
		await application.runtimeHost.resumePrepared(prepared);
		const foreground = application.runtimeHost.sessionPool.getForeground();
		console.log(
			JSON.stringify({
				type: "activated",
				sessionId: foreground.session.sessionManager.getSessionId(),
				poolSize: application.runtimeHost.sessionPool.list().length,
				foregroundSessionId: foreground.session.sessionManager.getSessionId(),
			}),
		);
	} else if (command === "shutdown") {
		await application.shutdown();
		faux.unregister();
		process.exit(0);
	}
}
