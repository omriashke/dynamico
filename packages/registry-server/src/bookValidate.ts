import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  type BookPreviewConfig,
  type PropsSchema,
  validateBookPreviewsForComponent,
} from "@omriashke/dynamico-core";

const BOOK_CONFIG_NAMES = ["book.config.json", "storybook.config.json"] as const;

export function readBookPreviewConfig(sourceDir: string): BookPreviewConfig | undefined {
  for (const name of BOOK_CONFIG_NAMES) {
    const filePath = join(sourceDir, name);
    if (!existsSync(filePath)) continue;
    try {
      return JSON.parse(readFileSync(filePath, "utf8")) as BookPreviewConfig;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function isBookConfigPath(relPath: string): boolean {
  const base = relPath.split(/[/\\]/).pop() ?? relPath;
  return (BOOK_CONFIG_NAMES as readonly string[]).includes(base);
}

export function validateComponentBookPreviews(
  componentName: string,
  propsSchema: PropsSchema | undefined,
  sourceDir: string,
): { ok: true } | { ok: false; message: string } {
  if (!propsSchema || Object.keys(propsSchema).length === 0) {
    return { ok: true };
  }

  const bookConfig = readBookPreviewConfig(sourceDir);
  if (!bookConfig) {
    return { ok: true };
  }

  const result = validateBookPreviewsForComponent(propsSchema, bookConfig, componentName);
  if (result.ok) {
    return { ok: true };
  }

  return {
    ok: false,
    message: `book.config.json preview props invalid for '${componentName}': ${result.errors.join("; ")}`,
  };
}
