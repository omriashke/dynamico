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
  /**
   * Headers to send on every request. Called on each HTTP fetch and on each
   * WebSocket reconnect, so the function can return a freshly-rotated token.
   */
  headers?: () => Record<string, string>;
  /**
   * When false, skip WebSocket entirely (HTTP fetch only).
   * @default true
   */
  webSocket?: boolean;
}

/**
 * Talks to @omriashke/dynamico-registry (or any compatible server).
 *
 *   GET  {url}/component/:name      -> CompiledModule (initial fetch)
 *   WS   {wsUrl}/subscribe          -> filtered push stream; client sends
 *                                     `{ op: "watch", names: [...] }`
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
  const watchedNames = new Set<string>();
  const watchRefCounts = new Map<string, number>();
  let socket: WebSocket | null = null;
  let disposed = false;
  let pendingWatchSync = false;
  const reconnectMs = options.reconnectMs ?? 1000;
  const useWebSocket = options.webSocket !== false;
  const WS_OPEN = (WSCtor as unknown as { OPEN?: number }).OPEN ?? 1;
  const WS_CONNECTING = (WSCtor as unknown as { CONNECTING?: number }).CONNECTING ?? 0;

  function pushWatchSet(): void {
    if (!useWebSocket || watchedNames.size === 0) return;
    if (!socket || socket.readyState !== WS_OPEN) {
      pendingWatchSync = true;
      connect();
      return;
    }
    pendingWatchSync = false;
    try {
      socket.send(JSON.stringify({ op: "watch", names: [...watchedNames] }));
    } catch {
      /* ignore */
    }
  }

  function connect(): void {
    if (disposed || !useWebSocket || watchedNames.size === 0) return;
    if (socket && (socket.readyState === WS_OPEN || socket.readyState === WS_CONNECTING)) {
      return;
    }
    try {
      const hdrs = options.headers?.();
      socket = hdrs
        ? new (WSCtor as unknown as new (
            url: string,
            protocols?: string | string[],
            options?: { headers?: Record<string, string> },
          ) => WebSocket)(wsUrl, undefined, { headers: hdrs })
        : new WSCtor(wsUrl);
    } catch {
      scheduleReconnect();
      return;
    }
    socket.onopen = () => {
      if (pendingWatchSync || watchedNames.size > 0) pushWatchSet();
    };
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
    if (disposed || !useWebSocket || watchedNames.size === 0) return;
    setTimeout(connect, reconnectMs);
  }

  function watch(name: string): () => void {
    if (!useWebSocket) return () => undefined;
    const next = (watchRefCounts.get(name) ?? 0) + 1;
    watchRefCounts.set(name, next);
    if (next === 1) {
      watchedNames.add(name);
      pushWatchSet();
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = (watchRefCounts.get(name) ?? 1) - 1;
      if (count <= 0) {
        watchRefCounts.delete(name);
        watchedNames.delete(name);
        pushWatchSet();
        if (watchedNames.size === 0) {
          try {
            socket?.close();
          } catch {
            /* noop */
          }
          socket = null;
        }
      } else {
        watchRefCounts.set(name, count);
      }
    };
  }

  return {
    async fetch(name: string): Promise<CompiledModule> {
      const init: RequestInit | undefined = options.headers
        ? { headers: options.headers() }
        : undefined;
      const res = await fetchImpl(
        `${httpUrl}/component/${encodeURIComponent(name)}`,
        init,
      );
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
    watch,
    async reportScope(keys, reportedBy) {
      try {
        const baseHeaders = options.headers?.() ?? {};
        await fetchImpl(`${httpUrl}/scope`, {
          method: "POST",
          headers: { "content-type": "application/json", ...baseHeaders },
          body: JSON.stringify({ keys: [...keys], reportedBy }),
        });
      } catch {
        /* best-effort */
      }
    },
    dispose() {
      disposed = true;
      watchedNames.clear();
      watchRefCounts.clear();
      try {
        socket?.close();
      } catch {
        /* noop */
      }
      socket = null;
    },
  };
}
