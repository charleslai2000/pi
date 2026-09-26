import {
	LAYOUT_NODE,
	type VirtualLayoutContext,
	type VirtualLayoutGeometry,
	type VirtualLayoutNode,
	type VirtualLayoutRange,
	type VirtualLayoutState,
} from "../layout-node.ts";
import type { Component } from "../tui.ts";

export interface VirtualListData {
	getCount(): number;
	getKey(index: number): string;
	materialize(index: number): Component;
	findMatchingKey?(query: string, fromIndex: number, direction: -1 | 1): string | undefined;
}

export type VirtualListMutation =
	| { type: "append"; followEnd?: boolean }
	| { type: "prepend" }
	| { type: "remove-before" }
	| { type: "item-size-changed"; key: string }
	| { type: "replace" };

export interface VirtualListPosition {
	key?: string;
	index?: number;
	offset: number;
	followingEnd: boolean;
}

export interface VirtualListOptions {
	estimatedItemHeight?: number;
	overscan?: number;
	followEnd?: boolean;
}

export interface VirtualListCallbacks {
	onStartReached?: (range: VirtualLayoutRange) => void;
	onEndReached?: (range: VirtualLayoutRange) => void;
	onRangeChange?: (range: VirtualLayoutRange) => void;
}

class HeightIndex {
	private values: number[] = [];
	private tree: number[] = [0];

	reset(count: number, estimate: number): void {
		this.values = Array.from({ length: count }, () => estimate);
		this.tree = Array.from({ length: count + 1 }, () => 0);
		for (let index = 0; index < count; index++) this.add(index, estimate);
	}
	get(index: number): number {
		return this.values[index] ?? 0;
	}
	set(index: number, value: number): void {
		if (index < 0 || index >= this.values.length) return;
		const next = Math.max(1, Math.floor(value));
		const delta = next - this.values[index]!;
		if (!delta) return;
		this.values[index] = next;
		this.add(index, delta);
	}
	sum(end: number): number {
		let total = 0;
		for (let index = Math.max(0, Math.min(this.values.length, end)); index > 0; index -= index & -index)
			total += this.tree[index]!;
		return total;
	}
	find(offset: number): number {
		if (!this.values.length) return 0;
		let index = 0;
		let sum = 0;
		let bit = 1;
		while (bit << 1 <= this.values.length) bit <<= 1;
		for (; bit; bit >>= 1) {
			const next = index + bit;
			if (next <= this.values.length && sum + this.tree[next]! <= offset) {
				index = next;
				sum += this.tree[next]!;
			}
		}
		return Math.min(index, this.values.length - 1);
	}
	private add(index: number, delta: number): void {
		for (let i = index + 1; i < this.tree.length; i += i & -i) this.tree[i] += delta;
	}
}

/** Caller-owned keyed collection rendered through a bounded, measured layout window. */
export class VirtualList implements VirtualLayoutState, Component {
	private readonly data: VirtualListData;
	private readonly heights = new HeightIndex();
	private readonly measuredHeights = new Map<string, number>();
	private readonly materialized = new Map<number, Component>();
	private readonly options: Required<VirtualListOptions>;
	private readonly callbacks: VirtualListCallbacks;
	private count = 0;
	private keyIndex = new Map<string, number>();
	private scrollTop = 0;
	private viewportHeight = 1;
	private width = 0;
	private lastWidth = 0;
	private followingEnd: boolean;
	private range: VirtualLayoutRange = { start: 0, end: 0 };
	private geometry: VirtualLayoutGeometry[] = [];
	private pendingPosition?: VirtualListPosition;
	private navigation?: { key: string; align: "start" | "center" | "end" };
	private navigationAnchor?: VirtualListPosition;
	private followNextEnd = false;
	private layoutVersion = 0;

