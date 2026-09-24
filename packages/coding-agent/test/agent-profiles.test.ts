import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it } from "vitest";
import { AgentProfileError, listAgentProfiles, resolveAgentProfile } from "../src/core/agent-profiles.ts";
import { createAgentSessionFromServices, createAgentSessionServices } from "../src/core/agent-session-services.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { buildExecutionTaskContext, forkExecutionSession } from "../src/core/execution-session.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { setPiRoot } from "../src/core/pi-root.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { SessionRegistry, setSessionRegistryForTesting } from "../src/core/session-registry.ts";

const roots: string[] = [];
function workspace(): string {
	const root = mkdtempSync(join("/tmp", "pi-agent-profile-"));
	roots.push(root);
	mkdirSync(join(root, ".pi", "agents"), { recursive: true });
	return root;
}

afterEach(() => {
	setSessionRegistryForTesting(undefined);
	setPiRoot(undefined);
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Pi Agent profiles", () => {
	it("project profile wholly overrides global and parses model/variant", () => {
		const root = workspace();
		const home = join(root, "home");
		mkdirSync(join(home, ".pi", "agents"), { recursive: true });
		writeFileSync(
			join(home, ".pi", "agents", "coder.md"),
			"---\nmodel: openai/gpt-5.5\nvariant: high\n---\nGlobal coder prompt\n",
		);
		writeFileSync(
			join(root, ".pi", "agents", "coder.md"),
			"---\nagentSlug: coder\nmodel: faux/model\nvariant: medium\n---\nProject coder prompt\n",
		);
		const profile = resolveAgentProfile("coder", { piRoot: root, homeDir: home });
		expect(profile).toMatchObject({
			agentSlug: "coder",
			model: "faux/model",
			variant: "medium",
			prompt: "Project coder prompt",
		});
	});

	it("merges global and project profiles with project source/description metadata", () => {
		const root = workspace();
		const home = join(root, "home");
		mkdirSync(join(home, ".pi", "agents"), { recursive: true });
		writeFileSync(
			join(home, ".pi", "agents", "global-only.md"),
			"---\ndescription: Global-only role.\n---\nA concise global prompt.\n",
		);
		writeFileSync(
			join(home, ".pi", "agents", "shared.md"),
			"---\ndescription: Global version.\nmodel: faux/global\n---\nGlobal prompt.\n",
		);
		writeFileSync(
			join(root, ".pi", "agents", "shared.md"),
			"---\ndescription: Project version.\nvariant: medium\n---\nProject prompt.\n",
		);
		writeFileSync(join(root, ".pi", "agents", "orchestrator.md"), "Controller-only prompt.\n");
		const catalog = listAgentProfiles({ piRoot: root, homeDir: home });
		expect(catalog).toEqual([
			{ agentSlug: "global-only", source: "global", description: "Global-only role." },
			{ agentSlug: "shared", source: "project", variant: "medium", description: "Project version." },
		]);
	});

	it("loads the coder, reviewer and Controller profile migration targets while reserving orchestrator", () => {
		const root = workspace();
		for (const slug of ["orchestrator", "coder", "reviewer"]) {
			writeFileSync(join(root, ".pi", "agents", `${slug}.md`), `---\nagentSlug: ${slug}\n---\n${slug} prompt\n`);
		}
		expect(resolveAgentProfile("orchestrator", { piRoot: root, controller: true, homeDir: root }).agentSlug).toBe(
			"orchestrator",
		);
		expect(resolveAgentProfile("coder", { piRoot: root, homeDir: root }).prompt).toBe("coder prompt");
		expect(resolveAgentProfile("reviewer", { piRoot: root, homeDir: root }).prompt).toBe("reviewer prompt");
		expect(() => resolveAgentProfile("orchestrator", { piRoot: root, homeDir: root })).toThrow(AgentProfileError);
	});

	it("fails closed on missing, malformed, and Controller-only profiles", () => {
		const root = workspace();
		expect(() => resolveAgentProfile("missing", { piRoot: root, homeDir: root })).toThrow(AgentProfileError);
		expect(() => resolveAgentProfile("orchestrator", { piRoot: root, homeDir: root })).toThrow(AgentProfileError);
		writeFileSync(join(root, ".pi", "agents", "reviewer.md"), "---\npermission: allow\n---\nReview safely.\n");
		expect(() => resolveAgentProfile("reviewer", { piRoot: root, homeDir: root })).toThrow(
			/Unknown Agent profile field/,
		);
	});

	it("composes cwd/profile/durable Task prompt and applies model plus variant through Pi seams", async () => {
		const root = workspace();
		const cwd = join(root, "src");
		mkdirSync(cwd, { recursive: true });
		writeFileSync(join(root, "AGENTS.md"), "Root instructions.\n");
		writeFileSync(join(cwd, "AGENTS.md"), "Leaf instructions.\n");
		writeFileSync(
			join(root, ".pi", "agents", "coder.md"),
			"---\nagentSlug: coder\nmodel: faux/model\nvariant: high\n---\nProfile body.\n",
		);
		const goal = join(root, ".pi", "T001");
		mkdirSync(goal, { recursive: true });
		writeFileSync(join(goal, "goal.md"), "# Goal T001\nStatus: READY\nMemory: Goal durable memory.\n");
		writeFileSync(join(goal, "plan.md"), "Plan current strategy and coordination memory.\n");
		writeFileSync(
			join(goal, "T001-work.md"),
			"Status: READY\nObjective: Do the task\nCompletion: done\nMemory: fresh memory\n",
		);
		setPiRoot(root);
		const registry = new SessionRegistry(root);
		setSessionRegistryForTesting(registry);
		const faux = registerFauxProvider({ models: [{ id: "model", name: "Faux", reasoning: true }] });
		const auth = AuthStorage.inMemory();
		await auth.modify("faux", async () => ({ type: "api_key", key: "test" }));
		const modelRuntime = await ModelRuntime.create({ credentials: auth, modelsPath: null, allowModelNetwork: false });
		const model = faux.getModel();
		modelRuntime.registerProvider("faux", {
			baseUrl: model.baseUrl,
			api: model.api,
			models: [
				{
					id: model.id,
					name: model.name,
					api: model.api,
					reasoning: true,
					input: model.input,
					cost: model.cost,
					contextWindow: model.contextWindow,
					maxTokens: model.maxTokens,
					baseUrl: model.baseUrl,
				},
			],
		});
		const source = SessionManager.create(root, join(root, ".pi", "sessions"));
		source.persistSessionHeader();
		const result = await forkExecutionSession({
			request: { task: { goalId: "T001", taskId: "T001" }, agentSlug: "coder", cwd },
			piRoot: root,
			sourceSessionFile: source.getSessionFile()!,
			agentDir: join(root, "agent"),
			modelRuntime,
			createRuntime: async ({ cwd: sessionCwd, agentDir, sessionManager }) => {
				const forkServices = await createAgentSessionServices({
					cwd: sessionCwd,
					agentDir,
					modelRuntime,
					resourceLoaderOptions: { noSkills: true, noPromptTemplates: true, noThemes: true },
				});
				const created = await createAgentSessionFromServices({ services: forkServices, sessionManager, model });
				return { ...created, services: forkServices, diagnostics: [] };
			},
		});
		expect(result.session.model?.id).toBe("model");
		expect(result.session.thinkingLevel).toBe("high");
		const prompt = result.session.systemPrompt;
		expect(prompt.indexOf("Profile body.")).toBeLessThan(prompt.indexOf("Execution working directory:"));
		expect(prompt.indexOf("Execution working directory:")).toBeLessThan(prompt.indexOf("Root instructions."));
		expect(prompt.indexOf("Root instructions.")).toBeLessThan(prompt.indexOf("Leaf instructions."));
		expect(prompt.indexOf("Leaf instructions.")).toBeLessThan(prompt.indexOf("Memory: Goal durable memory."));
		expect(prompt.indexOf("Memory: Goal durable memory.")).toBeLessThan(
			prompt.indexOf("Plan current strategy and coordination memory."),
		);
		expect(prompt.indexOf("Plan current strategy and coordination memory.")).toBeLessThan(
			prompt.indexOf("Current Task (T001)"),
		);
		expect(prompt).toContain("fresh memory");
		await result.session.dispose();
		faux.unregister();
	});

	it("assembles only Goal, Plan, declared prerequisite, and current Task context", () => {
		const root = workspace();
		const goalDir = join(root, ".pi", "goal-a");
		mkdirSync(goalDir, { recursive: true });
		writeFileSync(join(goalDir, "goal.md"), "# Goal A\nStatus: READY\nMemory: Goal memory: keep shared invariant.\n");
		writeFileSync(
			join(goalDir, "plan.md"),
			"# Plan\nCoordination memory: Coordination memory: T001 precedes T002.\n",
		);
		writeFileSync(join(goalDir, "T001-build.md"), "Status: DONE\nObjective: Build\nMemory: parser evidence\n");
		writeFileSync(
			join(goalDir, "T002-review.md"),
			"Status: READY\nObjective: Review\nPrerequisites: goal-a/T001\nMemory: review memory\n",
		);
		writeFileSync(join(goalDir, "T003-unrelated.md"), "Status: READY\nObjective: unrelated sibling\n");
		const context = buildExecutionTaskContext(root, "goal-a", "T002");
		expect(context.indexOf("Goal relevant context")).toBeLessThan(context.indexOf("Plan current strategy"));
		expect(context.indexOf("Plan current strategy")).toBeLessThan(
			context.indexOf("Relevant prerequisite Task context"),
		);
		expect(context.indexOf("Relevant prerequisite Task context")).toBeLessThan(
			context.indexOf("Current Task (T002)"),
		);
		expect(context).toContain("Goal memory: keep shared invariant");
		expect(context).toContain("Coordination memory: T001 precedes T002");
		expect(context).toContain("Memory: parser evidence");
		expect(context).toContain("Memory: review memory");
		expect(context).not.toContain("unrelated sibling");
	});

	it("forks an ordinary Pi Session preserving source history and assigns target cwd", () => {
		const root = workspace();
		const sourceDir = join(root, ".pi", "sessions");
		const source = SessionManager.create(root, sourceDir);
		source.persistSessionHeader();
		source.appendMessage({ role: "user", content: "Controller history", timestamp: Date.now() });
		const target = join(root, "src", "routing");
		mkdirSync(target, { recursive: true });
		const fork = SessionManager.forkFrom(source.getSessionFile()!, target);
		expect(fork.getCwd()).toBe(target);
		expect(fork.getSessionId()).not.toBe(source.getSessionId());
		expect(fork.getBranch().filter((entry) => entry.type !== "session_info")).toHaveLength(
			source.getBranch().filter((entry) => entry.type !== "session_info").length,
		);
	});
});
