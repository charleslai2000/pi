import assert from "node:assert";
import { describe, it } from "node:test";
import { findAltScreenSearchMatches } from "../src/alt-screen-search.ts";
import { ScrollView } from "../src/components/scroll-view.ts";
import { VirtualList } from "../src/components/virtual-list.ts";
import { type Component, Text } from "../src/index.ts";
import { renderLayoutFrame } from "../src/layout.ts";
import { stripTerminalSequences } from "../src/utils.ts";

function fixture(count: number, height: (index: number) => number) {
	let keys = Array.from({ length: count }, (_, i) => `item-${i}`);
	let materialized = 0;
	const list = new VirtualList(
		{
			getCount: () => keys.length,
			getKey: (index) => keys[index]!,
			materialize: (index): Component => {
				materialized++;
				const key = keys[index]!;
				return new Text(
					Array.from({ length: height(index) }, (_, line) => `${key}: needle ${line}`).join("\n"),
					0,
					0,
				);
			},
			findMatchingKey: (query, fromIndex, direction) => {
				for (let index = fromIndex + direction; index >= 0 && index < keys.length; index += direction) {
					if (`${keys[index]}: needle ${index % 3}`.toLowerCase().includes(query.toLowerCase()))
						return keys[index];
				}
				return undefined;
			},
		},
		{ estimatedItemHeight: 3, overscan: 3 },
	);
	const scroll = new ScrollView(list, { follow: "end" });
	const render = (width = 40, rows = 10) => renderLayoutFrame(scroll, width, rows, () => {});
	return {
		list,
		scroll,
		render,
		getMaterialized: () => materialized,
		setKeys: (next: string[]) => {
			keys = next;
		},
	};
}

const visible = (frame: ReturnType<ReturnType<typeof fixture>["render"]>) =>
	frame.lines.map((line) => stripTerminalSequences(line).trimEnd());

describe("VirtualList layout primitive", () => {
	it("keeps 10k variable-height rows bounded while exposing logical extent and scrolling both ways", () => {
		const f = fixture(10_000, (index) => (index % 4) + 1);
		const first = f.render();
		assert.equal(f.list.logicalCount, 10_000);
		assert.ok(f.list.getLogicalExtent() > 10_000);
		assert.ok(f.list.getMaterializedCount() < 30);
		assert.equal(first.root.children[0]?.rect.height, f.list.getLogicalExtent());
		const start = f.list.getMaterializedRange().start;
		f.scroll.scrollTo(20_000);
		f.render();
		const middle = f.list.getMaterializedRange().start;
		assert.ok(middle > start);
		f.scroll.scrollTo(0);
		f.render();
		assert.ok(f.list.getMaterializedRange().start < middle);
		assert.ok(f.getMaterialized() < 100);
	});

	it("captures key/offset only in logical prefix coordinates, not a stale materialized window", () => {
		const f = fixture(200, (index) => (index % 5) + 1);
		f.render();
		f.scroll.scrollTo(120);
		f.render();
		const before = f.list.capturePosition();
		assert.ok(before.key);
		const beforeIndex = f.list.findKey(before.key!);
		assert.notEqual(beforeIndex, undefined);
		const beforeTop = f.list.getGeometry().find((row) => row.key === before.key)?.top;
		if (beforeTop !== undefined) assert.equal(before.offset, f.list.getScrollOffset() - beforeTop);
		const generation = f.list.getLayoutVersion();
		f.list.invalidateMeasurement(before.key!);
		f.render(17);
		assert.ok(f.list.getLayoutVersion() > generation);
		const after = f.list.capturePosition();
		assert.equal(after.key, before.key);
		assert.equal(after.offset, before.offset);
	});

	it("preserves a stable keyed anchor and actual offset across prepend and remove-before", () => {
		const f = fixture(60, (index) => (index % 3) + 1);
		f.render();
		f.scroll.scrollTo(50);
		f.render();
		const before = f.list.capturePosition();
		assert.ok(before.key);
		f.setKeys(["new-0", "new-1", ...Array.from({ length: 60 }, (_, i) => `item-${i}`)]);
		f.list.applyMutation({ type: "prepend" });
		assert.equal(f.list.capturePosition().key, before.key);
		f.render();
		assert.equal(f.list.capturePosition().key, before.key);
		assert.equal(f.list.capturePosition().offset, before.offset);
		f.setKeys(Array.from({ length: 40 }, (_, i) => `item-${i + 20}`));
		f.list.applyMutation({ type: "remove-before" });
		f.render();
		assert.equal(f.list.capturePosition().key, before.key);
		assert.equal(f.list.capturePosition().offset, before.offset);
	});

	it("retains scroll-to-logical-key authority through materialization, reflow, and later layout", () => {
		const f = fixture(500, (index) => (index % 4) + 1);
		f.render();
		assert.equal(f.scroll.scrollToVirtualKey("item-300", "center"), true);
		f.render(12);
		assert.equal(f.list.capturePosition().key, "item-300");
		const generation = f.list.getLayoutVersion();
		f.render(24);
		assert.ok(f.list.getLayoutVersion() > generation);
		assert.equal(f.list.capturePosition().key, "item-300");
	});

	it("supports dynamic height changes without losing the current anchor", () => {
		let extra = 0;
		const f = fixture(100, (index) => (index % 3) + 1 + (index === 30 ? extra : 0));
		f.render();
		f.scroll.scrollTo(40);
		f.render();
		const before = f.list.capturePosition();
		extra = 3;
		f.list.applyMutation({ type: "item-size-changed", key: "item-30" });
		f.render();
		assert.equal(f.list.capturePosition().key, before.key);
		assert.equal(f.list.capturePosition().offset, before.offset);
	});

	it("materializes a logical search target and returns valid measured window coordinates", () => {
		const f = fixture(2_000, (index) => (index % 3) + 1);
		f.render();
		assert.ok(findAltScreenSearchMatches(["needle target"], "needle").length > 0);
		assert.equal(f.scroll.findAndScrollVirtualMatch("needle", "item-1499", 1, "start"), "item-1500");
		const frame = f.render();
		assert.ok(visible(frame).some((line) => line.includes("item-1500")));
		assert.equal(f.list.capturePosition().key, "item-1500");
		assert.ok(f.list.getGeometry().some((row) => row.key === "item-1500" && row.height > 0));
	});

	it("exposes physical selection row coordinates mapped to logical content rows", () => {
		const f = fixture(80, (index) => (index % 4) + 1);
		f.render();
		f.scroll.scrollTo(90);
		const frame = f.render();
		const rows = frame.root.children[0]!.children;
		assert.ok(rows.length > 0);
		for (let i = 1; i < rows.length; i++)
			assert.ok(rows[i]!.rect.y >= rows[i - 1]!.rect.y + rows[i - 1]!.rect.height);
		const actual = f.list.getGeometry()[0]!;
		assert.equal(rows[0]!.rect.y + f.list.getScrollOffset(), actual.top);
	});
});
