import type { CompiledModule, Source, SourceUpdate } from "../types.js";

export interface RemoteSourceOptions {
  /** Base URL of the registry server, e.g. "http://localhost:4000" or "https://reg.example.com". */
  url: string;
  /** Optional WebSocket URL override. Defaults to `url` with http(s) -> ws(s). */
  wsUrl?: string;
  /** Custom fetch (for environments without a global fetch). */
  fetch?: typeof fetch;
  /** Custom WebSocket constructor (RN provides one globally; Node 18+ has it too). */
  WebSocket?: typeof WebSocket;
  /** Reconnection backoff in ms. Default: 1000. */
  reconnectMs?: number;
}

/**
 * Talks to @omriashke/registry-server (or any compatible server).
 *
 *   GET  {url}/component/:name      -> CompiledModule (initial fetch)
 *   WS   {wsUrl}/subscribe          -> stream of CompiledModule updates
 */
export function createRemoteSource(options: RemoteSourceOptions): Source {
  const fetchImpl: typeof fetch =
    options.fetch ??
    (typeof fetch !== "undefined"
      ? fetch
      : ((() => {
          throw new Error("dynamico: no fetch implementation available");
        }) as unknown as typeof fetch));
  const WSCtor: typeof WebSocket =
    options.WebSocket ??
    (typeof WebSocket !== "undefined"
      ? WebSocket
      : (function MissingWS() {
          throw new Error("dynamico: no WebSocket implementation available");
        } as unknown as typeof WebSocket));

  const httpUrl = options.url.replace(/\/$/, "");
  const wsUrl =
    options.wsUrl ?? httpUrl.replace(/^http/, "ws") + "/subscribe";

  const listeners = new Set<(u: SourceUpdate) => void>();
  let socket: WebSocket | null = null;
  let disposed = false;
  const reconnectMs = options.reconnectMs ?? 1000;

  function connect(): void {
    if (disposed) return;
    try {
      socket = new WSCtor(wsUrl);
    } catch (err) {
      scheduleReconnect();
      return;
    }
    socket.onmessage = (ev: MessageEvent) => {
      try {
        const data =
          typeof ev.data === "string"
            ? JSON.parse(ev.data)
            : JSON.parse(new TextDecoder().decode(ev.data as ArrayBuffer));
        if (data && typeof data.name === "string" && typeof data.version === "string") {
          const module: CompiledModule = data;
          for (const l of listeners) l({ module });
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    socket.onclose = () => {
      socket = null;
      scheduleReconnect();
    };
    socket.onerror = () => {
      try {
        socket?.close();
      } catch {
        /* noop */
      }
    };
  }

  function scheduleReconnect(): void {
    if (disposed) return;
    setTimeout(connect, reconnectMs);
  }

  connect();

  return {
    async fetch(name: string): Promise<CompiledModule> {
      const res = await fetchImpl(`${httpUrl}/component/${encodeURIComponent(name)}`);
      if (!res.ok) {
        return {
          name,
          version: "0",
          error: {
            kind: "compile",
            message: `registry returned ${res.status} for ${name}`,
          },
        };
      }
      return (await res.json()) as CompiledModule;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      disposed = true;
      try {
        socket?.close();
      } catch {
        /* noop */
      }
    },
  };
}
