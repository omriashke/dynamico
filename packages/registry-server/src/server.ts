import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import type { CompiledModule } from "@omriashke/dynamico-core";
import { Store } from "./store.js";
import { compile } from "./compile.js";
import { registerAuth, type AuthOptions } from "./auth.js";
import { FilesystemSourceStore } from "./sourceStore.js";
import { searchEntries } from "./search.js";
import { ScopeCache } from "./scopeCache.js";

export interface CreateServerOptions {
  /** Optional logger config. Default: pretty in dev, json in prod. */
  logger?: boolean | object;
  /** CORS origin(s). Defaults to "*". Set to a list of origins in production. */
  cors?: boolean | string | string[];
  /** Auth: any combination of bearer token, basic auth, IP allow-list. */
  auth?: AuthOptions;
  /**
   * Absolute path to a directory holding `.tsx`/`.jsx` source files +
   * `dynamico.config.json`. Required: disk is the source of truth.
   *   - POST /upload writes files and a watcher recompiles
   *   - DELETE unlinks files
   *   - GET /component/:name/source returns raw source
   *   - GET /search returns ranked name+description hits
   */
  sourceDir: string;
}

interface UploadBody {
  name?: string;
  source?: string;
  description?: string;
  /** Bulk variant: { components: [{name, source, description?}, ...] } */
  components?: Array<{ name: string; source: string; description?: string }>;
  /** Optional Dynamico Book catalog (`book.config.json` or `storybook.config.json`). */
  bookConfig?: { filename?: string; source: string };
}

interface UploadQuery {
  dryRun?: string | boolean;
}

async function persistBookConfig(
  sourceStore: FilesystemSourceStore,
  bookConfig: UploadBody["bookConfig"],
  dryRun: boolean,
): Promise<{ filename: string; ok: true } | undefined> {
  if (!bookConfig || typeof bookConfig.source !== "string") return undefined;
  const filename = bookConfig.filename ?? "book.config.json";
  if (dryRun) return { filename, ok: true };
  await sourceStore.writeBookConfig(filename, bookConfig.source);
  return { filename, ok: true };
}

function bookConfigPath(sourceDir: string): string | null {
  for (const name of ["book.config.json", "storybook.config.json"]) {
    const filePath = join(sourceDir, name);
    if (existsSync(filePath)) return filePath;
  }
  return null;
}

function serveBookConfig(sourceDir: string, req: FastifyRequest, reply: FastifyReply) {
  const filePath = bookConfigPath(sourceDir);
  if (!filePath) {
    reply.code(404);
    return { error: "book.config.json not found" };
  }
  const body = readFileSync(filePath, "utf8");
  const etag = `"${createHash("md5").update(body).digest("hex")}"`;
  if (req.headers["if-none-match"] === etag) {
    reply.code(304);
    return;
  }
  reply.header("etag", etag);
  reply.header("cache-control", "no-store");
  return JSON.parse(body);
}

