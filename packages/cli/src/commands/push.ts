import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import type { Diagnostic } from "@dynamico/core";
import { upload, type ClientOptions } from "../client.js";
import { flagBool, flagString, resolveCommon } from "../args.js";
import { emit, fail, formatDiagnostic } from "../output.js";

const SOURCE_EXTS = [".tsx", ".jsx", ".ts", ".js"];

export interface PushArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

/**
 * `dynamico push <name>`
 *
 * Reads a single component source from one of:
 *   - --source <path>   (defaults to "<name>.tsx" in cwd if neither flag set)
 *   - --stdin           (read from stdin)
 * Or, if --dir is provided, uploads every supported file under <dir> in one
 * request; <name> is then ignored.
 *
 * --dry-run sends to /upload?dryRun=true; the server compiles + typechecks
 * but doesn't store. Useful for agents to validate before committing.
 *
 * Exit codes:
 *   0  success
 *   1  client/usage error (bad flags, file not found, network)
 *   2  registry rejected (auth, server error, etc.)
 *   3  validation failure (compile/typecheck errors). Diagnostics are printed
 *      so an agent knows exactly what to fix.
 */
export async function push(args: PushArgs): Promise<void> {
  const common = resolveCommon(args.flags);
  const client: ClientOptions = common;
  const dryRun = flagBool(args.flags, "dry-run");
  const dir = flagString(args.flags, "dir");
  const useStdin = flagBool(args.flags, "stdin");
  const sourcePath = flagString(args.flags, "source");
  const description = flagString(args.flags, "description");

  if (dir) {
    return pushDir(client, dir, dryRun, common.json);
  }

  const name = args.positional[0];
  if (!name) {
    fail(common.json, { error: "missing <name>" }, ["error: missing <name>; usage: dynamico push <name> [--source <path> | --stdin] [--description <text>] [--dry-run]"]);
  }

  let source: string;
  if (useStdin) {
    source = await readStdin();
  } else {
    const filePath = resolve(sourcePath ?? `${name}.tsx`);
    try {
      source = await readFile(filePath, "utf8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      fail(common.json, { error: msg }, [`error: cannot read ${filePath}: ${msg}`]);
    }
  }

  const body: { name: string; source: string; description?: string } = { name, source };
  if (description !== undefined) body.description = description;
  const { status, data } = await upload(client, body, dryRun);
  handleSingleResponse(name, status, data, common.json, dryRun);
}

async function pushDir(client: ClientOptions, dir: string, dryRun: boolean, json: boolean): Promise<void> {
  const root = resolve(dir);
  const files = await collectFiles(root);
  if (files.length === 0) {
    fail(json, { error: "no .tsx/.jsx/.ts/.js files found", dir: root }, [`error: no source files in ${root}`]);
  }
  const components = await Promise.all(
    files.map(async (file) => {
      const ext = extname(file);
      const name = basename(file, ext);
      const source = await readFile(file, "utf8");
      return { name, source };
    }),
  );

  const { status, data } = await upload(client, { components }, dryRun);

  if (status >= 500 || (status >= 400 && status !== 422)) {
    fail(json, { status, data }, [`error: registry returned ${status}`], 2);
  }

  const results = data.results ?? [];
  let failed = 0;
  const lines: string[] = [];
  for (const r of results) {
    if (r.error) {
      failed++;
      lines.push(`x ${r.name}@${r.version}  ${r.error.kind}: ${r.error.message}`);
      for (const d of r.error.diagnostics ?? []) {
        lines.push("  " + formatDiagnostic(r.name, d).split("\n").join("\n  "));
      }
    } else if (r.removed) {
      // Shouldn't happen in upload responses; ignore for safety.
    } else {
      const tag = dryRun ? "(dry-run) ok" : "ok";
      lines.push(`> ${r.name}@${r.version}  ${tag}`);
      const warnings = r.warnings ?? [];
      for (const w of warnings) {
        lines.push("  " + formatDiagnostic(r.name, w).split("\n").join("\n  "));
      }
    }
  }
  lines.push(`\n${results.length - failed}/${results.length} succeeded${dryRun ? " (dry-run)" : ""}`);

  if (failed > 0) {
    fail(json, { dryRun, results }, lines, 3);
  }
  emit(json, { dryRun, results }, lines);
}

function handleSingleResponse(
  name: string,
  status: number,
  data: { dryRun?: boolean; version?: string; warnings?: Diagnostic[]; error?: { kind: string; message: string; diagnostics?: Diagnostic[] } },
  json: boolean,
  dryRun: boolean,
): void {
  if (status === 401 || status === 403) {
    fail(json, { status, error: "unauthorized" }, [`error: registry rejected credentials (${status})`], 2);
  }
  if (status === 422 && data.error) {
    const lines = [`x ${name}  ${data.error.kind}: ${data.error.message}`];
    for (const d of data.error.diagnostics ?? []) lines.push(formatDiagnostic(name, d));
    fail(json, data, lines, 3);
  }
  if (status >= 400) {
    fail(json, { status, data }, [`error: registry returned ${status}`], 2);
  }
  const lines = [`> ${name}@${data.version}${dryRun ? "  (dry-run)" : ""}`];
  for (const w of data.warnings ?? []) lines.push(formatDiagnostic(name, w));
  emit(json, data, lines);
}

async function collectFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (e.name === "node_modules" || e.name === "dist") continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(p);
      } else if (SOURCE_EXTS.includes(extname(e.name))) {
        out.push(p);
      }
    }
  }
  const s = await stat(root);
  if (s.isFile()) return [root];
  await walk(root);
  return out;
}

async function readStdin(): Promise<string> {
  return new Promise((resolveStr, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolveStr(data));
    process.stdin.on("error", reject);
  });
}
