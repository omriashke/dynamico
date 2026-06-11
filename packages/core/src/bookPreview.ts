import { validateProps } from "./propsSchema.js";
import type { PropsSchema } from "./types.js";

export type BookPreviewJson = Record<string, unknown>;

export interface BookPreviewConfig {
  fixtures?: Record<string, BookPreviewJson>;
  entries?: BookPreviewEntry[];
  /** Legacy alias — normalized to `entries`. */
  stories?: BookPreviewEntry[];
}

export interface BookPreviewEntry {
  id: string;
  kind?: "info";
  blocks?: BookPreviewBlock[];
}

export type BookPreviewBlock =
  | { type: "component"; component: string; props?: BookPreviewJson }
  | { type: "stack"; items: BookPreviewBlockItem[] }
  | { type: "row"; items: BookPreviewBlockItem[] }
  | {
      type: "variantGrid";
      component: string;
      variants: Array<{ id: string; props?: BookPreviewJson }>;
    };

export type BookPreviewBlockItem = { component: string; props?: BookPreviewJson };

export interface BookPreviewPropSet {
  entryId: string;
  location: string;
  props: Record<string, unknown>;
}

export interface BookPreviewValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Merge `$fixture` references into concrete prop objects.
 *
 * Supports both:
 *   - top-level: `{ "$fixture": "articleCard", "variant": "default" }`
 *   - per-field: `{ "data": { "$fixture": "articleCard" } }`
 */
export function resolveBookFixtures(
  props: BookPreviewJson | undefined,
  fixtures: Record<string, BookPreviewJson>,
): BookPreviewJson {
  if (!props) return {};

  let merged: BookPreviewJson = { ...props };
  if ("$fixture" in merged && typeof merged.$fixture === "string") {
    const fixtureKey = merged.$fixture;
    const base = fixtures[fixtureKey] ?? {};
    const { $fixture: _omit, ...rest } = merged;
    merged = { ...base, ...rest };
  }

  const out: BookPreviewJson = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value && typeof value === "object" && !Array.isArray(value) && "$fixture" in value) {
      const fixtureKey = (value as BookPreviewJson).$fixture as string;
      const base = fixtures[fixtureKey] ?? {};
      const { $fixture: _omit, ...rest } = value as BookPreviewJson;
      out[key] = { ...base, ...rest };
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Resolve book-config prop DSL to runtime values for schema validation.
 * React element placeholders (`$component`) become null; callbacks (`$fn`) become no-ops.
 */
export function resolveBookPropValues(
  props: BookPreviewJson,
  fixtures: Record<string, BookPreviewJson>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    out[key] = resolveBookPropValue(value, fixtures);
  }
  return out;
}

function resolveBookPropValue(value: unknown, fixtures: Record<string, BookPreviewJson>): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => resolveBookPropValue(item, fixtures));
  }
  const obj = value as BookPreviewJson;
  if ("$fn" in obj && obj.$fn === "noop") {
    return () => undefined;
  }
  if ("$component" in obj && typeof obj.$component === "string") {
    return null;
  }
  if ("$fixture" in obj) {
    return resolveBookPropValues(resolveBookFixtures(obj, fixtures), fixtures);
  }
  const nested: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(obj)) {
    nested[key] = resolveBookPropValue(nestedValue, fixtures);
  }
  return nested;
}

export function normalizeBookPreviewConfig(raw: BookPreviewConfig): BookPreviewConfig {
  const entries = raw.entries ?? raw.stories ?? [];
  return { ...raw, entries };
}

/** Collect every resolved prop bag used to preview `componentName` in book.config.json. */
export function collectBookPreviewPropSets(
  config: BookPreviewConfig,
  componentName: string,
): BookPreviewPropSet[] {
  const normalized = normalizeBookPreviewConfig(config);
  const fixtures = normalized.fixtures ?? {};
  const out: BookPreviewPropSet[] = [];

  for (const entry of normalized.entries ?? []) {
    if (entry.kind === "info") continue;
    for (const block of entry.blocks ?? []) {
      collectFromBlock(block, componentName, fixtures, entry.id, out);
    }
  }
  return out;
}

function collectFromBlock(
  block: BookPreviewBlock,
  componentName: string,
  fixtures: Record<string, BookPreviewJson>,
  entryId: string,
  out: BookPreviewPropSet[],
): void {
  switch (block.type) {
    case "component":
      collectFromComponentUse(block.component, block.props, componentName, fixtures, entryId, "preview", out);
      return;
    case "stack":
    case "row":
      for (const item of block.items) {
        collectFromComponentUse(item.component, item.props, componentName, fixtures, entryId, "preview", out);
      }
      return;
    case "variantGrid":
      for (const variant of block.variants) {
        collectFromComponentUse(
          block.component,
          variant.props,
          componentName,
          fixtures,
          entryId,
          `variant '${variant.id}'`,
          out,
        );
      }
      return;
    default:
      return;
  }
}

function collectFromComponentUse(
  usedComponent: string,
  props: BookPreviewJson | undefined,
  componentName: string,
  fixtures: Record<string, BookPreviewJson>,
  entryId: string,
  location: string,
  out: BookPreviewPropSet[],
): void {
  if (usedComponent === componentName) {
    out.push({
      entryId,
      location,
      props: resolveBookPropValues(resolveBookFixtures(props, fixtures), fixtures),
    });
  }
  collectNestedComponentProps(props, componentName, fixtures, entryId, out);
}

function collectNestedComponentProps(
  props: BookPreviewJson | undefined,
  componentName: string,
  fixtures: Record<string, BookPreviewJson>,
  entryId: string,
  out: BookPreviewPropSet[],
): void {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const obj = value as BookPreviewJson;
    if ("$component" in obj && obj.$component === componentName) {
      const nestedProps = (obj.props as BookPreviewJson | undefined) ?? {};
      out.push({
        entryId,
        location: `prop '${key}'`,
        props: resolveBookPropValues(resolveBookFixtures(nestedProps, fixtures), fixtures),
      });
    }
    collectNestedComponentProps(obj, componentName, fixtures, entryId, out);
  }
}

/** Validate every book.config.json preview of a component against its propsSchema. */
export function validateBookPreviewsForComponent(
  schema: PropsSchema,
  config: BookPreviewConfig,
  componentName: string,
): BookPreviewValidationResult {
  const sets = collectBookPreviewPropSets(config, componentName);
  if (sets.length === 0) {
    return { ok: true, errors: [] };
  }

  const errors: string[] = [];
  for (const set of sets) {
    const result = validateProps(schema, set.props);
    if (!result.ok) {
      errors.push(
        `book entry '${set.entryId}' (${set.location}): ${result.errors.join("; ")}`,
      );
    }
  }
  return { ok: errors.length === 0, errors };
}
