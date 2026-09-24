import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AgentProfile {
	agentSlug: string;
	prompt: string;
	model?: string;
	variant?: string;
	description?: string;
	path: string;
}

export interface AgentCatalogEntry {
	agentSlug: string;
	source: "global" | "project";
	model?: string;
	variant?: string;
	description: string;
}

export class AgentProfileError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AgentProfileError";
	}
}

function parseFrontmatter(content: string, path: string): { metadata: Record<string, string>; prompt: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
	if (!match) return { metadata: {}, prompt: content.trim() };
	const metadata: Record<string, string> = {};
	for (const line of match[1]!.split(/\r?\n/)) {
		if (!line.trim() || line.trimStart().startsWith("#")) continue;
		const field = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/.exec(line);
		if (!field || field[2]!.startsWith("[") || field[2]!.startsWith("{"))
			throw new AgentProfileError(`Invalid profile frontmatter in ${path}: ${line}`);
		if (!["agentSlug", "description", "model", "variant"].includes(field[1]!))
			throw new AgentProfileError(`Unknown Agent profile field '${field[1]}' in ${path}`);
		if (metadata[field[1]!] !== undefined)
			throw new AgentProfileError(`Duplicate Agent profile field '${field[1]}' in ${path}`);
		metadata[field[1]!] = field[2]!.replace(
			/^(?:"(.*)"|'(.*)')$/,
			(_all, doubleQuote: string, singleQuote: string) => doubleQuote ?? singleQuote,
		);
	}
	return { metadata, prompt: content.slice(match[0].length).trim() };
}

function loadProfile(path: string, slug: string): AgentProfile {
	let content: string;
	try {
		if (!statSync(path).isFile()) throw new AgentProfileError(`Agent profile is not a file: ${path}`);
		content = readFileSync(path, "utf8");
	} catch (error) {
		if (error instanceof AgentProfileError) throw error;
		throw new AgentProfileError(`Cannot read Agent profile ${path}: ${String(error)}`);
	}
	const parsed = parseFrontmatter(content, path);
	const agentSlug = parsed.metadata.agentSlug ?? slug;
	if (!/^[a-z][a-z0-9-]*$/.test(agentSlug) || agentSlug !== slug)
		throw new AgentProfileError(`Agent profile slug mismatch for ${path}: expected ${slug}, found ${agentSlug}`);
	if (!parsed.prompt) throw new AgentProfileError(`Agent profile prompt is empty: ${path}`);
	if (parsed.metadata.model !== undefined && !parsed.metadata.model.trim())
		throw new AgentProfileError(`Agent profile model is empty: ${path}`);
	if (parsed.metadata.variant !== undefined && !parsed.metadata.variant.trim())
		throw new AgentProfileError(`Agent profile variant is empty: ${path}`);
	return {
		agentSlug,
		prompt: parsed.prompt,
		model: parsed.metadata.model,
		variant: parsed.metadata.variant,
		description: parsed.metadata.description,
		path,
	};
}

function profilePaths(options: { piRoot: string; homeDir?: string }, slug: string) {
	return {
		global: join(options.homeDir ?? homedir(), ".pi", "agents", `${slug}.md`),
		project: join(options.piRoot, ".pi", "agents", `${slug}.md`),
	};
}

export function resolveAgentProfile(
	slug: string,
	options: { piRoot: string; homeDir?: string; controller?: boolean },
): AgentProfile {
	if (!/^[a-z][a-z0-9-]*$/.test(slug)) throw new AgentProfileError(`Invalid Agent slug: ${slug}`);
	if (slug === "orchestrator" && !options.controller)
		throw new AgentProfileError("The orchestrator profile is reserved for the canonical Controller");
	const paths = profilePaths(options, slug);
	const selected = existsSync(paths.project) ? paths.project : paths.global;
	if (!existsSync(selected)) throw new AgentProfileError(`Agent profile not found: ${slug}`);
	return loadProfile(selected, slug);
}

export function listAgentProfiles(options: { piRoot: string; homeDir?: string }): AgentCatalogEntry[] {
	const globalDir = join(options.homeDir ?? homedir(), ".pi", "agents");
	const projectDir = join(options.piRoot, ".pi", "agents");
	const slugs = new Set<string>();
	for (const directory of [globalDir, projectDir]) {
		let filenames: string[];
		try {
			filenames = readdirSync(directory);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw new AgentProfileError(`Cannot list Agent profiles in ${directory}: ${String(error)}`);
		}
		for (const filename of filenames) {
			const match = /^([a-z][a-z0-9-]*)\.md$/.exec(filename);
			if (match && match[1] !== "orchestrator") slugs.add(match[1]);
		}
	}
	return [...slugs].sort().map((agentSlug) => {
		const profile = resolveAgentProfile(agentSlug, options);
		return {
			agentSlug,
			source: profile.path.startsWith(projectDir) ? "project" : "global",
			...(profile.model ? { model: profile.model } : {}),
			...(profile.variant ? { variant: profile.variant } : {}),
			description: profile.description ?? profile.prompt.split(/\s+/).slice(0, 24).join(" "),
		};
	});
}
