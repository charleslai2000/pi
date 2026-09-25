import { getLayoutNode, LAYOUT_NODE, type ScrollLayoutGeometry, type ScrollLayoutNode } from "../layout-node.ts";
import { type Component, Container } from "../tui.ts";
import { ScrollAnchorContainer } from "./scroll-anchor-container.ts";

export type ScrollViewScrollbar = "hidden" | "auto" | "always";

export interface ScrollViewOptions {
	axis?: "vertical";
	follow?: "none" | "end";
	primary?: boolean;
	overscroll?: "chain" | "contain";
	scrollbar?: ScrollViewScrollbar;
	scrollbarTrackStyle?: (text: string) => string;
	scrollbarThumbStyle?: (text: string) => string;
	scrollbarHideDelayMs?: number;
}

export interface ScrollViewScrollToOptions {
	/** Keep follow-end disabled even when the target is the current content end. */
	disableFollow?: boolean;
}

export interface ScrollViewAnchor {
	readonly key: string;
	readonly offset: number;
}

export class ScrollView extends Container {
	private readonly child: Component;
	readonly followEnd: boolean;
	readonly primary: boolean;
	readonly overscroll: "chain" | "contain";
	readonly scrollbarTrackStyle: (text: string) => string;
	readonly scrollbarThumbStyle: (text: string) => string;
	private currentScrollbar: ScrollViewScrollbar;
	private readonly scrollbarHideDelayMs: number;
	private currentScrollTop = 0;
	private contentHeight = 0;
	private currentViewportHeight = 0;
	private followingEnd: boolean;
	private followSuppressedAtEnd = false;
	private requestRenderCallback: (() => void) | undefined;
	private transientScrollbarVisible = false;
	private scrollbarActive = false;
	private scrollbarHideTimer: NodeJS.Timeout | undefined;
	private pendingAnchor?: ScrollViewAnchor;
	private fallbackAnchor?: ScrollViewAnchor;
	private contentGeometry: ScrollLayoutGeometry[] = [];

	constructor(component: Component, options: ScrollViewOptions = {}) {
		super();
		if (options.axis !== undefined && options.axis !== "vertical")
			throw new Error(`Unsupported ScrollView axis: ${options.axis}`);
		this.child = component;
		this.children.push(component);
		this.followEnd = (options.follow ?? "none") === "end";
		this.followingEnd = this.followEnd;
		this.primary = options.primary ?? false;
		this.overscroll = options.overscroll ?? "chain";
		this.currentScrollbar = options.scrollbar ?? "hidden";
		this.scrollbarTrackStyle = options.scrollbarTrackStyle ?? ((text) => `\x1b[90m${text}\x1b[39m`);
		this.scrollbarThumbStyle = options.scrollbarThumbStyle ?? ((text) => `\x1b[37m${text}\x1b[39m`);
		this.scrollbarHideDelayMs = Math.max(0, Math.floor(options.scrollbarHideDelayMs ?? 1000));
	}

	get scrollTop(): number {
		return this.currentScrollTop;
	}
	get isFollowingEnd(): boolean {
		return this.followingEnd;
	}
	get viewportHeight(): number {
		return this.currentViewportHeight;
	}
	get scrollbar(): ScrollViewScrollbar {
		return this.currentScrollbar;
	}
	get isScrollbarActive(): boolean {
		return this.scrollbarActive;
	}
	get isScrollbarVisible(): boolean {
		if (this.scrollbar === "always") return this.currentViewportHeight > 0;
		return (
			this.scrollbar === "auto" && this.contentHeight > this.currentViewportHeight && this.transientScrollbarVisible
		);
	}

	setScrollbar(scrollbar: ScrollViewScrollbar): void {
		if (scrollbar === this.currentScrollbar) return;
		this.currentScrollbar = scrollbar;
		if (scrollbar !== "auto") this.hideTransientScrollbar();
		else if (this.scrollbarActive) this.markScrollbarActivity();
		this.requestRenderCallback?.();
	}

	findAndScrollVirtualMatch(
		query: string,
		fromKey: string | undefined,
		direction: -1 | 1,
		align: "start" | "center" | "end" = "center",
	): string | undefined {
		const node = getLayoutNode(this.child);
		if (node?.type !== "virtual") return undefined;
		const key = node.state.findMatchingKey(query, fromKey, direction);
		if (key === undefined || !this.scrollToVirtualKey(key, align)) return undefined;
		return key;
	}

	scrollToVirtualKey(key: string, align: "start" | "center" | "end" = "start"): boolean {
		const node = getLayoutNode(this.child);
		if (node?.type !== "virtual") return false;
		const index = node.state.findKey(key);
		if (index === undefined) return false;
		const offset = node.state.scrollToIndex(index, align, this.currentViewportHeight);
		this.currentScrollTop = offset;
		node.state.onScrollOffsetChanged?.(offset);
		this.followingEnd = false;
		this.followSuppressedAtEnd = false;
		this.requestRenderCallback?.();
		return true;
	}

	getContentWidth(width: number): number {
		return this.scrollbar === "always" && width > 1 ? width - 1 : width;
	}

