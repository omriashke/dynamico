export interface ParsedArgs {
  cmd: string | undefined;
  positional: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Tiny argv parser:
 *   - `--key value` and `--key=value` both supported
 *   - `--flag` (no value) becomes `true`
 *   - everything else is positional
 *
 * We deliberately avoid pulling in a parser library; the agent surface is small.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const [, , cmd, ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { cmd, positional, flags };
}

export function flagString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const v = flags[key];
  return typeof v === "string" ? v : undefined;
}

export function flagBool(flags: Record<string, string | boolean>, key: string): boolean {
  return flags[key] === true || flags[key] === "true";
}

export interface ResolvedAuth {
  registry: string;
  token?: string;
  user?: string;
  password?: string;
  json: boolean;
}

/**
 * Resolve common flags shared across commands:
 *   --registry  Registry URL (default: env DYNAMICO_REGISTRY or http://localhost:4000)
 *   --token     Bearer token (default: env DYNAMICO_TOKEN)
 *   --user      Basic auth user (default: env DYNAMICO_USER)
 *   --password  Basic auth password (default: env DYNAMICO_PASSWORD)
 *   --json      Emit machine-readable JSON instead of human text
 */
export function resolveCommon(flags: Record<string, string | boolean>): ResolvedAuth {
  return {
    registry: flagString(flags, "registry") ?? process.env.DYNAMICO_REGISTRY ?? "http://localhost:4000",
    token: flagString(flags, "token") ?? process.env.DYNAMICO_TOKEN,
    user: flagString(flags, "user") ?? process.env.DYNAMICO_USER,
    password: flagString(flags, "password") ?? process.env.DYNAMICO_PASSWORD,
    json: flagBool(flags, "json"),
  };
}
