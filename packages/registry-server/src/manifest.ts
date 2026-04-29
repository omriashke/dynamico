import { readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Shape of `dynamico.config.json` on disk. Kept deliberately small; extend
 * with additional metadata (tags, author, etc.) in a future manifest
 * `version`.
 */
export interface ManifestFile {
  version: 1;
  components: Record<string, ManifestEntry>;
}

export interface ManifestEntry {
  /** File path relative to the source dir. Usually `${name}.tsx`. */
  path: string;
  /** Free-form description. Used for search. "" if never set. */
  description: string;
}

/** Current manifest filename. */
export const MANIFEST_NAME = "dynamico.config.json";

/**
 * In-memory representation of the manifest, with read-through + atomic write.
 *
 * The on-disk file is updated whenever the in-memory state changes, and the
 * watcher's reconciliation pass keeps the two aligned when `.tsx` files come
 * and go outside of the CLI.
 */
export class Manifest {
  private data: ManifestFile;
  private path: string;

  private constructor(path: string, data: ManifestFile) {
    this.path = path;
    this.data = data;
  }

  static async load(dir: string): Promise<Manifest> {
    const path = join(dir, MANIFEST_NAME);
    if (!existsSync(path)) {
      const empty: ManifestFile = { version: 1, components: {} };
      await writeFile(path, JSON.stringify(empty, null, 2) + "\n", "utf8");
      return new Manifest(path, empty);
    }
    const raw = await readFile(path, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `${MANIFEST_NAME} at ${path} is not valid JSON: ${(err as Error).message}`,
      );
    }
    const data = normalize(parsed);
    return new Manifest(path, data);
  }

  get(name: string): ManifestEntry | undefined {
    return this.data.components[name];
  }

  list(): Array<{ name: string } & ManifestEntry> {
    return Object.entries(this.data.components).map(([name, entry]) => ({
      name,
      ...entry,
    }));
  }

  /**
   * Upsert an entry. If the component already exists, only the fields provided
   * in `patch` are replaced — this lets `push` update `description` without
   * clobbering `path`, and vice versa.
   */
  async upsert(name: string, patch: Partial<ManifestEntry>): Promise<ManifestEntry> {
    const prev = this.data.components[name];
    const next: ManifestEntry = {
      path: patch.path ?? prev?.path ?? `${name}.tsx`,
      description: patch.description ?? prev?.description ?? "",
    };
    this.data.components[name] = next;
    await this.flush();
    return next;
  }

  async remove(name: string): Promise<boolean> {
    if (!(name in this.data.components)) return false;
    delete this.data.components[name];
    await this.flush();
    return true;
  }

  /**
   * Overwrite the manifest with a new set of entries. Caller is responsible
   * for having validated the payload — this is a blind write after
   * normalisation. Returns names added/removed/changed relative to the
   * previous state, so the caller can reconcile filesystem + store.
   */
  async replaceAll(next: ManifestFile): Promise<{
    added: string[];
    removed: string[];
    changed: string[];
  }> {
    const normalized = normalize(next);
    const prev = this.data.components;
    const nextEntries = normalized.components;
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];
    for (const name of Object.keys(nextEntries)) {
      if (!(name in prev)) added.push(name);
      else if (
        prev[name]!.path !== nextEntries[name]!.path ||
        prev[name]!.description !== nextEntries[name]!.description
      ) {
        changed.push(name);
      }
    }
    for (const name of Object.keys(prev)) {
      if (!(name in nextEntries)) removed.push(name);
    }
    this.data = normalized;
    await this.flush();
    return { added, removed, changed };
  }

  /** Snapshot for serving GET /config. */
  snapshot(): ManifestFile {
    return JSON.parse(JSON.stringify(this.data));
  }

  /**
   * Reconcile manifest with the actual files seen on disk:
   *   - Any file without a manifest entry gets a blank entry.
   *   - Any manifest entry whose file vanished is removed.
   * Returns a summary for logging.
   */
  async reconcile(filesOnDisk: Map<string, string>): Promise<{
    added: string[];
    removed: string[];
  }> {
    const added: string[] = [];
    const removed: string[] = [];
    for (const [name, relPath] of filesOnDisk) {
      if (!this.data.components[name]) {
        this.data.components[name] = { path: relPath, description: "" };
        added.push(name);
      } else if (this.data.components[name]!.path !== relPath) {
        this.data.components[name]!.path = relPath;
      }
    }
    for (const name of Object.keys(this.data.components)) {
      if (!filesOnDisk.has(name)) {
        delete this.data.components[name];
        removed.push(name);
      }
    }
    if (added.length || removed.length) await this.flush();
    return { added, removed };
  }

  private async flush(): Promise<void> {
    const tmp = this.path + ".tmp";
    await writeFile(tmp, JSON.stringify(this.data, null, 2) + "\n", "utf8");
    // Rename is atomic on POSIX; on Windows this is best-effort.
    await rename(tmp, this.path);
  }
}

function normalize(input: unknown): ManifestFile {
  if (typeof input !== "object" || input === null) {
    return { version: 1, components: {} };
  }
  const obj = input as Partial<ManifestFile>;
  const out: ManifestFile = { version: 1, components: {} };
  if (obj.components && typeof obj.components === "object") {
    for (const [name, entry] of Object.entries(obj.components)) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Partial<ManifestEntry>;
      out.components[name] = {
        path: typeof e.path === "string" ? e.path : `${name}.tsx`,
        description: typeof e.description === "string" ? e.description : "",
      };
    }
  }
  return out;
}
