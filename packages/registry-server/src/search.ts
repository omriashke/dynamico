export interface SearchableEntry {
  name: string;
  description: string;
}

export interface SearchHit extends SearchableEntry {
  score: number;
}

/**
 * Score a query against an entry.
 *
 * Heuristics, in decreasing weight:
 *   - Exact name match                    (score: 100)
 *   - Query is a prefix of the name       (score: 80)
 *   - Query is a substring of the name    (score: 60)
 *   - Each query token found in name      (+12 per token)
 *   - Each query token found in desc      (+5 per token, capped)
 *
 * This is deliberately simple — not semantic search — but it's enough to
 * make `dynamico search button` surface "PrimaryButton", "ButtonGroup",
 * etc. ahead of components whose *descriptions* mention buttons in passing.
 * If we add embeddings later, the callsite stays the same; we just swap the
 * scoring implementation.
 */
export function searchEntries(query: string, entries: SearchableEntry[]): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries.map((e) => ({ ...e, score: 0 }));
  const tokens = q.split(/\s+/).filter(Boolean);

  const hits: SearchHit[] = [];
  for (const e of entries) {
    const n = e.name.toLowerCase();
    const d = e.description.toLowerCase();
    let score = 0;
    if (n === q) score += 100;
    else if (n.startsWith(q)) score += 80;
    else if (n.includes(q)) score += 60;

    let tokenHitsInName = 0;
    let tokenHitsInDesc = 0;
    for (const t of tokens) {
      if (n.includes(t)) tokenHitsInName++;
      if (d.includes(t)) tokenHitsInDesc++;
    }
    score += tokenHitsInName * 12;
    score += Math.min(tokenHitsInDesc, 5) * 5;

    if (score > 0) hits.push({ ...e, score });
  }
  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return hits;
}