	constructor(data: VirtualListData, options: VirtualListOptions = {}, callbacks: VirtualListCallbacks = {}) {
		this.data = data;
		this.options = {
			estimatedItemHeight: Math.max(1, Math.floor(options.estimatedItemHeight ?? 3)),
			overscan: Math.max(0, Math.floor(options.overscan ?? 4)),
			followEnd: options.followEnd ?? true,
		};
		this.callbacks = callbacks;
		this.count = Math.max(0, Math.floor(data.getCount()));
		this.rebuildKeyIndex();
		this.followingEnd = false;
		this.followNextEnd = false;
		this.resetHeights();
	}

	get logicalCount(): number {
		return this.count;
	}
	getLogicalExtent(): number {
		return this.heights.sum(this.count);
	}
	getMaterializedRange(): VirtualLayoutRange {
		return this.range;
	}
	getMaterializedCount(): number {
		return this.materialized.size;
	}
	getScrollTop(): number {
		return this.scrollTop;
	}
	getScrollOffset(): number {
		return this.scrollTop;
	}
	isFollowingEnd(): boolean {
		return this.followingEnd;
	}

	[LAYOUT_NODE](): VirtualLayoutNode {
		return { type: "virtual", state: this };
	}
	render(_width: number): string[] {
		return [];
	}
	invalidate(): void {
		for (const component of this.materialized.values()) component.invalidate();
	}

	setViewport(viewportHeight: number, scrollTop: number, followingEnd: boolean): void {
		this.viewportHeight = Math.max(0, Math.floor(viewportHeight));
		this.scrollTop = Math.max(0, Math.floor(scrollTop));
		this.followingEnd = followingEnd;
	}
	setScrollTop(scrollTop: number): void {
		this.scrollTop = Math.max(0, Math.floor(scrollTop));
		this.followingEnd = false;
	}

	layoutWindow(context: VirtualLayoutContext): readonly VirtualLayoutGeometry[] {
		if (this.data.getCount() !== this.count) {
			this.count = Math.max(0, Math.floor(this.data.getCount()));
			this.rebuildKeyIndex();
			this.resetHeights();
		}
		const widthChanged = this.width !== 0 && this.width !== context.width;
		this.width = context.width;
		if (widthChanged && !this.navigationAnchor) this.pendingPosition ??= this.capturePositionAt(this.scrollTop);
		this.viewportHeight = Math.max(0, Math.floor(context.viewportHeight));
		let top =
			this.followNextEnd || this.followingEnd
				? Math.max(0, this.getLogicalExtent() - this.viewportHeight)
				: Math.max(0, Math.floor(context.scrollTop));
		if (this.navigationAnchor?.key && !this.navigation) {
			const anchorIndex = this.findKey(this.navigationAnchor.key);
			if (anchorIndex !== undefined) top = Math.max(0, this.heights.sum(anchorIndex) - this.navigationAnchor.offset);
		}
		if (this.lastWidth > 0 && this.lastWidth !== context.width && !this.navigationAnchor)
			this.pendingPosition ??= this.capturePositionAt(top);
		this.followNextEnd = false;
		const navigation = this.navigation;
		const preserveAnchor = !navigation ? (this.pendingPosition ?? this.capturePositionAt(top)) : undefined;
		const targetIndex = navigation ? this.findKey(navigation.key) : undefined;
		if (navigation && targetIndex !== undefined) {
			top = Math.max(0, this.heights.sum(targetIndex));
		}
		const startOffset = Math.max(0, top - Math.max(0, context.overscan) * this.options.estimatedItemHeight);
		const endOffset = top + this.viewportHeight + Math.max(0, context.overscan) * this.options.estimatedItemHeight;
		let start = Math.max(0, this.heights.find(startOffset) - this.options.overscan);
		let end = Math.min(this.count, this.heights.find(endOffset) + this.options.overscan + 1);
		if (targetIndex !== undefined) {
			start = Math.min(start, Math.max(0, targetIndex - this.options.overscan));
			end = Math.max(end, Math.min(this.count, targetIndex + this.options.overscan + 1));
		}
		const rows: VirtualLayoutGeometry[] = [];
		for (let index = start; index < end; index++) {
			const key = this.data.getKey(index);
			let component = this.materialized.get(index);
			if (!component) {
				component = this.data.materialize(index);
				this.materialized.set(index, component);
			}
			const height = Math.max(1, component.render(context.width).length);
			this.measuredHeights.set(key, height);
			this.heights.set(index, height);
			rows.push({ component, key, index, top: this.heights.sum(index), height });
		}
		for (const index of this.materialized.keys()) if (index < start || index >= end) this.materialized.delete(index);
		const previousRange = this.range;
		this.range = { start, end };
		this.layoutVersion++;
		if (targetIndex !== undefined && rows.some((row) => row.key === navigation?.key)) {
			const target = rows.find((row) => row.key === navigation?.key)!;
			top =
				navigation!.align === "center"
					? target.top - Math.floor((this.viewportHeight - target.height) / 2)
					: navigation!.align === "end"
						? target.top + target.height - this.viewportHeight
						: target.top;
			top = Math.max(0, top);
			this.followingEnd = false;
			this.navigation = undefined;
			this.navigationAnchor = { key: target.key, offset: top - target.top, followingEnd: false };
		} else if (
			preserveAnchor?.key &&
			(this.pendingPosition !== undefined || widthChanged || this.navigationAnchor !== undefined)
		) {
			const anchorIndex = this.findKey(preserveAnchor.key);
			if (anchorIndex !== undefined) {
				const actual = rows.find((row) => row.key === preserveAnchor.key);
				const anchorTop = actual?.top ?? this.heights.sum(anchorIndex);
				top = Math.max(0, anchorTop - preserveAnchor.offset);
			}
		} else if (this.followingEnd) top = Math.max(0, this.getLogicalExtent() - this.viewportHeight);
		this.scrollTop = top;
		this.geometry = rows;
		this.lastWidth = context.width;
		if (previousRange.start !== start || previousRange.end !== end) this.callbacks.onRangeChange?.(this.range);
		if (start === 0) this.callbacks.onStartReached?.(this.range);
		if (end === this.count) this.callbacks.onEndReached?.(this.range);
		if (this.pendingPosition?.key) this.navigationAnchor = this.pendingPosition;
		this.pendingPosition = undefined;
		return rows;
	}

