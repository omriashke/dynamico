#!/usr/bin/env node
import { dev } from "./dev.js";
import { parseArgs } from "./args.js";
import { push } from "./commands/push.js";
import { pull } from "./commands/pull.js";
import { list } from "./commands/list.js";
import { rm } from "./commands/rm.js";
import { searchCmd } from "./commands/search.js";
import { skill } from "./commands/skill.js";

const usage = `dynamico — runtime react renderer

Usage:
  dynamico push <name> [--source <path> | --stdin] [--dir <path>] [--description <text>] [--dry-run] [--json]
  dynamico pull <name> [--source] [--out <path>] [--json]
  dynamico list [--json]
  dynamico search <query> [--json]
  dynamico rm <name> [--json]
  dynamico dev <dir>
  dynamico skill install [--target <dir>] [--force] [--json]

Common flags (all commands):
  --registry <url>     Registry server URL (default: $DYNAMICO_REGISTRY or http://localhost:4000)
  --token <token>      Bearer token (default: $DYNAMICO_TOKEN)
  --user <user>        Basic auth username (default: $DYNAMICO_USER)
  --password <pwd>     Basic auth password (default: $DYNAMICO_PASSWORD)
  --json               Emit machine-readable JSON to stdout

Exit codes:
  0  ok
  1  client/usage error (missing arg, file not found, network)
  2  registry error (auth, server, 4xx/5xx)
  3  validation error (compile/typecheck failed; diagnostics in output)
`;

async function main(): Promise<void> {
  const { cmd, positional, flags } = parseArgs(process.argv);

  switch (cmd) {
    case "push":
      await push({ positional, flags });
      return;
    case "pull":
      await pull({ positional, flags });
      return;
    case "list":
      await list({ positional, flags });
      return;
    case "search":
      await searchCmd({ positional, flags });
      return;
    case "rm":
      await rm({ positional, flags });
      return;
    case "skill":
      await skill({ positional, flags });
      return;
    case "dev": {
      const dir = positional[0] ?? ".";
      const registryUrl = (typeof flags.registry === "string" ? flags.registry : undefined) ?? process.env.DYNAMICO_REGISTRY ?? "http://localhost:4000";
      await dev({ dir, registryUrl });
      return;
    }
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(usage);
      process.exit(0);
      return;
    default:
      process.stderr.write(`unknown command: ${cmd}\n\n${usage}`);
      process.exit(1);
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
});
