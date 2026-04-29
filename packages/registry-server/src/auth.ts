import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export interface AuthOptions {
  /** Static bearer token. If set, request must include `Authorization: Bearer <token>`. */
  token?: string;
  /** HTTP Basic auth credentials. If set, request must include matching `Authorization: Basic <base64>`. */
  basic?: { user: string; password: string };
  /** Restrict access to a fixed list of IPs / CIDRs. */
  allowIps?: string[];
  /**
   * Routes that bypass auth. Defaults to `["/health"]`.
   * Useful for liveness probes that can't carry credentials.
   */
  publicRoutes?: string[];
}

/**
 * Register opt-in auth as a global onRequest hook.
 *
 * Auth is permissive by default: if no auth method is configured the hook is
 * not registered at all. When at least one method is configured, a request
 * is allowed if it satisfies *any* of them. This lets you run a server with
 * an IP allow-list AND a bearer token, where machines on the allow-list don't
 * need credentials.
 */
export async function registerAuth(
  app: FastifyInstance,
  options: AuthOptions | undefined,
): Promise<void> {
  if (!options || (!options.token && !options.basic && !options.allowIps?.length)) {
    return;
  }
  const publicRoutes = new Set(options.publicRoutes ?? ["/health"]);

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    if (publicRoutes.has(req.routeOptions?.url ?? req.url)) return;

    if (options.allowIps?.length && ipMatches(req.ip, options.allowIps)) return;

    const header = req.headers["authorization"];
    if (typeof header === "string") {
      if (options.token && header === `Bearer ${options.token}`) return;
      if (options.basic && header.startsWith("Basic ")) {
        const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
        const sep = decoded.indexOf(":");
        if (sep > 0) {
          const user = decoded.slice(0, sep);
          const pwd = decoded.slice(sep + 1);
          if (user === options.basic.user && pwd === options.basic.password) return;
        }
      }
    }

    reply.code(401).header("WWW-Authenticate", buildChallenge(options));
    return reply.send({ error: "unauthorized" });
  });
}

function buildChallenge(options: AuthOptions): string {
  const parts: string[] = [];
  if (options.basic) parts.push(`Basic realm="dynamico"`);
  if (options.token) parts.push(`Bearer realm="dynamico"`);
  return parts.join(", ") || `Bearer realm="dynamico"`;
}

function ipMatches(ip: string, allow: string[]): boolean {
  // v1: simple exact match. CIDR support would go here in v2.
  // Handle the "::ffff:127.0.0.1" form Node hands us for IPv4-on-IPv6.
  const norm = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  return allow.includes(ip) || allow.includes(norm);
}
