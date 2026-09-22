import {
	type AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionRuntime,
} from "./agent-session-runtime.ts";
import { resolvePiRootInfo, setPiRoot } from "./pi-root.ts";
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
	setPiRoot(info.root, info.mode);
	const registry = await initializeSessionRegistry(info.root, {
		...options.registryOptions,
		sessionDir: options.sessionDir,
	});
	const sessionManager = await registry.openCanonicalControl(options.sessionDir);
	const runtimeHost = await createAgentSessionRuntime(options.createRuntime, {
		cwd: sessionManager.getCwd(),
		agentDir: options.agentDir,
		sessionManager,
	});
	const slot = runtimeHost.sessionPool.getForeground();
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
		canonicalControlSessionFile: slot.session.sessionFile,
		poolSize: runtimeHost.sessionPool.list().length,
		foregroundSessionId: slot.session.sessionManager.getSessionId(),
		foregroundCwd: slot.cwd,
		async shutdown(): Promise<void> {
			await runtimeHost.dispose();
			registry.close();
		},
	};
}
