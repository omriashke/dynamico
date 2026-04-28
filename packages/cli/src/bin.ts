#!/usr/bin/env node
import { dev } from "./dev.js";

function parseArgs(argv: string[]): {
  cmd: string | undefined;
  positional: string[];
  flags: Record<string, string | boolean>;
} {
  const [, , cmd, ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = rest[i + 1];
      if (next && !next.startsWith("--")) {
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

const usage = `dynamico — runtime react renderer

Usage:
  dynamico dev <dir> [--registry <url>]

Options:
  --registry  Registry server URL (default: http://localhost:4000)
`;

const { cmd, positional, flags } = parseArgs(process.argv);

if (cmd === "dev") {
  const dir = positional[0] ?? ".";
  const registryUrl = (flags.registry as string) ?? "http://localhost:4000";
  await dev({ dir, registryUrl });
} else {
  // eslint-disable-next-line no-console
  console.log(usage);
  process.exit(cmd ? 1 : 0);
}
