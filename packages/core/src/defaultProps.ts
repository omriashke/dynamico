import type { PropsSchema } from "./types.js";

const DEFAULTS: Record<string, () => unknown> = {
  string: () => "",
  number: () => 0,
  boolean: () => false,
  object: () => ({}),
  array: () => [],
  function: () => () => undefined,
  any: () => undefined,
};

/** Minimal props bag for automatic push-time render smoke tests. */
export function generateDefaultProps(schema: PropsSchema | undefined): Record<string, unknown> {
  if (!schema) return {};
  const props: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema)) {
    const factory = DEFAULTS[field.type] ?? DEFAULTS.any!;
    props[key] = factory();
  }
  return props;
}
