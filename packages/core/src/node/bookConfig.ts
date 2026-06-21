import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BOOK_CONFIG_FILENAMES,
  isBookConfigFilename,
  type BookPreviewConfig,
} from "../bookPreview.js";

export type BookConfigFilename = (typeof BOOK_CONFIG_FILENAMES)[number];

export interface BookConfigFile {
  filename: BookConfigFilename;
  source: string;
}

export function bookConfigPathSync(dir: string): string | null {
  for (const name of BOOK_CONFIG_FILENAMES) {
    const filePath = join(dir, name);
    if (existsSync(filePath)) return filePath;
  }
  return null;
}

export function readBookPreviewConfigSync(dir: string): BookPreviewConfig | undefined {
  const filePath = bookConfigPathSync(dir);
  if (!filePath) return undefined;
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as BookPreviewConfig;
  } catch {
    return undefined;
  }
}

export async function readBookPreviewConfigAsync(dir: string): Promise<BookPreviewConfig | undefined> {
  for (const name of BOOK_CONFIG_FILENAMES) {
    const filePath = join(dir, name);
    if (!existsSync(filePath)) continue;
    try {
      return JSON.parse(await readFile(filePath, "utf8")) as BookPreviewConfig;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Raw book catalog file to ship with `dynamico push --dir`. */
export async function readBookConfigFileAsync(dir: string): Promise<BookConfigFile | undefined> {
  for (const filename of BOOK_CONFIG_FILENAMES) {
    const filePath = join(dir, filename);
    if (!existsSync(filePath)) continue;
    const source = await readFile(filePath, "utf8");
    JSON.parse(source);
    return { filename, source };
  }
  return undefined;
}

export function isBookConfigPath(relPath: string): boolean {
  const base = relPath.split(/[/\\]/).pop() ?? relPath;
  return isBookConfigFilename(base);
}
