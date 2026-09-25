import type { Component } from "./tui.ts";

export const LAYOUT_NODE = Symbol.for("@earendil-works/pi-tui/layout-node");

export interface LayoutViewport {
	width: number;
	height: number;
}

export interface StackLayoutEntry {
	component: Component;
	basis?: number | "auto";
	grow?: number;
	shrink?: number;
	minSize?: number;
	maxSize?: number;
	visible?: (viewport: LayoutViewport) => boolean;
}

export interface StackLayoutNode {
	type: "vstack" | "hstack";
	entries: readonly StackLayoutEntry[];
	gap: number;
	align: "stretch" | "start" | "center" | "end";
}

/** A materialized item's measured placement in virtual content coordinates. */
export interface VirtualLayoutGeometry {
	component: Component;
	key: string;
	index: number;
	top: number;
	height: number;
}

export interface VirtualLayoutRange {
	start: number;
	end: number;
}

export interface VirtualLayoutContext {
	width: number;
	viewportHeight: number;
	scrollTop: number;
	overscan: number;
}

/**
 * Logical data and item rendering remain caller-owned. The layout node owns
 * logical extent, materialization, measurements and virtual-coordinate mapping.
 * layoutWindow measures materialized items and returns their final geometry.
 */
export interface VirtualLayoutState {
	readonly logicalCount: number;
	getLogicalExtent(): number;
	getScrollOffset(): number;
	isFollowingEnd(): boolean;
	layoutWindow(context: VirtualLayoutContext): readonly VirtualLayoutGeometry[];
	findKey(key: string): number | undefined;
	findMatchingKey(query: string, fromKey: string | undefined, direction: -1 | 1): string | undefined;
	getKey(index: number): string;
	getMaterializedRange(): VirtualLayoutRange;
	setViewport(viewportHeight: number, scrollTop: number, followingEnd: boolean): void;
	setScrollTop(scrollTop: number): void;
	getLayoutVersion(): number;
	scrollToIndex(index: number, align: "start" | "center" | "end", viewportHeight: number): number;
	onScrollOffsetChanged?(scrollTop: number): void;
}

export interface VirtualLayoutNode {
	type: "virtual";
	state: VirtualLayoutState;
}

export interface ScrollLayoutGeometry {
	component: Component;
	key?: string;
	top: number;
	height: number;
}

export interface ScrollLayoutState {
	readonly scrollTop: number;
	readonly primary: boolean;
	readonly overscroll: "chain" | "contain";
	readonly viewportHeight: number;
	getContentWidth(width: number): number;
	getAnchorKey(component: Component): string | undefined;
	updateLayout(
		contentHeight: number,
		viewportHeight: number,
		requestRender: () => void,
		geometry?: readonly ScrollLayoutGeometry[],
	): void;
	updateVirtualLayout?(contentHeight: number, viewportHeight: number, requestRender: () => void): void;
}

export interface ContainerLayoutNode {
	type: "container";
	children: readonly Component[];
	getAnchorKey(component: Component): string | undefined;
}

export interface ScrollLayoutNode {
	type: "scroll";
	component: Component;
	state: ScrollLayoutState;
}

export type LayoutNode = StackLayoutNode | ScrollLayoutNode | ContainerLayoutNode | VirtualLayoutNode;

export interface LayoutComponent extends Component {
	[LAYOUT_NODE](): LayoutNode;
}

export function getLayoutNode(component: Component): LayoutNode | undefined {
	const candidate = component as Partial<LayoutComponent>;
	return typeof candidate[LAYOUT_NODE] === "function" ? candidate[LAYOUT_NODE]() : undefined;
}
