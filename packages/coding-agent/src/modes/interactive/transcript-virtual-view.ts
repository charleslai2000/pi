import { VirtualList } from "@earendil-works/pi-tui";
import type { TranscriptPresentation } from "./transcript-presentation.ts";

export class TranscriptVirtualView extends VirtualList {
	private readonly presentation: TranscriptPresentation;
	constructor(presentation: TranscriptPresentation) {
		super(
			{
				getCount: () => presentation.count,
				getKey: (index) => presentation.getItem(index)!.key,
				materialize: (index) => presentation.materialize(presentation.getItem(index)!.key)!,
				findMatchingKey: (query, fromIndex, direction) => {
					const needle = query.toLocaleLowerCase();
					for (let i = fromIndex + direction; i >= 0 && i < presentation.count; i += direction) {
						const item = presentation.getItem(i)!;
						if (item.searchText().toLocaleLowerCase().includes(needle)) return item.key;
					}
					return undefined;
				},
			},
			{ estimatedItemHeight: 4, overscan: 6, followEnd: true },
			{ onRangeChange: (range) => presentation.retainRange(range.start, range.end) },
		);
		this.presentation = presentation;
		this.presentation.setRange(0, 0);
		this.applyMutation({ type: "replace" });
	}
}
