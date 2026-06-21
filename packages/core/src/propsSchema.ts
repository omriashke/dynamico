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
  function: (v) => typeof v === "function",
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
  if (typeof v === "function") return "function";
  return typeof v;
}

/** Parse `export const propsSchema = { … }` from component source text. */
export function extractPropsSchema(source: string): PropsSchema | undefined {
  const marker = "export const propsSchema";
  const idx = source.indexOf(marker);
  if (idx < 0) return undefined;

  const after = source.slice(idx + marker.length);
  const eq = after.indexOf("=");
  if (eq < 0) return undefined;

  let rest = after.slice(eq + 1).trimStart();
  if (!rest.startsWith("{")) return undefined;

  let depth = 0;
  let end = 0;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === 0) return undefined;

  try {
    return new Function(`return (${rest.slice(0, end)})`)() as PropsSchema;
  } catch {
    return undefined;
  }
}
