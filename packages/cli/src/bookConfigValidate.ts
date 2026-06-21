import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type PropsSchema,
  validateBookPreviewsForComponent,
  type BookPreviewConfig,
  extractPropsSchema,
} from "@omriashke/dynamico-core";
import {
  readBookPreviewConfigAsync,
  readBookConfigFileAsync,
  type BookConfigFilename,
  type BookConfigFile,
} from "@omriashke/dynamico-core/node";

export type { BookConfigFilename, BookConfigFile };

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
  const bookConfig = await readBookPreviewConfigAsync(dir);
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

export { readBookConfigFileAsync, readBookPreviewConfigAsync, extractPropsSchema };
