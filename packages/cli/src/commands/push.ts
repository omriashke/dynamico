import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { Diagnostic } from "@omriashke/dynamico-core";
import { MANIFEST_FILENAME, isComponentTestFilename } from "@omriashke/dynamico-core";
import { upload, type ClientOptions } from "../client.js";
import { validateBookConfigAtDir, readBookConfigFileAsync } from "../bookConfigValidate.js";
import { flagBool, flagString, resolveCommon } from "../args.js";
import { emit, fail, formatDiagnostic } from "../output.js";

/**
 * Extensions accepted as dynamic component source. `.tsx`/`.jsx` are the
 * common case; `.ts`/`.js` are allowed for logic-only helpers.
 */
const SOURCE_EXTS = [".tsx", ".jsx", ".ts", ".js"] as const;
type SourceExt = (typeof SOURCE_EXTS)[number];

const MANIFEST_NAME = MANIFEST_FILENAME;

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
    if (!isAllowedExt(filePath)) {
      fail(
        common.json,
        { error: "only .tsx / .jsx sources are allowed", path: filePath },
        [`error: ${filePath} must end in ${SOURCE_EXTS.join(" or ")}`],
      );
    }
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

/**
 * Bulk push. Semantics:
 *   - `<dir>/dynamico.config.json` is required. It's the explicit contract
 *     that says *which* files should be published and with what descriptions.
 *   - For each manifest entry we read `<dir>/<entry.path>` and POST it.
 *     Subfolders in `entry.path` are allowed: component names stay flat
 *     (keyed by basename) but files can live anywhere under the root.
 *   - Every `entry.path` must end in `.tsx` or `.jsx`.
 *   - Any .tsx/.jsx on disk that isn't in the manifest is reported as a
 *     warning ("extra file") — the agent decides whether to add it or
 *     delete it. One outlier shouldn't block a push.
 *   - Any manifest entry whose file is missing on disk is a hard error
 *     (exit 1), because the agent explicitly said this file should publish.
 */
async function pushDir(client: ClientOptions, dir: string, dryRun: boolean, json: boolean): Promise<void> {
  const root = resolve(dir);
  const manifestPath = join(root, MANIFEST_NAME);

  let manifestRaw: string;
  try {
    manifestRaw = await readFile(manifestPath, "utf8");
  } catch {
    fail(
      json,
      { error: `${MANIFEST_NAME} not found`, path: manifestPath },
      [
        `error: ${manifestPath} not found`,
        `dynamico push --dir requires a ${MANIFEST_NAME} at the root of the directory.`,
        "example:",
        '  {"version":1,"components":{"Hello":{"path":"Hello.tsx","description":"..."}}}',
      ],
    );
  }

  let manifest: { version: number; components: Record<string, { path: string; description?: string }> };
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (err) {
    fail(
      json,
      { error: `${MANIFEST_NAME} is not valid JSON`, message: (err as Error).message },
      [`error: ${manifestPath} is not valid JSON: ${(err as Error).message}`],
    );
  }
  if (!manifest || typeof manifest.components !== "object") {
    fail(
      json,
      { error: `${MANIFEST_NAME} missing "components" object` },
      [`error: ${manifestPath} is missing the top-level "components" object`],
    );
  }

  const onDisk = await collectNames(root);
  const manifestNames = new Set(Object.keys(manifest.components));
  const extras = [...onDisk].filter((n) => !manifestNames.has(n));

  const missingOnDisk: Array<{ name: string; path: string }> = [];
  const components: Array<{ name: string; source: string; description?: string }> = [];
  for (const [name, entry] of Object.entries(manifest.components)) {
    if (!entry?.path || typeof entry.path !== "string") {
      fail(
        json,
        { error: `manifest entry '${name}' missing path` },
        [`error: ${MANIFEST_NAME}: entry '${name}' is missing a "path"`],
      );
    }
    if (!isAllowedExt(entry.path)) {
      fail(
        json,
        { error: `manifest entry '${name}' has unsupported extension`, path: entry.path },
        [`error: ${MANIFEST_NAME}: '${name}' -> ${entry.path} must end in ${SOURCE_EXTS.join(" or ")}`],
      );
    }
    const abs = join(root, entry.path);
    try {
      const source = await readFile(abs, "utf8");
      components.push({
        name,
        source,
        ...(entry.description !== undefined ? { description: entry.description } : {}),
      });
    } catch {
      missingOnDisk.push({ name, path: entry.path });
    }
  }

  if (missingOnDisk.length > 0) {
    fail(
      json,
      { error: "manifest entries missing from disk", missing: missingOnDisk },
      [
        "error: manifest references files that don't exist on disk:",
        ...missingOnDisk.map((m) => `  - ${m.name} -> ${m.path}`),
      ],
    );
  }
  if (components.length === 0) {
    fail(
      json,
      { error: `${MANIFEST_NAME} has no components` },
      [`error: ${manifestPath} has no components`],
    );
  }

  const bookIssues = await validateBookConfigAtDir(root, manifest.components);
  if (bookIssues.length > 0) {
    const lines = ["error: book.config.json preview props invalid:"];
    for (const issue of bookIssues) {
      lines.push(`  ${issue.component}:`);
      for (const err of issue.errors) lines.push(`    - ${err}`);
    }
    fail(json, { error: "book.config.json validation failed", issues: bookIssues }, lines, 3);
  }

  const bookConfig = await readBookConfigFileAsync(root);

  const { status, data } = await upload(
    client,
    {
      components,
      ...(bookConfig
        ? { bookConfig: { filename: bookConfig.filename, source: bookConfig.source } }
        : {}),
    },
    dryRun,
  );

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
  if (extras.length > 0) {
    lines.push("");
    lines.push(`! ${extras.length} file(s) on disk not listed in ${MANIFEST_NAME} (skipped):`);
    for (const n of extras) lines.push(`    - ${n}`);
    lines.push(`  add them to ${MANIFEST_NAME} or remove them to silence this warning.`);
  }
  if (data.bookConfig?.ok) {
    lines.push(`> ${data.bookConfig.filename}  ${dryRun ? "(dry-run) ok" : "ok"}`);
  }
  lines.push(`\n${results.length - failed}/${results.length} succeeded${dryRun ? " (dry-run)" : ""}`);

  if (failed > 0) {
    fail(json, { dryRun, results, extras }, lines, 3);
  }
  emit(json, { dryRun, results, extras }, lines);
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

/**
 * Recursively collect component names (by basename) for any `.tsx`/`.jsx`
 * files anywhere under `root`. Used to warn about files not declared in the
 * manifest. Subdirectories are purely authoring layout; names are flat.
 */
async function collectNames(root: string): Promise<Set<string>> {
  const out = new Set<string>();
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "dist") continue;
        await walk(join(dir, e.name));
        continue;
      }
      if (!e.isFile()) continue;
      if (e.name === MANIFEST_NAME) continue;
      if (isComponentTestFilename(e.name)) continue;
      const ext = extname(e.name);
      if (!SOURCE_EXTS.includes(ext as SourceExt)) continue;
      out.add(basename(e.name, ext));
    }
  };
  await walk(root);
  return out;
}

function isAllowedExt(p: string): boolean {
  return SOURCE_EXTS.includes(extname(p) as SourceExt);
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
