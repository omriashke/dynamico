import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { patchMeta, replaceConfig, type ClientOptions, type ManifestShape } from "../client.js";
import { flagString, resolveCommon } from "../args.js";
import { emit, fail } from "../output.js";

export interface EditArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

/**
 * `dynamico edit` — two shapes:
 *
 *   dynamico edit <name> --description <text>
 *     Patch just one component's metadata. No source re-upload.
 *
 *   dynamico edit --config <path>
 *     Replace the entire dynamico.config.json. Entries missing from the file
 *     have their source files deleted on the registry side; descriptions and
 *     paths are overwritten. Designed for git-style full-file pushes.
 *
 * The two modes are mutually exclusive; passing `--config` without `<name>`
 * triggers the full-file flow.
 */
export async function edit(args: EditArgs): Promise<void> {
  const common = resolveCommon(args.flags);
  const client: ClientOptions = common;
  const configPath = flagString(args.flags, "config");

  if (configPath) {
    return editConfig(client, configPath, common.json);
  }

  const name = args.positional[0];
  if (!name) {
    fail(
      common.json,
      { error: "missing <name>" },
      [
        "error: missing <name>",
        "usage: dynamico edit <name> --description <text>",
        "       dynamico edit --config <path>",
      ],
    );
  }

  const description = flagString(args.flags, "description");
  if (description === undefined) {
    fail(
      common.json,
      { error: "nothing to edit" },
      [
        `error: no edit specified for '${name}'`,
        "pass --description <text> to update the component description.",
      ],
    );
  }

  const { status, data } = await patchMeta(client, name, { description });
  if (status === 401 || status === 403) {
    fail(common.json, { status, error: "unauthorized" }, [`error: registry rejected credentials (${status})`], 2);
  }
  if (status === 404) {
    fail(common.json, data, [`error: unknown component '${name}'`], 2);
  }
  if (status >= 400) {
    fail(common.json, data, [`error: registry returned ${status}: ${data.error ?? "unknown"}`], 2);
  }

  emit(common.json, data, [`> ${data.name}  description updated`]);
}

async function editConfig(client: ClientOptions, path: string, json: boolean): Promise<void> {
  const abs = resolve(path);
  let raw: string;
  try {
    raw = await readFile(abs, "utf8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(json, { error: msg, path: abs }, [`error: cannot read ${abs}: ${msg}`]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    fail(json, { error: "invalid JSON", message: msg, path: abs }, [`error: ${abs} is not valid JSON: ${msg}`]);
  }

  // Light client-side shape check so we don't have to round-trip an obvious
  // typo to the server.
  if (!parsed || typeof parsed !== "object") {
    fail(json, { error: "invalid manifest shape" }, [`error: ${abs} must be a JSON object`]);
  }
  const p = parsed as { version?: unknown; components?: unknown };
  if (!p.components || typeof p.components !== "object") {
    fail(json, { error: "missing components" }, [`error: ${abs} must have a "components" object`]);
  }

  const body: ManifestShape = {
    version: 1,
    components: Object.fromEntries(
      Object.entries(p.components as Record<string, unknown>).map(([name, entry]) => {
        const e = (entry ?? {}) as { path?: unknown; description?: unknown };
        return [
          name,
          {
            path: typeof e.path === "string" ? e.path : "",
            description: typeof e.description === "string" ? e.description : "",
          },
        ];
      }),
    ),
  };

  const { status, data } = await replaceConfig(client, body);
  if (status === 401 || status === 403) {
    fail(json, { status, error: "unauthorized" }, [`error: registry rejected credentials (${status})`], 2);
  }
  if (status === 422) {
    const lines = [`error: manifest validation failed`];
    for (const d of data.diagnostics ?? []) lines.push(`  - ${d}`);
    fail(json, data, lines, 3);
  }
  if (status >= 400) {
    fail(json, data, [`error: registry returned ${status}: ${data.error ?? "unknown"}`], 2);
  }

  const lines: string[] = [];
  const added = data.added ?? [];
  const removed = data.removed ?? [];
  const changed = data.changed ?? [];
  if (added.length) lines.push(`+ added:   ${added.join(", ")}`);
  if (changed.length) lines.push(`~ changed: ${changed.join(", ")}`);
  if (removed.length) lines.push(`- removed: ${removed.join(", ")}`);
  if (lines.length === 0) lines.push("manifest unchanged");
  lines.unshift(`> config replaced from ${abs}`);

  emit(json, data, lines);
}
