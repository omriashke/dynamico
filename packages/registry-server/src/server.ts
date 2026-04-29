import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import type { CompiledModule } from "@omriashke/dynamico-core";
import { Store } from "./store.js";
import { compile } from "./compile.js";
import { registerAuth, type AuthOptions } from "./auth.js";
import { FilesystemSourceStore } from "./sourceStore.js";
import { searchEntries } from "./search.js";

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
}

interface UploadQuery {
  dryRun?: string | boolean;
}

/** Build a Fastify app exposing the dynamico registry HTTP+WS API. */
export async function createServer(options: CreateServerOptions): Promise<{
  app: FastifyInstance;
  store: Store;
  sourceStore: FilesystemSourceStore;
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

  const sourceStore = new FilesystemSourceStore({
    dir: options.sourceDir,
    store,
    log: (msg) => app.log.info(msg),
  });
  await sourceStore.start();
  app.addHook("onClose", async () => {
    await sourceStore.stop();
  });

  app.get("/health", async () => ({ ok: true }));

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
            if (dryRun) return await compile(name, source);
            try {
              return await sourceStore.write(name, source, description);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              return { name, version: "", error: { kind: "compile" as const, message: msg } };
            }
          }),
        );
        const anyError = results.some((r) => r.error);
        if (anyError) reply.code(422);
        return { dryRun, results };
      }

      const { name, source, description } = body;
      if (!name || typeof source !== "string") {
        reply.code(400);
        return {
          error: "expected JSON body { name: string, source: string, description?: string } or { components: [...] }",
        };
      }

      if (dryRun) {
        const compiled = await compile(name, source);
        if (compiled.error) reply.code(422);
        return { dryRun, ...compiled };
      }

      try {
        const compiled = await sourceStore.write(name, source, description);
        if (compiled.error) reply.code(422);
        return { dryRun, ...compiled };
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

  return { app, store, sourceStore };
}

function indexManifest<T extends { name: string }>(list: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const e of list) m.set(e.name, e);
  return m;
}
