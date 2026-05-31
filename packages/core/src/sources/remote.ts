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
   *
   * - HTTP: merged into the `Authorization: ...` / `x-api-key: ...` request headers.
   * - WebSocket: passed as `new WebSocket(url, undefined, { headers })`. This
   *   works on React Native (which extends the standard constructor); browsers
   *   silently ignore it because the spec doesn't allow custom WS handshake
   *   headers. For browsers behind authenticated reverse proxies, use a
   *   query-string token in `wsUrl` or front the registry with cookie auth.
   */
  headers?: () => Record<string, string>;
}

/**
 * Talks to @omriashke/dynamico-registry (or any compatible server).
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
      const hdrs = options.headers?.();
      // RN's WebSocket constructor accepts a third {headers} arg that lets us
      // attach Bearer / x-api-key tokens to the upgrade request. The standard
      // browser WebSocket ignores extra constructor args, so this is a no-op
      // there (use cookies / a query-string token instead).
      socket = hdrs
        ? new (WSCtor as unknown as new (
            url: string,
            protocols?: string | string[],
            options?: { headers?: Record<string, string> },
          ) => WebSocket)(wsUrl, undefined, { headers: hdrs })
        : new WSCtor(wsUrl);
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
    /**
     * Tell the registry what bare specifiers the host's scope exposes. The
     * registry uses this to validate that every component's imports resolve
     * against something the host actually provides — so a typo or a forgotten
     * scope entry is caught at push time, not at navigation time.
     *
     * Best-effort: failures (network, 5xx, server doesn't support /scope) are
     * silently swallowed; they don't block the app from running.
     */
    async reportScope(keys, reportedBy) {
      try {
        const baseHeaders = options.headers?.() ?? {};
        await fetchImpl(`${httpUrl}/scope`, {
          method: "POST",
          headers: { "content-type": "application/json", ...baseHeaders },
          body: JSON.stringify({ keys: [...keys], reportedBy }),
        });
      } catch {
        /* best-effort: never block the host on this */
      }
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
