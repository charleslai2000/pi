import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { Box, type Component, Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import type { ToolRenderContext, ToolRenderResultOptions } from "../../../core/extensions/types.ts";
import type { CustomMessage } from "../../../core/messages.ts";
import { theme as defaultTheme, getMarkdownTheme, type Theme } from "../theme/theme.ts";

const CONTROL_TOOLS = new Set([
	"create_goal",
	"revise_goal",
	"update_goal_memory",
	"update_plan_memory",
	"create_task",
	"revise_task",
	"inspect_task",
	"set_task_dependencies",
	"inspect_frontier",
	"list_agents",
	"inspect_agent",
	"dispatch_task",
	"switch_executor_model",
	"notice_executor",
	"close_task",
]);

function textOf(result: AgentToolResult<unknown>): string {
	return result.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function pretty(value: unknown): string {
	try {
		const serialized = JSON.stringify(value, null, 2);
		return serialized === undefined ? String(value) : serialized;
	} catch {
		return String(value);
	}
}

function summarize(toolName: string, original: string): string {
	if (!original.trim()) return "Completed successfully (no result text)";
	try {
		const value: unknown = JSON.parse(original);
		const normalized =
			value && typeof value === "object" && "task" in value ? (value as { task: unknown }).task : value;
		const rows = Array.isArray(normalized) ? normalized : [normalized];
		const summaries = rows.slice(0, 8).map((row) => {
			if (!row || typeof row !== "object") return String(row);
			const item = row as Record<string, unknown>;
			const identity = [item.goalId, item.taskId, item.agentSlug, item.sessionId]
				.filter((part) => typeof part === "string")
				.join("/");
			const title = [item.title, item.name, item.description, item.objective].find(
				(part) => typeof part === "string",
			);
			const profile = typeof item.agentSlug === "string" ? item.agentSlug : undefined;
			const label = identity || profile || toolName;
			const status = typeof item.status === "string" ? ` [${item.status}]` : "";
			const extras = Array.isArray(item.prerequisites) ? `; ${item.prerequisites.length} prerequisite(s)` : "";
			return `${label}${title ? ` — ${title}` : ""}${status}${extras}`;
		});
		return summaries.join("\n") + (rows.length > 8 ? `\n…and ${rows.length - 8} more` : "");
	} catch {
		return original;
	}
}

function resultDetailText(result: AgentToolResult<unknown>): string {
	return `content:\n${pretty(result.content)}${result.details === undefined ? "" : `\n\ndetails:\n${pretty(result.details)}`}`;
}

function render(
	toolName: string,
	result: AgentToolResult<unknown>,
	options: ToolRenderResultOptions,
	context: ToolRenderContext,
): Component {
	try {
		const original = textOf(result);
		const error = context.isError;
		const box = new Box(1, 1, (value) => defaultTheme.bg(error ? "toolErrorBg" : "toolSuccessBg", value));
		if (options.expanded) {
			box.addChild(new Text(resultDetailText(result), 0, 0, (value) => defaultTheme.fg("toolOutput", value)));
		} else {
			const body = error ? original : summarize(toolName, original);
			box.addChild(
				new Markdown(body || "[No text result]", 0, 0, getMarkdownTheme(), {
					color: (value) => defaultTheme.fg("toolOutput", value),
				}),
			);
		}
		if (!options.expanded)
			box.addChild(new Text("click to expand", 0, 0, (value) => defaultTheme.fg("muted", value)));
		return box;
	} catch {
		return new Text(textOf(result) || "[Control result unavailable]", 0, 0);
	}
}

export function createControlToolRenderers(toolName: string) {
	if (!CONTROL_TOOLS.has(toolName)) return undefined;
	return {
		renderResult: (
			result: AgentToolResult<unknown>,
			options: ToolRenderResultOptions,
			_theme: Theme,
			context: ToolRenderContext,
		) => render(toolName, result, options, context),
	};
}

export const controlEventRenderer = (
	message: CustomMessage<unknown>,
	options: { expanded: boolean },
	_theme: Theme,
): Component => {
	const content =
		typeof message.content === "string"
			? message.content
			: message.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join("\n");
	const body = options.expanded
		? `content:\n${pretty(message.content)}${message.details === undefined ? "" : `\n\ndetails:\n${pretty(message.details)}`}`
		: content;
	const box = new Container();
	box.addChild(new Spacer(0));
	box.addChild(new Text("[control_event]", 0, 0, (value) => defaultTheme.fg("customMessageLabel", value)));
	if (options.expanded) {
		box.addChild(new Text(body, 0, 0, (value) => defaultTheme.fg("customMessageText", value)));
	} else {
		box.addChild(
			new Markdown(body || "[No event text]", 0, 0, getMarkdownTheme(), {
				color: (value) => defaultTheme.fg("customMessageText", value),
			}),
		);
	}
	if (!options.expanded) box.addChild(new Text("click to expand", 0, 0, (value) => defaultTheme.fg("muted", value)));
	return box;
};
