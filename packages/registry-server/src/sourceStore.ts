import chokidar, { type FSWatcher } from "chokidar";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import type { CompiledModule } from "@dynamico/core";
import { compile } from "./compile.js";
import { Manifest, MANIFEST_NAME, type ManifestFile } from "./manifest.js";
import type { Store } from "./store.js";

/**
 * File extensions recognized as dynamic-component source. `.tsx`/`.jsx` are
 * the common case (React components); `.ts`/`.js` are allowed for
 * logic-only helpers (hooks, utilities) that a component might import via
 * the cross-component lazy proxy.
 */
export const SOURCE_EXTS = [".tsx", ".jsx", ".ts", ".js"] as const;
type SourceExt = (typeof SOURCE_EXTS)[number];

const IGNORED_DIRS = /(?:^|[\\/])(node_modules|\.git|dist|\.next|\.expo)(?:[\\/]|$)/;

export interface SourceStoreOptions {
  /** Absolute path to the directory holding source files + dynamico.config.json. */
  dir: string;
  /** Compiled-output store to fill. Same instance the HTTP routes read from. */
  store: Store;
  /** Optional logger hook so the server can forward messages to Fastify's logger. */
  log?: (msg: string) => void;
  /**
   * When a `push` calls `write()`, we want the HTTP response to include the
   * resulting CompiledModule. The watcher is async, so `write()` uses this
   * timeout to await the watcher's compile result for that component.
   * Default: 3000 ms. Set lower if your host has very fast disk I/O.
   */
  writeSettleMs?: number;
}

/**
 * Owns the filesystem. On start, walks the configured directory recursively
 * for `.tsx` / `.jsx` files, compiles each, and fills the shared Store. Then
 * uses chokidar to react to changes so subsequent edits — from the CLI, an
 * editor, a mounted volume, a git pull — get picked up automatically.
 *
 * Layout model (Option A): component *names* are flat — the registry key is
 * the basename of the source file, irrespective of which subdirectory it
 * lives in. Subfolders are an authoring convenience. Two files with the
 * same basename in different folders are a startup error.
 *
 * Maintains dynamico.config.json: every push updates the manifest;
 * out-of-band additions/removals are reconciled on scan and via watcher
 * events.
 */
export class FilesystemSourceStore {
  private dir: string;
  private store: Store;
  private manifest!: Manifest;
  private watcher?: FSWatcher;
  private log: (msg: string) => void;
  private writeSettleMs: number;

  constructor(opts: SourceStoreOptions) {
    this.dir = resolve(opts.dir);
    this.store = opts.store;
    this.log = opts.log ?? (() => {});
    this.writeSettleMs = opts.writeSettleMs ?? 3000;
  }

  async start(): Promise<void> {
    if (!existsSync(this.dir)) {
      throw new Error(`DYNAMICO_SOURCE_DIR does not exist: ${this.dir}`);
    }
    this.manifest = await Manifest.load(this.dir);

    const files = await this.scan();
    const reconcile = await this.manifest.reconcile(files);
    if (reconcile.added.length) this.log(`manifest: added ${reconcile.added.join(", ")}`);
    if (reconcile.removed.length) this.log(`manifest: removed ${reconcile.removed.join(", ")}`);

    await Promise.all(
      [...files.entries()].map(([name, rel]) => this.compileAndStore(name, rel)),
    );

    this.watcher = chokidar.watch(this.dir, {
      ignoreInitial: true,
      ignored: (p) => {
        const b = basename(p);
        if (b === MANIFEST_NAME) return true;
        if (b === `${MANIFEST_NAME}.tmp`) return true;
        if (b.startsWith(".")) return true;
        return IGNORED_DIRS.test(p);
      },
    });
    this.watcher.on("add", (p) => this.handleFileChange(p));
    this.watcher.on("change", (p) => this.handleFileChange(p));
    this.watcher.on("unlink", (p) => this.handleFileRemoved(p));
    this.watcher.on("error", (err) => this.log(`watcher error: ${String(err)}`));
    this.log(`watching source dir ${this.dir}`);
  }

  async stop(): Promise<void> {
    await this.watcher?.close();
  }

  /** Read raw source + manifest entry for an agent's `pull --source`. */
  async getSource(name: string): Promise<
    | { name: string; path: string; source: string; description: string; version: string }
    | undefined
  > {
    const entry = this.manifest.get(name);
    if (!entry) return undefined;
    const abs = join(this.dir, entry.path);
    if (!existsSync(abs)) return undefined;
    const source = await readFile(abs, "utf8");
    const current = this.store.get(name);
    return {
      name,
      path: entry.path,
      source,
      description: entry.description,
      version: current?.version ?? "",
    };
  }

