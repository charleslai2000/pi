import { APP_NAME } from "../config.ts";
import type { SourceInfo } from "./source-info.ts";

export type SlashCommandSource = "extension" | "prompt" | "skill";

export interface SlashCommandInfo {
	name: string;
	description?: string;
	source: SlashCommandSource;
	sourceInfo: SourceInfo;
}

export interface BuiltinSlashCommand {
	name: string;
	description: string;
	argumentHint?: string;
}

export const BUILTIN_SLASH_COMMANDS: ReadonlyArray<BuiltinSlashCommand> = [
	{ name: "settings", description: "Open settings menu" },
	{ name: "model", description: "Select model (opens selector UI)", argumentHint: "<provider/model>" },
	{ name: "tree", description: "Navigate session tree (switch branches)" },
	{ name: "thinking", description: "Set thinking level", argumentHint: "<level>" },
	{ name: "scoped-models", description: "Enable/disable models for Ctrl+P cycling" },
	{ name: "export", description: "Export session (HTML default, or specify path: .html/.jsonl)" },
	{ name: "import", description: "Import and resume a session from a JSONL file" },
	{ name: "share", description: "Share session as a secret GitHub gist" },
	{ name: "bug", description: "Report a bug to the Pi developers", argumentHint: "<description>" },
	{ name: "copy", description: "Copy last agent message to clipboard" },
	{ name: "name", description: "Set session display name" },
	{ name: "rename", description: "Rename the current session", argumentHint: "<name>" },
	{ name: "root", description: "Show PiRoot and current session cwd" },
	{ name: "session", description: "Show session info and stats" },
	{ name: "changelog", description: "Show changelog entries" },
	{ name: "hotkeys", description: "Show all keyboard shortcuts" },
	{ name: "fork", description: "Create a new fork from a previous user message" },
	{ name: "clone", description: "Duplicate the current session at the current position" },
	{ name: "trust", description: "Save project trust decision for future sessions" },
	{ name: "login", description: "Configure provider authentication", argumentHint: "<provider>" },
	{ name: "logout", description: "Remove provider authentication" },
	{ name: "new", description: "Start a new session", argumentHint: "[path]" },
	{ name: "compact", description: "Manually compact the session context" },
	{ name: "sessions", description: "Switch between live sessions" },
	{ name: "assign", description: "Assign a task to the foreground session", argumentHint: "<goal-id>/<task-id>" },
	{ name: "reassign", description: "Reassign a task to a session", argumentHint: "<goal-id>/<task-id> <session-id>" },
	{ name: "unassign", description: "Remove a task assignment", argumentHint: "<goal-id>/<task-id>" },
	{ name: "assignment", description: "Show a task or foreground assignment", argumentHint: "[goal-id/task-id]" },
	{ name: "task", description: "Show combined task control state", argumentHint: "<goal-id>/<task-id>" },
	{ name: "execute", description: "Dispatch an assigned task", argumentHint: "<goal-id>/<task-id>" },
	{ name: "complete", description: "Complete a task", argumentHint: "<goal-id>/<task-id>" },
	{ name: "cancel", description: "Cancel a task", argumentHint: "<goal-id>/<task-id>" },
	{ name: "frontier", description: "Show the current control frontier" },
	{ name: "resume", description: "Resume a different session" },
	{ name: "reload", description: "Reload keybindings, extensions, skills, prompts, themes, and context files" },
	{ name: "quit", description: `Quit ${APP_NAME}` },
];
