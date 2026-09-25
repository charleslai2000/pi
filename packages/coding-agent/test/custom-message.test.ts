import { Text } from "@earendil-works/pi-tui";
import { describe, expect, test } from "vitest";
import type { MessageRenderer, MessageRenderOptions } from "../src/core/extensions/types.ts";
import type { CustomMessage } from "../src/core/messages.ts";
import { controlEventRenderer } from "../src/modes/interactive/components/control-presentation.ts";
import { CustomMessageComponent } from "../src/modes/interactive/components/custom-message.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

describe("CustomMessageComponent", () => {
	test("provides output padding to custom renderers and updates it", () => {
		initTheme("dark");
		const optionsSeen: MessageRenderOptions[] = [];
		const renderer: MessageRenderer = (_message, options) => {
			optionsSeen.push(options);
			return new Text("custom", options.outputPad, 0);
		};
		const message: CustomMessage = {
			role: "custom",
			customType: "test",
			content: "custom",
			display: true,
			timestamp: Date.now(),
		};
		const component = new CustomMessageComponent(message, renderer, undefined, 1);

		expect(optionsSeen).toEqual([{ expanded: false, outputPad: 1 }]);
		expect(
			component
				.render(40)
				.map(stripAnsi)
				.some((line) => line.startsWith(" custom")),
		).toBe(true);

		component.setOutputPad(0);

		expect(optionsSeen.at(-1)).toEqual({ expanded: false, outputPad: 0 });
		expect(
			component
				.render(40)
				.map(stripAnsi)
				.some((line) => line.startsWith("custom")),
		).toBe(true);
	});

	test("control events keep compact content and reveal exact content/details when expanded", () => {
		initTheme("dark");
		const content = "Task goal-a/T001 blocked";
		const details = { factKey: "goal-a/T001:blocked", source: "lifecycle" };
		const component = new CustomMessageComponent(
			{
				role: "custom",
				customType: "control_event",
				content,
				details,
				display: true,
				timestamp: Date.now(),
			},
			controlEventRenderer,
		);
		const collapsed = stripAnsi(component.render(100).join("\n"));
		expect(collapsed).toContain("[control_event]");
		expect(collapsed).toContain(content);
		expect(collapsed).not.toContain("factKey");
		component.setExpanded(true);
		const expanded = stripAnsi(component.render(100).join("\n"));
		expect(expanded).toContain(content);
		expect(expanded).toContain("content:");
		expect(expanded).toContain('"factKey": "goal-a/T001:blocked"');
		expect(expanded).toContain('"source": "lifecycle"');
	});
});
