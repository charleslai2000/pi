import { readFileSync } from "node:fs";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import { isValidThinkingLevel } from "../cli/args.ts";
import type { AgentProfile } from "./agent-profiles.ts";
import { AgentProfileError, resolveAgentProfile } from "./agent-profiles.ts";
import type { AgentSession } from "./agent-session.ts";
import type { CreateAgentSessionRuntimeFactory } from "./agent-session-runtime.ts";
import type { AgentSessionServices } from "./agent-session-services.ts";
import { createAgentSessionFromServices, createAgentSessionServices } from "./agent-session-services.ts";
import { readGoal, readTask } from "./control/read-model.ts";
import { resolveCliModel } from "./model-resolver.ts";
import type { ModelRuntime } from "./model-runtime.ts";
import { assertCwdInsidePiRoot } from "./pi-root.ts";
import { SessionManager } from "./session-manager.ts";
import { getSessionRegistry } from "./session-registry.ts";

export interface ExecutionSessionRequest {
	task: { goalId: string; taskId: string };
	agentSlug?: string;
	cwd?: string;
}

export interface ExecutionSessionResult {
	session: AgentSession;
	services: AgentSessionServices;
	profileSlug?: string;
}

function resolveProfileConfiguration(
	profile: AgentProfile | undefined,
	modelRuntime: ModelRuntime,
): { model?: ReturnType<typeof resolveCliModel>["model"]; variant?: ThinkingLevel } {
	const variant = profile?.variant;
	if (variant !== undefined && !isValidThinkingLevel(variant))
		throw new AgentProfileError(`Unsupported profile variant: ${variant}`);
	if (profile?.model === undefined) return { variant: variant as ThinkingLevel | undefined };
	const resolved = resolveCliModel({ cliModel: profile.model, modelRuntime });
	if (resolved.error || !resolved.model)
		throw new AgentProfileError(
			`Profile model '${profile.model}' cannot be resolved: ${resolved.error ?? "no match"}`,
		);
	return { model: resolved.model, variant: (variant as ThinkingLevel | undefined) ?? resolved.thinkingLevel };
}

export function buildExecutionTaskContext(root: string, goalId: string, taskId: string): string {
	const task = readTask(root, goalId, taskId);
	const goal = readGoal(root, task.goalId);
	const plan = goal.planFile ? readFileSync(goal.planFile, "utf8") : "(no Plan document)";
	const dependencies = task.prerequisites.map((identity) => {
		const prerequisite = readTask(root, identity.goalId, identity.taskId);
		return `${identity.goalId}/${identity.taskId} (${prerequisite.status ?? "status unspecified"}):\n${prerequisite.content}`;
	});
	return [
		`Goal relevant context (${goal.goalId}):\n${goal.content}`,
		`Plan current strategy and coordination memory:\n${plan}`,
		...(dependencies.length ? [`Relevant prerequisite Task context:\n${dependencies.join("\n\n")}`] : []),
		`Current Task (${task.taskId}) full definition, lifecycle, completion, memory, remaining, and evidence:\n${task.content}`,
	].join("\n\n");
}

export async function forkExecutionSession(options: {
	request: ExecutionSessionRequest;
	piRoot: string;
	sourceSessionFile: string;
	agentDir: string;
	modelRuntime?: ModelRuntime;
	createRuntime?: CreateAgentSessionRuntimeFactory;
}): Promise<ExecutionSessionResult> {
	const root = options.piRoot;
	const cwd = options.request.cwd ?? root;
	assertCwdInsidePiRoot(cwd);
	let profile: AgentProfile | undefined;
	if (options.request.agentSlug !== undefined) {
		profile = resolveAgentProfile(options.request.agentSlug, { piRoot: root });
	}
	const manager = SessionManager.forkFrom(options.sourceSessionFile, cwd);
	let services: AgentSessionServices;
	let created: Awaited<ReturnType<typeof createAgentSessionFromServices>>;
	if (options.createRuntime) {
		const runtime = await options.createRuntime({ cwd, agentDir: options.agentDir, sessionManager: manager });
		services = runtime.services;
		created = {
			session: runtime.session,
			extensionsResult: runtime.extensionsResult,
			modelFallbackMessage: runtime.modelFallbackMessage,
		};
		const configuration = resolveProfileConfiguration(profile, services.modelRuntime);
		if (configuration.model) {
			if (created.session.model !== configuration.model) await created.session.setModel(configuration.model);
			created.session.sessionManager.appendModelChange(configuration.model.provider, configuration.model.id);
		}
		if (configuration.variant) {
			created.session.setThinkingLevel(configuration.variant, { persist: false });
			created.session.sessionManager.appendThinkingLevelChange(created.session.thinkingLevel);
		}
	} else {
		services = await createAgentSessionServices({
			cwd,
			agentDir: options.agentDir,
			modelRuntime: options.modelRuntime,
		});
		const configuration = resolveProfileConfiguration(profile, services.modelRuntime);
		created = await createAgentSessionFromServices({
			services,
			sessionManager: manager,
			model: configuration.model,
			thinkingLevel: configuration.variant,
		});
		if (configuration.model) manager.appendModelChange(configuration.model.provider, configuration.model.id);
		if (configuration.variant) manager.appendThinkingLevelChange(created.session.thinkingLevel);
	}
	created.session.setSessionName(profile?.agentSlug ?? "execution");
	const taskContext = buildExecutionTaskContext(root, options.request.task.goalId, options.request.task.taskId);
	const cwdInstructions = created.session.getProjectInstructions();
	created.session.setAppendedSystemPrompt(
		[
			`Execution working directory: ${cwd}`,
			...cwdInstructions.map(
				(file) => `<project_instructions path="${file.path}">\n${file.content}\n</project_instructions>`,
			),
			taskContext,
		].join("\n\n"),
		{ suppressLoadedProjectContext: true },
	);
	const registry = getSessionRegistry();
	registry?.upsert({
		id: manager.getSessionId(),
		file: manager.getSessionFile(),
		cwd,
		name: profile?.agentSlug ?? "execution",
		agentSlug: profile?.agentSlug,
		taskId: options.request.task.taskId,
	});
	return { ...created, services, profileSlug: profile?.agentSlug };
}
