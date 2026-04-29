import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getComponent, getSource } from "../client.js";
import { flagBool, flagString, resolveCommon } from "../args.js";
import { emit, fail } from "../output.js";

export interface PullArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

/**
 * `dynamico pull <name>`
 *
 * Default: returns the *compiled* JS currently live for <name> (what runtime
 * clients are actually evaluating). With --source, returns the raw .tsx text
 * — this is the agent's main read path for editing existing components.
 *
 * Flags:
 *   --source       Return the original .tsx instead of compiled JS.
 *   --out <path>   Write the result to a file.
 *   --json         Return the full response envelope.
 */
export async function pull(args: PullArgs): Promise<void> {
  const common = resolveCommon(args.flags);
  const name = args.positional[0];
  if (!name) {
    fail(common.json, { error: "missing <name>" }, [
      "error: missing <name>; usage: dynamico pull <name> [--source] [--out <path>]",
    ]);
  }
  const out = flagString(args.flags, "out");
  const asSource = flagBool(args.flags, "source");

  if (asSource) return pullSource(common, name, out);
  return pullCompiled(common, name, out);
}

async function pullSource(
  common: ReturnType<typeof resolveCommon>,
  name: string,
  out: string | undefined,
): Promise<void> {
  const { status, data } = await getSource(common, name);
  if (status === 401 || status === 403) {
    fail(common.json, { status, error: "unauthorized" }, [`error: registry rejected credentials (${status})`], 2);
  }
  if (status === 404) {
    fail(common.json, data, [`error: '${name}' not found in registry`], 2);
  }
  if (status >= 400) {
    fail(common.json, { status, data }, [`error: registry returned ${status}`], 2);
  }
  if (common.json) {
    emit(true, data, []);
    return;
  }
  const source = "source" in data ? data.source : undefined;
  if (!source) {
    fail(common.json, data, [`error: no source available for '${name}'`], 3);
  }
  if (out) {
    const path = resolve(out);
    await writeFile(path, source, "utf8");
    process.stderr.write(`pulled ${name} source -> ${path}\n`);
  } else {
    process.stdout.write(source);
    if (!source.endsWith("\n")) process.stdout.write("\n");
  }
}

async function pullCompiled(
  common: ReturnType<typeof resolveCommon>,
  name: string,
  out: string | undefined,
): Promise<void> {
  const { status, data } = await getComponent(common, name);
  if (status === 401 || status === 403) {
    fail(common.json, { status, error: "unauthorized" }, [`error: registry rejected credentials (${status})`], 2);
  }
  if (status === 404) {
    fail(common.json, data, [`error: '${name}' not found in registry`], 2);
  }
  if (status >= 400) {
    fail(common.json, { status, data }, [`error: registry returned ${status}`], 2);
  }
  if ("error" in data && data.error && typeof data.error === "object") {
    fail(common.json, data, [`error: '${name}' is in error state: ${(data.error as { message: string }).message}`], 3);
  }
  if (common.json) {
    emit(true, data, []);
    return;
  }
  const code = "code" in data ? data.code : undefined;
  if (!code) {
    fail(common.json, data, [`error: no code available for '${name}'`], 3);
  }
  if (out) {
    const path = resolve(out);
    await writeFile(path, code, "utf8");
    process.stderr.write(`pulled ${name} -> ${path}\n`);
  } else {
    process.stdout.write(code);
    if (!code.endsWith("\n")) process.stdout.write("\n");
  }
}