	updateVirtualLayout(contentHeight: number, viewportHeight: number, requestRender: () => void): void {
		this.contentHeight = Math.max(0, Math.floor(contentHeight));
		this.currentViewportHeight = Math.max(0, Math.floor(viewportHeight));
		this.requestRenderCallback = requestRender;
		const max = Math.max(0, this.contentHeight - this.currentViewportHeight);
		const node = getLayoutNode(this.child);
		if (node?.type !== "virtual") return;
		this.currentScrollTop = this.followingEnd ? max : Math.max(0, Math.min(node.state.getScrollOffset(), max));
		node.state.setViewport(this.currentViewportHeight, this.currentScrollTop, this.followingEnd);
	}

	updateVirtualExtent(contentHeight: number, viewportHeight: number, requestRender: () => void): void {
		this.updateLayout(contentHeight, viewportHeight, requestRender, []);
	}

	private stateVirtualPosition(scrollTop: number, _followingEnd: boolean): void {
		const node = getLayoutNode(this.child);
		if (node?.type === "virtual") node.state.onScrollOffsetChanged?.(scrollTop);
	}

	private markScrollbarActivity(): void {
		if (this.scrollbar !== "auto" || this.contentHeight <= this.currentViewportHeight) return;
		this.transientScrollbarVisible = true;
		if (this.scrollbarHideTimer) {
			clearTimeout(this.scrollbarHideTimer);
			this.scrollbarHideTimer = undefined;
		}
		if (this.scrollbarActive) return;
		this.scrollbarHideTimer = setTimeout(() => {
			this.scrollbarHideTimer = undefined;
			this.transientScrollbarVisible = false;
			this.requestRenderCallback?.();
		}, this.scrollbarHideDelayMs);
		this.scrollbarHideTimer.unref();
	}

	private hideTransientScrollbar(): void {
		this.transientScrollbarVisible = false;
		if (this.scrollbarHideTimer) {
			clearTimeout(this.scrollbarHideTimer);
			this.scrollbarHideTimer = undefined;
		}
	}

	setScrollbarActive(active: boolean): void {
		if (active === this.scrollbarActive) return;
		this.scrollbarActive = active;
		this.markScrollbarActivity();
		this.requestRenderCallback?.();
	}

	scrollTo(scrollTop: number, options: ScrollViewScrollToOptions = {}): void {
		const requested = Number.isFinite(scrollTop) ? Math.trunc(scrollTop) : this.currentScrollTop;
		const maxScrollTop = Math.max(0, this.contentHeight - this.currentViewportHeight);
		const next = Math.max(0, Math.min(maxScrollTop, requested));
		const suppress = options.disableFollow === true && next === maxScrollTop;
		const following = !suppress && this.followEnd && next === maxScrollTop;
		const virtualNode = getLayoutNode(this.child);
		if (virtualNode?.type === "virtual") virtualNode.state.setViewport(this.currentViewportHeight, next, following);
		if (next === this.currentScrollTop && following === this.followingEnd && suppress === this.followSuppressedAtEnd)
			return;
		const moved = next !== this.currentScrollTop;
		this.currentScrollTop = next;
		this.stateVirtualPosition(next, following);
		this.followingEnd = following;
		this.followSuppressedAtEnd = suppress;
		if (moved) this.markScrollbarActivity();
		this.requestRenderCallback?.();
	}

	scrollBy(lines: number): number {
		const requested = Number.isFinite(lines) ? Math.trunc(lines) : 0;
		if (requested === 0) return 0;
		const maxScrollTop = Math.max(0, this.contentHeight - this.currentViewportHeight);
		const virtualNode = getLayoutNode(this.child);
		const start = this.followingEnd
			? maxScrollTop
			: virtualNode?.type === "virtual"
				? virtualNode.state.getScrollOffset()
				: this.currentScrollTop;
		const next = Math.max(0, Math.min(maxScrollTop, start + requested));
		const moved = next - start;
		const wasFollowing = this.followingEnd;
		this.currentScrollTop = next;
		const positionNode = getLayoutNode(this.child);
		if (positionNode?.type === "virtual") positionNode.state.setScrollTop(next);
		this.followingEnd = this.followEnd && next === maxScrollTop;
		this.followSuppressedAtEnd = false;
		if (moved !== 0) this.markScrollbarActivity();
		if (moved !== 0 || this.followingEnd !== wasFollowing) this.requestRenderCallback?.();
		return requested - moved;
	}

	scrollToStart(): void {
		const changed =
			this.currentScrollTop !== 0 ||
			this.followingEnd !== (this.followEnd && this.contentHeight <= this.currentViewportHeight);
		this.currentScrollTop = 0;
		const virtualNode = getLayoutNode(this.child);
		if (virtualNode?.type === "virtual") virtualNode.state.setScrollTop(0);
		this.followingEnd = this.followEnd && this.contentHeight <= this.currentViewportHeight;
		this.followSuppressedAtEnd = false;
		if (changed) {
			this.markScrollbarActivity();
			this.requestRenderCallback?.();
		}
	}

