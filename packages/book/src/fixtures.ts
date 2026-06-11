import type { JsonObject } from './types.js';

/** Merge `$fixture` references into concrete prop objects. */
export function resolveBookFixtures(
  props: JsonObject | undefined,
  fixtures: Record<string, JsonObject>,
): JsonObject {
  if (!props) return {};

  let merged: JsonObject = { ...props };
  if ('$fixture' in merged && typeof merged.$fixture === 'string') {
    const fixtureKey = merged.$fixture as string;
    const base = fixtures[fixtureKey] ?? {};
    const { $fixture: _omit, ...rest } = merged;
    merged = { ...base, ...rest };
  }

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(merged)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && '$fixture' in value) {
      const fixtureKey = (value as JsonObject).$fixture as string;
      const base = fixtures[fixtureKey] ?? {};
      const { $fixture: _omit, ...rest } = value as JsonObject;
      out[key] = { ...base, ...rest };
    } else {
      out[key] = value;
    }
  }
  return out;
}