  /** Manifest projection for `list` / `search`. */
  listManifest(): Array<{ name: string; description: string; path: string }> {
    return this.manifest.list();
  }

  /**
   * Write source to disk, upsert the manifest entry, and return the compiled
   * artifact once the watcher finishes compiling. If the component already
   * has a manifest entry, writes are directed at the manifest's `path`
   * (preserving any subfolder layout); otherwise falls back to `${name}.tsx`
   * at the root.
   */
  async write(
    name: string,
    source: string,
    description: string | undefined,
  ): Promise<CompiledModule> {
    validateName(name);
    const entry = this.manifest.get(name);
    const relPath = entry?.path ?? `${name}.tsx`;
    ensureAllowedExtension(relPath);
    const abs = join(this.dir, relPath);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, source, "utf8");
    await this.manifest.upsert(name, {
      path: relPath,
      ...(description !== undefined ? { description } : {}),
    });
    return await this.awaitNextCompile(name);
  }

  /** Delete the source file and its manifest entry. */
  async remove(name: string): Promise<boolean> {
    const entry = this.manifest.get(name);
    if (!entry) return false;
    const abs = join(this.dir, entry.path);
    if (existsSync(abs)) {
      try {
        await unlink(abs);
      } catch {
        /* ignore — watcher will still fire unlink if it happened elsewhere */
      }
    }
    await this.manifest.remove(name);
    this.store.remove(name);
    return true;
  }

  /**
   * Update just the metadata for one component (no source re-upload).
   * Returns the updated entry or `undefined` if the component doesn't exist.
   * The underlying source file is untouched and no recompile is triggered.
   */
  async patchMeta(
    name: string,
    patch: { description?: string },
  ): Promise<{ name: string; path: string; description: string }> {
    const entry = this.manifest.get(name);
    if (!entry) {
      throw Object.assign(new Error(`unknown component '${name}'`), { code: "NOT_FOUND" });
    }
    const next = await this.manifest.upsert(name, {
      ...(patch.description !== undefined ? { description: patch.description } : {}),
    });
    return { name, ...next };
  }

  /**
   * Current manifest as a serializable object. Used by `GET /config`.
   */
  snapshotConfig(): ManifestFile {
    return this.manifest.snapshot();
  }

  /**
   * Replace the entire manifest with `next`. Semantics:
   *  - Every entry in `next` must point at an existing file on disk with an
   *    allowed extension (`.tsx`/`.jsx`/`.ts`/`.js`).
   *  - No two entries may share a basename (component names stay flat).
   *  - Entries dropped from the manifest have their source files deleted and
   *    are unloaded from the store (clients receive removal events via the
   *    usual store.remove path).
   *  - Kept/changed entries get recompiled if their path changed.
   *
   * On validation failure, nothing is written.
   */
  async replaceConfig(next: ManifestFile): Promise<{
    added: string[];
    removed: string[];
    changed: string[];
  }> {
    const errors: string[] = [];
    const seenBasenames = new Map<string, string>();
    for (const [name, entry] of Object.entries(next.components ?? {})) {
      if (!entry || typeof entry !== "object" || typeof entry.path !== "string") {
        errors.push(`'${name}': missing path`);
        continue;
      }
      if (!SOURCE_EXTS.includes(extname(entry.path) as SourceExt)) {
        errors.push(`'${name}': path '${entry.path}' must end in ${SOURCE_EXTS.join("/")}`);
      }
      const abs = join(this.dir, entry.path);
      if (!existsSync(abs)) {
        errors.push(`'${name}': file '${entry.path}' does not exist`);
      }
      const base = basename(entry.path, extname(entry.path));
      const other = seenBasenames.get(base);
      if (other && other !== name) {
        errors.push(`basename collision: '${name}' and '${other}' would both register as '${base}'`);
      }
      seenBasenames.set(base, name);
    }
    if (errors.length > 0) {
      throw Object.assign(new Error("manifest validation failed"), {
        code: "INVALID_CONFIG",
        diagnostics: errors,
      });
    }

    const prev = this.manifest.snapshot().components;
    const diff = await this.manifest.replaceAll(next);

    // Removed entries: delete their files; the watcher will also fire unlink
    // and the Store will broadcast a removal, but we do it eagerly so the
    // HTTP response doesn't return before cleanup starts.
    for (const name of diff.removed) {
      const rel = prev[name]?.path;
      if (rel) {
        const abs = join(this.dir, rel);
        try {
          if (existsSync(abs)) await unlink(abs);
        } catch {
          /* best effort */
        }
      }
      this.store.remove(name);
    }

    // For added/changed entries, trigger a recompile from the new path.
    await Promise.all(
      [...diff.added, ...diff.changed].map((name) => {
        const rel = next.components[name]!.path;
        return this.compileAndStore(name, rel);
      }),
    );

    return diff;
  }

  /**
   * Recursive scan of the source dir. Returns Map<name, relPath>. Throws on
   * basename collisions so the operator finds out at startup instead of
   * later, when a file mysteriously masks another.
   */
  private async scan(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const collisions: Record<string, string[]> = {};

    const walk = async (abs: string, rel: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(abs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        if (e.name === MANIFEST_NAME) continue;
        const childAbs = join(abs, e.name);
        const childRel = rel ? `${rel}${sep}${e.name}` : e.name;
        if (e.isDirectory()) {
          if (IGNORED_DIRS.test(childRel)) continue;
          await walk(childAbs, childRel);
          continue;
        }
        if (!e.isFile()) continue;
        const ext = extname(e.name);
        if (!SOURCE_EXTS.includes(ext as SourceExt)) continue;
        const name = basename(e.name, ext);
        if (out.has(name)) {
          (collisions[name] ??= [out.get(name)!]).push(childRel);
        } else {
          out.set(name, childRel);
        }
      }
    };
    await walk(this.dir, "");

    const bad = Object.entries(collisions);
    if (bad.length > 0) {
      const details = bad
        .map(([n, paths]) => `  ${n}: ${paths.join(", ")}`)
        .join("\n");
      throw new Error(
        `duplicate component name(s) detected in ${this.dir}:\n${details}\n` +
          "component names are flat; rename one of the files.",
      );
    }
    return out;
  }

  private async compileAndStore(name: string, relPath: string): Promise<void> {
    const abs = join(this.dir, relPath);
    try {
      const source = await readFile(abs, "utf8");
      const compiled = await compile(name, source, extname(relPath));
      this.store.set(compiled);
      if (compiled.error) {
        this.log(`compile error for ${name}: ${compiled.error.message}`);
      }
    } catch (err) {
      this.log(`failed to read/compile ${relPath}: ${(err as Error).message}`);
    }
  }

  private async handleFileChange(absPath: string): Promise<void> {
    const rel = relative(this.dir, absPath);
    const ext = extname(rel);
    if (!SOURCE_EXTS.includes(ext as SourceExt)) return;
    const name = basename(rel, ext);

    // Collision guard at runtime: if the manifest says this component maps
    // to a different path, don't silently take over. Log and ignore.
    const existing = this.manifest.get(name);
    if (existing && existing.path !== rel) {
      this.log(
        `ignoring ${rel}: component '${name}' is already mapped to ${existing.path}. ` +
          "rename the file or remove the existing entry.",
      );
      return;
    }

    if (!existing) {
      await this.manifest.upsert(name, { path: rel, description: "" });
    }
    await this.compileAndStore(name, rel);
  }

  private async handleFileRemoved(absPath: string): Promise<void> {
    const rel = relative(this.dir, absPath);
    const ext = extname(rel);
    if (!SOURCE_EXTS.includes(ext as SourceExt)) return;
    const name = basename(rel, ext);

    // Only remove if the manifest actually points at this rel path; if a
    // different file happens to share the basename we shouldn't nuke the
    // registration on unrelated churn.
    const entry = this.manifest.get(name);
    if (entry && entry.path !== rel) return;

    await this.manifest.remove(name);
    const removed = this.store.remove(name);
    if (removed) this.log(`unloaded ${name} (file deleted)`);
  }

  /**
   * Wait for the next Store change for `name`, or time out.
   * Returns whatever is currently stored on timeout.
   */
  private awaitNextCompile(name: string): Promise<CompiledModule> {
    return new Promise((resolveP) => {
      const timer = setTimeout(() => {
        off();
        const current = this.store.get(name);
        if (current) {
          resolveP(current);
        } else {
          resolveP({
            name,
            version: "",
            error: {
              kind: "compile",
              message: "compile did not complete within the settle window; check the server logs",
            },
          });
        }
      }, this.writeSettleMs);

      const off = this.store.subscribe((m) => {
        if (m.name !== name) return;
        clearTimeout(timer);
        off();
        resolveP(m);
      });
    });
  }
}

function validateName(name: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
    throw new Error(
      `invalid component name '${name}'. Use letters, digits, underscore, or hyphen; start with a letter.`,
    );
  }
}

function ensureAllowedExtension(relPath: string): void {
  const ext = extname(relPath);
  if (!SOURCE_EXTS.includes(ext as SourceExt)) {
    throw new Error(
      `source path '${relPath}' must end in one of: ${SOURCE_EXTS.join(", ")}`,
    );
  }
}
