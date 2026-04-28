import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import cors from "@fastify/cors";
import type { CompiledModule } from "@dynamico/core";
import { Store } from "./store.js";
import { compile } from "./compile.js";

export interface CreateServerOptions {
  /** Optional logger config. Default: pretty in dev, json in prod. */
  logger?: boolean | object;
  /** CORS origin(s). Defaults to "*". Set to a list of origins in production. */
  cors?: boolean | string | string[];
}

/** Build a Fastify app exposing the dynamico registry HTTP+WS API. */
export async function createServer(options: CreateServerOptions = {}): Promise<{
  app: FastifyInstance;
  store: Store;
}> {
  const app = Fastify({ logger: options.logger ?? true });
  const store = new Store();

  const corsOrigin = options.cors ?? "*";
  await app.register(cors, {
    origin: corsOrigin === false ? false : corsOrigin,
    methods: ["GET", "POST", "OPTIONS"],
  });
  await app.register(websocket);

  app.get("/health", async () => ({ ok: true }));

  app.get("/components", async () => store.list().map(({ code, ...rest }) => rest));

  app.get<{ Params: { name: string } }>("/component/:name", async (req, reply) => {
    const mod = store.get(req.params.name);
    if (!mod) {
      reply.code(404);
      return { error: `unknown component '${req.params.name}'` };
    }
    return mod;
  });

  app.post<{ Body: { name?: string; source?: string } }>(
    "/upload",
    async (req, reply) => {
      const { name, source } = req.body ?? {};
      if (!name || typeof source !== "string") {
        reply.code(400);
        return { error: "expected JSON body { name: string, source: string }" };
      }
      const compiled = await compile(name, source);
      const stored = store.set(compiled);
      return stored;
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

  return { app, store };
}