	scrollToEnd(): void {
		const next = Math.max(0, this.contentHeight - this.currentViewportHeight);
		const changed = this.currentScrollTop !== next || this.followingEnd !== this.followEnd;
		this.currentScrollTop = next;
		const virtualNode = getLayoutNode(this.child);
		if (virtualNode?.type === "virtual") virtualNode.state.setScrollTop(next);
		this.followingEnd = this.followEnd;
		this.followSuppressedAtEnd = false;
		if (changed) {
			this.markScrollbarActivity();
			this.requestRenderCallback?.();
		}
	}

	registerAnchor(component: Component, key: string): void {
		if (!key) throw new Error("ScrollView anchor key must not be empty");
		if (!(this.child instanceof ScrollAnchorContainer))
			throw new Error("ScrollView anchor registration requires a ScrollAnchorContainer child");
		this.child.registerAnchor(component, key);
	}

	getAnchorKey(component: Component): string | undefined {
		return this.child instanceof ScrollAnchorContainer ? this.child.getAnchorKey(component) : undefined;
	}

	preserveAnchor(anchor: ScrollViewAnchor): void {
		this.pendingAnchor = { key: anchor.key, offset: Math.floor(anchor.offset) };
	}

	unregisterAnchor(component: Component): void {
		if (this.child instanceof ScrollAnchorContainer) this.child.unregisterAnchor(component);
	}

	preserveVisualAnchor(): ScrollViewAnchor | undefined {
		const top = this.currentScrollTop;
		const bottom = top + this.currentViewportHeight;
		const index = this.contentGeometry.findIndex(
			(item) => item.key !== undefined && item.height > 0 && item.top + item.height > top && item.top < bottom,
		);
		const item = index < 0 ? undefined : this.contentGeometry[index];
		if (!item?.key) return undefined;
		const anchor = { key: item.key, offset: item.top - top };
		const neighbors = [...this.contentGeometry.slice(index + 1), ...this.contentGeometry.slice(0, index).reverse()];
		const neighbor = neighbors.find((candidate) => candidate.key !== undefined && candidate.height > 0);
		this.fallbackAnchor = neighbor?.key ? { key: neighbor.key, offset: neighbor.top - top } : undefined;
		this.pendingAnchor = anchor;
		return anchor;
	}

	updateLayout(
		contentHeight: number,
		viewportHeight: number,
		requestRender: () => void,
		geometry: readonly ScrollLayoutGeometry[] = [],
	): void {
		this.contentHeight = Math.max(0, Math.floor(contentHeight));
		this.currentViewportHeight = Math.max(0, Math.floor(viewportHeight));
		this.requestRenderCallback = requestRender;
		this.contentGeometry = [...geometry];
		const virtualNode = getLayoutNode(this.child);
		if (virtualNode?.type === "virtual") {
			this.updateVirtualLayout(this.contentHeight, this.currentViewportHeight, requestRender);
			return;
		}
		const maxScrollTop = Math.max(0, this.contentHeight - this.currentViewportHeight);
		if (this.pendingAnchor) {
			const anchor = this.pendingAnchor;
			const target = geometry.find((item) => item.key === anchor.key);
			const fallback = this.fallbackAnchor
				? geometry.find((item) => item.key === this.fallbackAnchor?.key)
				: undefined;
			const selected = target ?? fallback;
			if (selected) {
				const offset = target ? anchor.offset : this.fallbackAnchor!.offset;
				this.currentScrollTop = Math.max(0, Math.min(maxScrollTop, Math.floor(selected.top) - offset));
				this.followingEnd = false;
				this.followSuppressedAtEnd = false;
			} else if (this.followingEnd) this.currentScrollTop = maxScrollTop;
			else this.currentScrollTop = Math.max(0, Math.min(this.currentScrollTop, maxScrollTop));
			this.pendingAnchor = undefined;
			this.fallbackAnchor = undefined;
		} else if (this.followingEnd) this.currentScrollTop = maxScrollTop;
		else this.currentScrollTop = Math.max(0, Math.min(this.currentScrollTop, maxScrollTop));
		if (this.currentScrollTop < maxScrollTop) this.followSuppressedAtEnd = false;
		if (this.followEnd && this.currentScrollTop === maxScrollTop && !this.followSuppressedAtEnd)
			this.followingEnd = true;
		if (this.contentHeight <= this.currentViewportHeight) this.hideTransientScrollbar();
	}

	override addChild(_component: Component): void {
		throw new Error("ScrollView has exactly one child");
	}
	override removeChild(_component: Component): void {
		throw new Error("ScrollView child cannot be removed");
	}
	override clear(): void {
		throw new Error("ScrollView child cannot be cleared");
	}
	override render(width: number): string[] {
		const node = getLayoutNode(this.child);
		if (node?.type === "virtual") return [];
		const contentWidth = this.getContentWidth(width);
		const lines = this.child.render(contentWidth);
		return contentWidth === width ? lines : lines.map((line) => `${line} `);
	}

	[LAYOUT_NODE](): ScrollLayoutNode {
		return { type: "scroll", component: this.child, state: this };
	}
}
