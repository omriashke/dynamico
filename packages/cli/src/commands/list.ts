import { listComponents } from "../client.js";
import { resolveCommon } from "../args.js";
import { emit, fail } from "../output.js";

export interface ListArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

/**
 * `dynamico list`
 *
 * Lists every component currently in the registry: name, version, status,
 * and description (when the server tracks a source directory).
 *
 * In --json mode, returns the raw array (each entry omits the `code` field;
 * use `pull` to retrieve compiled JS).
 */
export async function list(args: ListArgs): Promise<void> {
  const common = resolveCommon(args.flags);

  const { status, data } = await listComponents(common);
  if (status === 401 || status === 403) {
    fail(common.json, { status, error: "unauthorized" }, [`error: registry rejected credentials (${status})`], 2);
  }
  if (status >= 400) {
    fail(common.json, { status, data }, [`error: registry returned ${status}`], 2);
  }

  if (common.json) {
    emit(true, data, []);
    return;
  }

  if (data.length === 0) {
    emit(false, data, ["(registry is empty)"]);
    return;
  }
  const lines: string[] = [];
  for (const m of data) {
    const status = (m as { error?: { message: string } }).error
      ? `ERROR: ${(m as { error: { message: string } }).error.message}`
      : "ok";
    const description = m.description ? `  ${m.description}` : "";
    lines.push(`${m.name.padEnd(24)} ${m.version.padEnd(18)} ${status.padEnd(10)}${description}`);
  }
  emit(false, data, lines);
}