	findKey(key: string): number | undefined {
		return this.keyIndex.get(key);
	}
	findMatchingKey(query: string, fromKey: string | undefined, direction: -1 | 1): string | undefined {
		if (!this.data.findMatchingKey) return undefined;
		const fromIndex = fromKey === undefined ? (direction > 0 ? -1 : this.count) : (this.findKey(fromKey) ?? -1);
		return this.data.findMatchingKey(query, fromIndex, direction);
	}

	getKey(index: number): string {
		return this.data.getKey(index);
	}
	scrollToIndex(index: number, align: "start" | "center" | "end", viewportHeight: number): number {
		if (this.count === 0) return 0;
		const clamped = Math.max(0, Math.min(this.count - 1, Math.floor(index)));
		const key = this.data.getKey(clamped);
		const top = this.heights.sum(clamped);
		const height = this.heights.get(clamped);
		this.navigation = { key, align };
		this.navigationAnchor = { key, offset: 0, followingEnd: false };
		this.followingEnd = false;
		this.scrollTop = Math.max(
			0,
			align === "center"
				? top - Math.floor((viewportHeight - height) / 2)
				: align === "end"
					? top + height - viewportHeight
					: top,
		);
		this.followingEnd = false;
		return this.scrollTop;
	}
	scrollTo(offset: number, viewportHeight = this.viewportHeight): number {
		this.navigation = undefined;
		this.navigationAnchor = undefined;
		this.followingEnd = false;
		this.scrollTop = Math.max(0, Math.min(Math.max(0, this.getLogicalExtent() - viewportHeight), Math.floor(offset)));
		this.pendingPosition = this.capturePositionAt(this.scrollTop);
		this.navigationAnchor = undefined;
		this.followingEnd = false;
		return this.scrollTop;
	}
	capturePosition(): VirtualListPosition {
		return this.navigationAnchor ?? this.pendingPosition ?? this.capturePositionAt(this.scrollTop);
	}
	restorePosition(position: VirtualListPosition): void {
		this.navigation = undefined;
		this.navigationAnchor = position;
		this.pendingPosition = position;
		this.followingEnd = position.followingEnd;
		const index = position.index ?? (position.key === undefined ? undefined : this.findKey(position.key));
		if (index !== undefined) this.scrollTop = Math.max(0, this.heights.sum(index) + position.offset);
	}
	applyMutation(mutation: VirtualListMutation): void {
		const oldCount = this.count;
		const position = this.capturePosition();
		this.followNextEnd = false;
		const anchorIndex = position.index ?? (position.key === undefined ? undefined : this.findKey(position.key));
		const anchorHeight = anchorIndex === undefined ? undefined : this.heights.get(anchorIndex);
		this.count = Math.max(0, this.data.getCount());
		this.rebuildKeyIndex();
		if (mutation.type === "replace") {
			this.measuredHeights.clear();
			this.materialized.clear();
			this.navigation = undefined;
			this.pendingPosition = undefined;
			this.followingEnd = false;
			this.resetHeights();
			this.scrollTop = 0;
			this.range = { start: 0, end: 0 };
			this.geometry = [];
			this.layoutVersion++;
			this.materialized.clear();
			this.callbacks.onRangeChange?.(this.range);
			return;
		}
		const added = mutation.type === "prepend" ? Math.max(0, this.count - oldCount) : 0;
		const removed = mutation.type === "remove-before" ? Math.max(0, oldCount - this.count) : 0;
		const shift = added - removed;
		const components = new Map<number, Component>();
		for (const [index, component] of this.materialized) {
			const next = index + shift;
			if (next >= 0 && next < this.count) components.set(next, component);
		}
		this.materialized.clear();
		for (const [index, component] of components) this.materialized.set(index, component);
		this.resetHeights();
		if (position.key && anchorIndex !== undefined) {
			const nextIndex = anchorIndex + shift;
			if (nextIndex >= 0 && nextIndex < this.count && anchorHeight !== undefined)
				this.heights.set(nextIndex, anchorHeight);
			const remappedIndex = Math.max(0, Math.min(this.count - 1, nextIndex));
			const remapped = { ...position, key: this.data.getKey(remappedIndex), index: remappedIndex };
			this.pendingPosition = remapped;
			this.restorePosition(remapped);
		}
		if (mutation.type === "append") this.followNextEnd = mutation.followEnd ?? position.followingEnd;
	}
	invalidateMeasurement(key: string): void {
		this.pendingPosition ??= this.capturePosition();
		this.measuredHeights.delete(key);
		const index = this.findKey(key);
		if (index !== undefined) this.heights.set(index, this.options.estimatedItemHeight);
	}
	getGeometry(): readonly VirtualLayoutGeometry[] {
		return this.geometry;
	}
	getLayoutVersion(): number {
		return this.layoutVersion;
	}
	onScrollOffsetChanged(scrollTop: number): void {
		this.scrollTop = Math.max(0, Math.floor(scrollTop));
	}

	private capturePositionAt(top: number): VirtualListPosition {
		if (this.count === 0) return { offset: 0, followingEnd: this.followingEnd };
		const index = this.heights.find(top);
		return {
			key: this.data.getKey(index),
			index,
			offset: top - this.heights.sum(index),
			followingEnd: this.followingEnd,
		};
	}
	private rebuildKeyIndex(): void {
		this.keyIndex.clear();
		for (let index = 0; index < this.count; index++) this.keyIndex.set(this.data.getKey(index), index);
	}
	private resetHeights(): void {
		this.heights.reset(this.count, this.options.estimatedItemHeight);
		for (let index = 0; index < this.count; index++) {
			const estimate = this.measuredHeights.get(this.data.getKey(index));
			if (estimate !== undefined) this.heights.set(index, estimate);
		}
	}
}
