import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type PropsSchema,
  validateBookPreviewsForComponent,
  type BookPreviewConfig,
} from "@omriashke/dynamico-core";

const BOOK_CONFIG_NAMES = ["book.config.json", "storybook.config.json"] as const;

export type BookConfigFilename = (typeof BOOK_CONFIG_NAMES)[number];

export interface BookConfigFile {
  filename: BookConfigFilename;
  source: string;
}

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

async function readBookConfig(dir: string): Promise<BookPreviewConfig | undefined> {
  for (const name of BOOK_CONFIG_NAMES) {
    const filePath = join(dir, name);
    if (!existsSync(filePath)) continue;
    return JSON.parse(await readFile(filePath, "utf8")) as BookPreviewConfig;
  }
  return undefined;
}

/** Raw book catalog file to ship with `dynamico push --dir`. */
export async function readBookConfigFile(dir: string): Promise<BookConfigFile | undefined> {
  for (const filename of BOOK_CONFIG_NAMES) {
    const filePath = join(dir, filename);
    if (!existsSync(filePath)) continue;
    const source = await readFile(filePath, "utf8");
    JSON.parse(source);
    return { filename, source };
  }
  return undefined;
}

export interface BookConfigValidationIssue {
  component: string;
  errors: string[];
}

/**
 * Validate book.config.json previews against each component's propsSchema.
 * Runs locally before push so broken catalog entries fail fast.
 */
export async function validateBookConfigAtDir(
  dir: string,
  manifest: Record<string, { path: string }>,
): Promise<BookConfigValidationIssue[]> {
  const bookConfig = await readBookConfig(dir);
  if (!bookConfig) return [];

  const issues: BookConfigValidationIssue[] = [];

  for (const [name, entry] of Object.entries(manifest)) {
    const sourcePath = join(dir, entry.path);
    if (!existsSync(sourcePath)) continue;

    let source: string;
    try {
      source = await readFile(sourcePath, "utf8");
    } catch {
      continue;
    }

    const schema = extractPropsSchema(source);
    if (!schema || Object.keys(schema).length === 0) continue;

    const result = validateBookPreviewsForComponent(schema, bookConfig, name);
    if (!result.ok) {
      issues.push({ component: name, errors: result.errors });
    }
  }

  return issues;
}
