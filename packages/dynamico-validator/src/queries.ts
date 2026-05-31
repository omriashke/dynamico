import type { ReactTestInstance } from "react-test-renderer";

/**
 * Find the first node whose direct text content matches `matcher`. Walks the
 * tree and looks for Text nodes whose children stringify to the matcher.
 *
 * Mirrors the spirit of testing-library's getByText without pulling the
 * whole library in.
 */
export function findByText(root: ReactTestInstance, matcher: string | RegExp): ReactTestInstance {
  const node = queryByText(root, matcher);
  if (!node) {
    throw new Error(
      `findByText(): no node found matching ${matcher instanceof RegExp ? matcher.toString() : JSON.stringify(matcher)}`,
    );
  }
  return node;
}

export function queryByText(root: ReactTestInstance, matcher: string | RegExp): ReactTestInstance | null {
  const matches = (haystack: string): boolean =>
    typeof matcher === "string" ? haystack === matcher : matcher.test(haystack);

  const visit = (node: ReactTestInstance): ReactTestInstance | null => {
    const typeName = typeof node.type === "string" ? node.type : (node.type as { displayName?: string }).displayName ?? "";
    if (typeName === "Text") {
      const direct = textOf(node.props?.children);
      if (matches(direct)) return node;
    }
    for (const child of node.children ?? []) {
      if (typeof child === "string") {
        if (typeName === "Text" && matches(child)) return node;
        continue;
      }
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };

  return visit(root);
}

/**
 * Find all rendered nodes whose displayName/type matches the given name.
 * E.g. findAllByType(root, 'Text') returns every Text node.
 */
export function findAllByType(root: ReactTestInstance, typeName: string): ReactTestInstance[] {
  const out: ReactTestInstance[] = [];
  const visit = (node: ReactTestInstance) => {
    const t = typeof node.type === "string" ? node.type : (node.type as { displayName?: string }).displayName ?? "";
    if (t === typeName) out.push(node);
    for (const child of node.children ?? []) {
      if (typeof child !== "string") visit(child);
    }
  };
  visit(root);
  return out;
}

function textOf(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textOf).join("");
  return "";
}