/** Build a Fastify app exposing the dynamico registry HTTP+WS API. */
export async function createServer(options: CreateServerOptions): Promise<{
  app: FastifyInstance;
  store: Store;
  sourceStore: FilesystemSourceStore;
  scopeCache: ScopeCache;
}> {
  if (!options?.sourceDir) {
    throw new Error("createServer: options.sourceDir is required");
  }

  const app = Fastify({ logger: options.logger ?? true });
  const store = new Store();

  const corsOrigin = options.cors ?? "*";
  await app.register(cors, {
    origin: corsOrigin === false ? false : corsOrigin,
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
  });
  await app.register(websocket);
  await registerAuth(app, options.auth);

  const scopeCache = new ScopeCache(options.sourceDir);
  const sourceStore = new FilesystemSourceStore({
    dir: options.sourceDir,
    store,
    log: (msg) => app.log.info(msg),
    scopeCache,
  });
  await sourceStore.start();
  app.addHook("onClose", async () => {
    await sourceStore.stop();
  });

  app.get("/health", async () => ({ ok: true }));

  /**
   * Current host scope (the list of bare specifiers the connected app's
   * DynamicoProvider exposes). Pushes are validated against this list — any
   * component that imports a specifier outside it is rejected.
   *
   * Returns { keys: null } if no host has reported yet (gate stays permissive
   * in that case).
   */
  app.get("/scope", async () => {
    const report = scopeCache.get();
    return report ?? { keys: null, reportedAt: null };
  });

  /**
   * Hosts (the @omriashke/dynamico-native client SDK) auto-report their
   * scope on mount. Body: { keys: string[], reportedBy?: string }.
   * The registry caches this and uses it to validate subsequent pushes.
   */
  app.post<{ Body: { keys?: unknown; reportedBy?: unknown } }>(
    "/scope",
    async (req, reply) => {
      const body = req.body ?? {};
      if (!Array.isArray(body.keys) || !body.keys.every((k) => typeof k === "string")) {
        reply.code(400);
        return { error: 'expected JSON body { keys: string[], reportedBy?: string }' };
      }
      const previous = scopeCache.get();
      const report = scopeCache.set({
        keys: body.keys as string[],
        reportedBy: typeof body.reportedBy === "string" ? body.reportedBy : undefined,
      });
      app.log.info(
        { keys: report.keys.length, reportedBy: report.reportedBy },
        "scope reported",
      );

      // Re-validate the entire registry against the new scope whenever the
      // set of keys changes. This catches "stale acceptance" — components
      // accepted earlier (under a more permissive scope) but no longer
      // compatible with what the app actually exposes.
      const changed =
        !previous ||
        previous.keys.length !== report.keys.length ||
        previous.keys.some((k, i) => k !== report.keys[i]);
      if (changed) {
        sourceStore.revalidateAll().catch((err) => {
          app.log.error({ err: String(err) }, "revalidateAll failed");
        });
      }

      return { ok: true, ...report };
    },
  );

  /** Listing: name + version + status + description. */
  app.get("/components", async () => {
    const compiled = store.list();
    const manifest = indexManifest(sourceStore.listManifest());
    return compiled.map((m) => {
      const { code: _omit, ...rest } = m as CompiledModule & { code?: string };
      const description = manifest.get(m.name)?.description ?? "";
      return { ...rest, description };
    });
  });

  /** Full compiled module (with `code`) for a single component. */
  app.get<{ Params: { name: string } }>("/component/:name", async (req, reply) => {
    const mod = store.get(req.params.name);
    if (!mod) {
      reply.code(404);
      return { error: `unknown component '${req.params.name}'` };
    }
    return mod;
  });

  /**
   * Raw source for a component. This is the agent's main read path when it
   * wants to edit an existing component.
   */
  app.get<{ Params: { name: string } }>("/component/:name/source", async (req, reply) => {
    const result = await sourceStore.getSource(req.params.name);
    if (!result) {
      reply.code(404);
      return { error: `unknown component '${req.params.name}'` };
    }
    return result;
  });

  /** Ranked name + description search. */
  app.get<{ Querystring: { q?: string } }>("/search", async (req) => {
    const q = (req.query.q ?? "").toString();
    const entries = sourceStore.listManifest().map(({ name, description }) => ({
      name,
      description,
    }));
    return { query: q, hits: searchEntries(q, entries) };
  });

  app.delete<{ Params: { name: string } }>("/component/:name", async (req, reply) => {
    const ok = await sourceStore.remove(req.params.name);
    if (!ok) {
      reply.code(404);
      return { error: `unknown component '${req.params.name}'` };
    }
    return { ok: true, name: req.params.name };
  });

  /**
   * Metadata-only patch for a component (currently just `description`). Does
   * not re-read or recompile the source file.
   */
  app.patch<{ Params: { name: string }; Body: { description?: string } }>(
    "/component/:name",
    async (req, reply) => {
      const body = req.body ?? {};
      if (body.description !== undefined && typeof body.description !== "string") {
        reply.code(400);
        return { error: "description must be a string" };
      }
      try {
        const updated = await sourceStore.patchMeta(req.params.name, body);
        return { ok: true, ...updated };
      } catch (err) {
        const e = err as Error & { code?: string };
        if (e.code === "NOT_FOUND") {
          reply.code(404);
          return { error: e.message };
        }
        reply.code(400);
        return { error: e.message };
      }
    },
  );

  /** Current manifest (equivalent of `cat dynamico.config.json`). */
  app.get("/config", async () => sourceStore.snapshotConfig());

  /** Storybook catalog config (legacy). */
  app.get("/storybook-config", async (req, reply) => {
    return serveBookConfig(options.sourceDir, req, reply);
  });

  /** Dynamico Book catalog config (`book.config.json`, falls back to `storybook.config.json`). */
  app.get("/book-config", async (req, reply) => {
    return serveBookConfig(options.sourceDir, req, reply);
  });

  /**
   * Replace the entire manifest. Entries dropped from the body are removed
   * (their source files deleted). All referenced paths must exist on disk;
   * on validation failure no changes are written.
   */
  app.put<{ Body: { version?: number; components?: Record<string, { path?: string; description?: string }> } }>(
    "/config",
    async (req, reply) => {
      const body = req.body ?? {};
      if (!body || typeof body !== "object" || typeof body.components !== "object" || body.components === null) {
        reply.code(400);
        return { error: 'expected JSON body { version: 1, components: { [name]: { path, description } } }' };
      }
      try {
        const normalized = {
          version: 1 as const,
          components: Object.fromEntries(
            Object.entries(body.components).map(([name, entry]) => [
              name,
              {
                path: (entry?.path ?? "") as string,
                description: (entry?.description ?? "") as string,
              },
            ]),
          ),
        };
        const diff = await sourceStore.replaceConfig(normalized);
        return { ok: true, ...diff };
      } catch (err) {
        const e = err as Error & { code?: string; diagnostics?: string[] };
        if (e.code === "INVALID_CONFIG") {
          reply.code(422);
          return { error: e.message, diagnostics: e.diagnostics ?? [] };
        }
        reply.code(400);
        return { error: e.message };
      }
    },
  );

  app.post<{ Body: UploadBody; Querystring: UploadQuery }>(
    "/upload",
    async (req, reply) => {
      const dryRun =
        req.query.dryRun === true || req.query.dryRun === "true" || req.query.dryRun === "1";
      const body = req.body ?? {};

      if (Array.isArray(body.components)) {
        const results = await Promise.all(
          body.components.map(async ({ name, source, description }) => {
            if (!name || typeof source !== "string") {
              return {
                name: name ?? "<missing>",
                error: { kind: "compile" as const, message: "expected { name, source }" },
              };
            }
            if (dryRun) {
              const relPath = sourceStore.resolvePathForName(name);
              const registered = new Set(sourceStore.registeredComponentNames());
              registered.add(name);
              return await compile(name, source, extname(relPath), {
                absSourcePath: join(options.sourceDir, relPath),
                registeredComponents: registered,
              });
            }
            try {
              return await sourceStore.write(name, source, description);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              return { name, version: "", error: { kind: "compile" as const, message: msg } };
            }
          }),
        );
        const anyError = results.some((r) => r.error);
        if (anyError) {
          reply.code(422);
          return { dryRun, results };
        }
        try {
          const bookConfig = await persistBookConfig(sourceStore, body.bookConfig, dryRun);
          return { dryRun, results, ...(bookConfig ? { bookConfig } : {}) };
        } catch (err) {
          reply.code(400);
          return {
            dryRun,
            results,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      const { name, source, description } = body;
      if (!name || typeof source !== "string") {
        reply.code(400);
        return {
          error: "expected JSON body { name: string, source: string, description?: string } or { components: [...] }",
        };
      }

      if (dryRun) {
        const relPath = sourceStore.resolvePathForName(name);
        const registered = new Set(sourceStore.registeredComponentNames());
        registered.add(name);
        const compiled = await compile(name, source, extname(relPath), {
          absSourcePath: join(options.sourceDir, relPath),
          registeredComponents: registered,
        });
        if (compiled.error) reply.code(422);
        return { dryRun, ...compiled };
      }

      try {
        const compiled = await sourceStore.write(name, source, description);
        if (compiled.error) {
          reply.code(422);
          return { dryRun, ...compiled };
        }
        const bookConfig = await persistBookConfig(sourceStore, body.bookConfig, dryRun);
        return { dryRun, ...compiled, ...(bookConfig ? { bookConfig } : {}) };
      } catch (err) {
        reply.code(400);
        return { error: err instanceof Error ? err.message : String(err) };
      }
    },
  );

  app.register(async function wsRoutes(scoped) {
    scoped.get("/subscribe", { websocket: true }, (socket) => {
      const send = (m: CompiledModule) => {
        try {
          socket.send(JSON.stringify(m));
        } catch {
          /* ignore */
        }
      };
      for (const m of store.list()) send(m);
      const off = store.subscribe(send);
      socket.on("close", off);
    });
  });

  return { app, store, sourceStore, scopeCache };
}

function indexManifest<T extends { name: string }>(list: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const e of list) m.set(e.name, e);
  return m;
}
