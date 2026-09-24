import { join } from "node:path";
import { resolveAgentProfile } from "./agent-profiles.ts";
import {
	type AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionRuntime,
} from "./agent-session-runtime.ts";
import { readAssociations } from "./control/associations.ts";
import { getPiRootRuntimeDir, resolvePiRootInfo, setPiRoot } from "./pi-root.ts";
import { initializeSessionRegistry, type SessionRegistry } from "./session-registry.ts";

export interface PiRootApplication {
	registry: SessionRegistry;
	runtimeHost: AgentSessionRuntime;
	canonicalControlSessionId: string;
	canonicalControlSessionFile: string | undefined;
	poolSize: number;
	foregroundSessionId: string;
	foregroundCwd: string;
	shutdown(): Promise<void>;
}

export async function startPiRootApplication(options: {
	root: string;
	agentDir: string;
	sessionDir?: string;
	registryOptions?: { acquire?: boolean; heartbeatIntervalMs?: number; staleAfterMs?: number; sessionDir?: string };
	createRuntime: CreateAgentSessionRuntimeFactory;
}): Promise<PiRootApplication> {
	const info = resolvePiRootInfo({ explicitRoot: options.root, cwd: options.root });
	setPiRoot(info.root);
	const runtimeDir = getPiRootRuntimeDir(info.root);
	if (!runtimeDir) throw new Error(`PiRoot has no runtime directory: ${info.root}`);
	const sessionDir = options.sessionDir;
	const registry = await initializeSessionRegistry(info.root, {
		...options.registryOptions,
		sessionDir,
	});
	const sessionManager = await registry.openCanonicalController(sessionDir, join(info.root, ".pi"));
	const controllerProfile = resolveAgentProfile("orchestrator", { piRoot: info.root, controller: true });
	const runtimeHost = await createAgentSessionRuntime(options.createRuntime, {
		cwd: sessionManager.getCwd(),
		agentDir: options.agentDir,
		sessionManager,
	});
	const slot = runtimeHost.sessionPool.getForeground();
	const projectInstructions = slot.session.getProjectInstructions();
	const rootInstructions = projectInstructions.filter(
		(file) => file.path === `${info.root}/AGENTS.md` || file.path === `${info.root}/.pi/AGENTS.md`,
	);
	slot.session.setAppendedSystemPrompt(
		[
			...rootInstructions.map(
				(file) => `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>`,
			),
			controllerProfile.prompt,
			"Controller scheduling policy: decide whether a specialized Agent and non-default contained working directory are useful for each Task. Simple work may use generic execution. Consult list_agents and inspect_agent as needed. Choose based on Goal, current Plan, Task, and PiRoot .pi/AGENTS.md policy. Review, test, debug, and other specialist selections are your contextual decisions; runtime does not route Task types. The chosen agent and cwd apply only to the current tenure and do not create Task authority.",
		].join("\n\n"),
		{ suppressLoadedProjectContext: true },
	);
	slot.session.setSessionName("orchestrator");
	for (const assignment of readAssociations(info.root).current) {
		if (runtimeHost.sessionPool.findBySessionId(assignment.sessionId)) continue;
		const executorRow = registry.rows().find((row) => row.session_id === assignment.sessionId);
		if (!executorRow?.session_file)
			throw new Error(`Assigned Executor Session is unavailable: ${assignment.sessionId}`);
		const prepared = await runtimeHost.prepareSession(executorRow.session_file);
		await runtimeHost.resumePrepared(prepared);
	}
	registry.upsert({
		id: slot.session.sessionManager.getSessionId(),
		file: slot.session.sessionFile,
		cwd: slot.cwd,
		name: slot.session.sessionManager.getSessionName(),
	});
	const canonicalControlSessionId = registry.canonicalControlSessionId();
	if (!canonicalControlSessionId) throw new Error("PiRoot startup did not resolve a canonical control session");
	return {
		registry,
		runtimeHost,
		canonicalControlSessionId,
		canonicalControlSessionFile: registry.canonicalControlSession()?.session_file ?? undefined,
		poolSize: runtimeHost.sessionPool.list().length,
		foregroundSessionId: slot.session.sessionManager.getSessionId(),
		foregroundCwd: slot.cwd,
		async shutdown(): Promise<void> {
			await runtimeHost.dispose();
			registry.close();
		},
	};
}
