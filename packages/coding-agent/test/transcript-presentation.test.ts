import { ScrollView, Text } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { renderLayoutFrame } from "../../tui/src/layout.ts";
import { TranscriptPresentation } from "../src/modes/interactive/transcript-presentation.ts";
import { TranscriptVirtualView } from "../src/modes/interactive/transcript-virtual-view.ts";

function render(scroll: ScrollView): void {
	renderLayoutFrame(scroll, 80, 12, () => {});
}

describe("fullscreen transcript presentation virtualization", () => {
	it("restores 10k logical rows while materializing only the viewport and bounded overscan", () => {
		let constructed = 0;
		const presentation = new TranscriptPresentation();
		presentation.reset(
			Array.from({ length: 10_000 }, (_, index) => ({
				key: `session:entry-${index}`,
				kind: "message" as const,
				searchText: () => `message ${index}`,
				render: () => {
					constructed++;
					return new Text(`message ${index}`);
				},
			})),
		);
		const list = new TranscriptVirtualView(presentation);
		const scroll = new ScrollView(list, { follow: "end" });
		render(scroll);
		expect(presentation.count).toBe(10_000);
		expect(constructed).toBeLessThan(40);
		expect(presentation.getMaterializedCount()).toBeLessThan(40);
		for (let index = 0; index < 25; index++) {
			scroll.scrollBy(-8);
			render(scroll);
		}
		expect(presentation.getMaterializedCount()).toBeLessThan(40);
		scroll.scrollToEnd();
		render(scroll);
		expect(presentation.getMaterializedCount()).toBeLessThan(40);
		expect(list.getMaterializedRange().end).toBe(10_000);
	});

	it("keeps logical item state across eviction and rematerialization", () => {
		let current = "initial";
		let rendered = 0;
		const presentation = new TranscriptPresentation();
		presentation.reset(
			Array.from({ length: 100 }, (_, index) => ({
				key: `entry-${index}`,
				kind: "message" as const,
				searchText: () => (index === 60 ? current : `entry ${index}`),
				render: () => {
					rendered++;
					return new Text(index === 60 ? current : `entry ${index}`);
				},
			})),
		);
		const list = new TranscriptVirtualView(presentation);
		const scroll = new ScrollView(list);
		render(scroll);
		const original = presentation.getComponent("entry-0");
		scroll.scrollToVirtualKey("entry-60", "start");
		render(scroll);
		expect(presentation.getComponent("entry-0")).toBeUndefined();
		current = "latest update";
		scroll.scrollToVirtualKey("entry-60", "start");
		render(scroll);
		expect(presentation.getComponent("entry-60")).toBeDefined();
		expect(rendered).toBeLessThan(80);
		expect(original).toBeDefined();
	});

	it("searches logical item descriptors without materializing every item", () => {
		let rendered = 0;
		const presentation = new TranscriptPresentation();
		presentation.reset(
			Array.from({ length: 10_000 }, (_, index) => ({
				key: `entry-${index}`,
				kind: "message" as const,
				searchText: () => (index === 8_000 ? "needle target" : `row ${index}`),
				render: () => {
					rendered++;
					return new Text(`row ${index}`);
				},
			})),
		);
		const list = new TranscriptVirtualView(presentation);
		const scroll = new ScrollView(list);
		render(scroll);
		expect(scroll.findAndScrollVirtualMatch("needle", "entry-7999", 1, "start")).toBe("entry-8000");
		render(scroll);
		expect(rendered).toBeLessThan(50);
		expect(presentation.getMaterializedCount()).toBeLessThan(40);
	});
});
