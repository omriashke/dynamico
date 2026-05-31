#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "./server.js";
import type { AuthOptions } from "./auth.js";

/**
 * Tiny dotenv loader. We avoid a runtime dependency for a feature this small.
 * Resolution order:
 *   1. $DYNAMICO_ENV_FILE if set (absolute or relative-to-cwd path)
 *   2. Walk upward from process.cwd() looking for the first .env file.
 *
 * Walking up is the same behavior pnpm/npm use for workspace lookups; it
 * means dropping a .env at the repo root works regardless of which package
 * script invoked us.
 *
 * Existing process.env values take precedence (so command-line overrides work).
 * Lines starting with '#' or empty lines are ignored. Values may be quoted
 * with single or double quotes; quotes are stripped, no escape handling.
 */
function findEnvFile(): string | undefined {
  const explicit = process.env.DYNAMICO_ENV_FILE;
  if (explicit) {
    const p = resolve(process.cwd(), explicit);
    return existsSync(p) ? p : undefined;
  }
  let dir = process.cwd();
  for (let i = 0; i < 12; i++) {
    const candidate = resolve(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function loadDotenv(): void {
  const envFile = findEnvFile();
  if (!envFile) return;
  const content = readFileSync(envFile, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
loadDotenv();

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

const auth: AuthOptions = {};
if (process.env.DYNAMICO_TOKEN) auth.token = process.env.DYNAMICO_TOKEN;
if (process.env.DYNAMICO_BASIC_USER && process.env.DYNAMICO_BASIC_PASSWORD) {
  auth.basic = {
    user: process.env.DYNAMICO_BASIC_USER,
    password: process.env.DYNAMICO_BASIC_PASSWORD,
  };
}
if (process.env.DYNAMICO_ALLOW_IPS) {
  auth.allowIps = process.env.DYNAMICO_ALLOW_IPS.split(",").map((s) => s.trim()).filter(Boolean);
}

const sourceDir = process.env.DYNAMICO_SOURCE_DIR;
if (!sourceDir) {
  process.stderr.write(
    "dynamico-registry: DYNAMICO_SOURCE_DIR is required.\n" +
      "  Set it to a directory containing your .tsx source files and dynamico.config.json.\n" +
      "  Example: DYNAMICO_SOURCE_DIR=./components dynamico-registry\n",
  );
  process.exit(1);
}
const { app } = await createServer({ auth, sourceDir });

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
