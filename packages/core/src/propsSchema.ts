import type { PropsSchema } from "./types.js";

export interface PropsValidationResult {
  ok: boolean;
  errors: string[];
}

const TYPE_CHECKS: Record<string, (v: unknown) => boolean> = {
  string: (v) => typeof v === "string",
  number: (v) => typeof v === "number" && !Number.isNaN(v),
  boolean: (v) => typeof v === "boolean",
  object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  array: (v) => Array.isArray(v),
  any: () => true,
};

export function validateProps(
  schema: PropsSchema | undefined,
  props: Record<string, unknown>,
): PropsValidationResult {
  if (!schema) return { ok: true, errors: [] };
  const errors: string[] = [];
  for (const [key, field] of Object.entries(schema)) {
    const present = Object.prototype.hasOwnProperty.call(props, key);
    if (!present) {
      if (field.required) errors.push(`missing required prop '${key}' (${field.type})`);
      continue;
    }
    const checker = TYPE_CHECKS[field.type] ?? TYPE_CHECKS.any!;
    if (!checker(props[key])) {
      errors.push(
        `prop '${key}' expected ${field.type}, got ${describe(props[key])}`,
      );
    }
  }
  return { ok: errors.length === 0, errors };
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
