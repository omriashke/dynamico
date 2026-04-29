import chokidar, { type FSWatcher } from "chokidar";
import { readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import type { CompiledModule } from "@dynamico/core";
import { compile } from "./compile.js";
import { Manifest, type ManifestEntry } from "./manifest.js";
import type { Store } from "./store.js";

const SOURCE_EXTS = [".tsx", ".jsx", ".ts", ".js"];

export interface SourceStoreOptions {
  /** Absolute path to the directory holding source files + components.json. */
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
 * Owns the filesystem. On start, scans the configured directory for source
 * files, compiles each, and fills the shared Store. Then uses chokidar to
 * react to changes so subsequent edits (from any source — CLI, editor, a
 * mounted volume, git pull, etc.) get picked up automatically.
 *
 * Also maintains components.json: every push updates the manifest;
 * out-of-band file additions/removals are reconciled on scan.
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

  /**
   * Hydrate from disk and start watching. Safe to await — returns once the
   * initial compile sweep is done so HTTP traffic can start being served.
   */
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
        if (b === "components.json") return true;
        if (b === "components.json.tmp") return true;
        return /(?:^|[\\/])(node_modules|\.git|dist)(?:[\\/]|$)/.test(p);
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
   * artifact once the watcher finishes compiling. Used by POST /upload when
   * a source directory is configured.
   */
  async write(
    name: string,
    source: string,
    description: string | undefined,
  ): Promise<CompiledModule> {
    validateName(name);
    const entry = this.manifest.get(name);
    const relPath = entry?.path ?? `${name}.tsx`;
    const abs = join(this.dir, relPath);
    await writeFile(abs, source, "utf8");
    await this.manifest.upsert(name, {
      path: relPath,
      ...(description !== undefined ? { description } : {}),
    });
    // The chokidar handler will pick this up and compile. We wait for that
    // compile (or for the timeout) so the HTTP response can carry the result.
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
    // Ensure the in-memory store reflects removal even if the watcher event
    // is debounced or missed.
    this.store.remove(name);
    return true;
  }

  /** Scan the source dir; returns Map<name, relPath>. */
  private async scan(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const entries = await readdir(this.dir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (e.name === "components.json") continue;
      if (!SOURCE_EXTS.includes(extname(e.name))) continue;
      const name = basename(e.name, extname(e.name));
      out.set(name, e.name);
    }
    return out;
  }

  private async compileAndStore(name: string, relPath: string): Promise<void> {
    const abs = join(this.dir, relPath);
    try {
      const source = await readFile(abs, "utf8");
      const compiled = await compile(name, source);
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
    if (!SOURCE_EXTS.includes(extname(rel))) return;
    const name = basename(rel, extname(rel));
    // Make sure the manifest knows about this file.
    if (!this.manifest.get(name)) {
      await this.manifest.upsert(name, { path: rel, description: "" });
    }
    await this.compileAndStore(name, rel);
  }

  private async handleFileRemoved(absPath: string): Promise<void> {
    const rel = relative(this.dir, absPath);
    if (!SOURCE_EXTS.includes(extname(rel))) return;
    const name = basename(rel, extname(rel));
    await this.manifest.remove(name);
    const removed = this.store.remove(name);
    if (removed) this.log(`unloaded ${name} (file deleted)`);
  }

  /**
   * Wait for the next Store change for `name`, or time out.
   * Returns whatever is currently stored on timeout (possibly undefined).
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
