import { deleteComponent } from "../client.js";
import { resolveCommon } from "../args.js";
import { emit, fail } from "../output.js";

export interface RmArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

/**
 * `dynamico rm <name>`
 *
 * Removes a component from the registry. The server broadcasts a removal
 * event over WS so live clients unload it immediately.
 */
export async function rm(args: RmArgs): Promise<void> {
  const common = resolveCommon(args.flags);
  const name = args.positional[0];
  if (!name) {
    fail(common.json, { error: "missing <name>" }, ["error: missing <name>; usage: dynamico rm <name>"]);
  }

  const { status, data } = await deleteComponent(common, name);
  if (status === 401 || status === 403) {
    fail(common.json, { status, error: "unauthorized" }, [`error: registry rejected credentials (${status})`], 2);
  }
  if (status === 404) {
    fail(common.json, data, [`error: '${name}' not found in registry`], 2);
  }
  if (status >= 400) {
    fail(common.json, { status, data }, [`error: registry returned ${status}`], 2);
  }

  emit(common.json, data, [`removed ${name}`]);
}
