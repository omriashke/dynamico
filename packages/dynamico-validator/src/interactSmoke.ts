import TestRenderer from "react-test-renderer";
import type { ReactTestInstance } from "react-test-renderer";

const MAX_INTERACTIONS = 64;

function nodeType(node: ReactTestInstance): string {
  if (typeof node.type === "string") return node.type;
  return (node.type as { displayName?: string }).displayName ?? "";
}

function walk(node: ReactTestInstance, visit: (n: ReactTestInstance) => void): void {
  visit(node);
  for (const child of node.children ?? []) {
    if (typeof child !== "string") walk(child, visit);
  }
}

/**
 * Press every interactive node in the tree. Catches runtime errors that only
 * appear after user interaction (undefined refs in handlers, bad hook data, etc.).
 */
export function interactSmoke(root: ReactTestInstance): void {
  const targets: ReactTestInstance[] = [];
  walk(root, (node) => {
    const props = node.props ?? {};
    if (typeof props.onPress === "function" || typeof props.onValueChange === "function") {
      targets.push(node);
    }
  });

  let count = 0;
  for (const node of targets) {
    if (count >= MAX_INTERACTIONS) break;
    const props = node.props ?? {};
    try {
      TestRenderer.act(() => {
        if (typeof props.onPress === "function") {
          props.onPress({});
          count++;
        }
        if (typeof props.onValueChange === "function") {
          props.onValueChange(!props.value);
          count++;
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(message);
    }
  }
}
