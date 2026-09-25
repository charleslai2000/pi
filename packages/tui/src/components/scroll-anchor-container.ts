import { type ContainerLayoutNode, LAYOUT_NODE } from "../layout-node.ts";
import { type Component, Container } from "../tui.ts";

/** Container for variable-height children that may serve as stable ScrollView anchors. */
export class ScrollAnchorContainer extends Container {
	private readonly stableKeys = new WeakMap<Component, string>();

	registerAnchor(component: Component, key: string): void {
		if (!key) throw new Error("Scroll anchor key must not be empty");
		this.stableKeys.set(component, key);
	}

	unregisterAnchor(component: Component): void {
		this.stableKeys.delete(component);
	}

	getAnchorKey(component: Component): string | undefined {
		return this.stableKeys.get(component);
	}

	[LAYOUT_NODE](): ContainerLayoutNode {
		return { type: "container", children: this.children, getAnchorKey: (component) => this.getAnchorKey(component) };
	}
}
