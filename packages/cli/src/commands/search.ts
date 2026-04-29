import { search } from "../client.js";
import { resolveCommon } from "../args.js";
import { emit, fail } from "../output.js";

export interface SearchArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

/**
 * `dynamico search <query>`
 *
 * Ranked text match over component name + description. The server does the
 * scoring so the agent gets a single round-trip that's already ordered
 * (exact name hits first, then prefixes, then substrings, then token
 * overlap in the description).
 *
 * Requires the server to be started with DYNAMICO_SOURCE_DIR; returns an
 * error (exit 2) otherwise.
 */
export async function searchCmd(args: SearchArgs): Promise<void> {
  const common = resolveCommon(args.flags);
  const query = args.positional.join(" ").trim();
  if (!query) {
    fail(common.json, { error: "missing <query>" }, [
      "error: missing <query>; usage: dynamico search <query>",
    ]);
  }

  const { status, data } = await search(common, query);
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

  const hits = "hits" in data ? data.hits : [];
  if (hits.length === 0) {
    emit(false, data, [`no matches for "${query}"`]);
    return;
  }
  const lines = hits.map(
    (h) => `${h.name.padEnd(24)} (score ${String(h.score).padStart(3)}) ${h.description}`,
  );
  emit(false, data, lines);
}
