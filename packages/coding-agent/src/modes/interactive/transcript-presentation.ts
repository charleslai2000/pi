import type { Component } from "@earendil-works/pi-tui";

export interface TranscriptPresentationItem {
	readonly key: string;
	readonly kind: "message" | "tool" | "custom" | "notice";
	readonly render: () => Component;
	readonly searchText: () => string;
}

/** Ordered logical presentation descriptors; components are only a bounded cache. */
export class TranscriptPresentation {
	private items: TranscriptPresentationItem[] = [];
	private readonly indexByKey = new Map<string, number>();
	private readonly componentCache = new Map<string, Component>();
	private readonly liveKeys = new Set<string>();
	private readonly listeners = new Set<() => void>();

	get count(): number {
		return this.items.length;
	}
	getItem(index: number): TranscriptPresentationItem | undefined {
		return this.items[index];
	}
	getIndex(key: string): number | undefined {
		return this.indexByKey.get(key);
	}
	getComponent(key: string): Component | undefined {
		return this.componentCache.get(key);
	}
	getMaterializedCount(): number {
		return this.componentCache.size;
	}
	getMaterializedComponents(): readonly Component[] {
		return [...this.componentCache.values()];
	}
	setRange(start: number, end: number): void {
		this.retainRange(start, end);
	}
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	reset(items: readonly TranscriptPresentationItem[]): void {
		this.items = [...items];
		this.indexByKey.clear();
		for (let i = 0; i < items.length; i++) this.indexByKey.set(items[i]!.key, i);
		this.componentCache.clear();
		this.liveKeys.clear();
		this.emit();
	}
	append(item: TranscriptPresentationItem, live = false): void {
		this.indexByKey.set(item.key, this.items.length);
		this.items.push(item);
		if (live) this.liveKeys.add(item.key);
		this.emit();
	}
	clearLive(): void {
		this.liveKeys.clear();
	}
	insertBefore(item: TranscriptPresentationItem, beforeKey: string): void {
		const index = this.indexByKey.get(beforeKey);
		if (index === undefined) {
			this.append(item);
			return;
		}
		this.items.splice(index, 0, item);
		for (let i = index; i < this.items.length; i++) this.indexByKey.set(this.items[i]!.key, i);
		this.emit();
	}
	setLive(key: string, live: boolean): void {
		if (live) this.liveKeys.add(key);
		else this.liveKeys.delete(key);
	}
	touchItem(key: string): void {
		if (!this.indexByKey.has(key)) return;
		this.emit();
	}
	updateItem(key: string, update: (item: TranscriptPresentationItem) => TranscriptPresentationItem): void {
		const index = this.indexByKey.get(key);
		if (index === undefined) return;
		this.items[index] = update(this.items[index]!);
		this.componentCache.delete(key);
		this.emit();
	}
	materialize(key: string): Component | undefined {
		let component = this.componentCache.get(key);
		if (component) return component;
		const item = this.items[this.indexByKey.get(key) ?? -1];
		if (!item) return undefined;
		component = item.render();
		this.componentCache.set(key, component);
		return component;
	}
	retainRange(start: number, end: number): void {
		for (const key of this.componentCache.keys()) {
			const index = this.indexByKey.get(key);
			if (index !== undefined && (index < start || index >= end) && !this.liveKeys.has(key))
				this.componentCache.delete(key);
		}
	}
	private emit(): void {
		for (const listener of this.listeners) listener();
	}
}
