import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * In-memory record of what bare specifiers the host app's DynamicoProvider
 * currently exposes. The host POSTs its scope keys on boot via /scope; the
 * registry uses that list to validate future pushes.
 *
 * Persisted to <sourceDir>/.dynamico-scope.json so a registry restart doesn't
 * lose the cache before the app reconnects. The file is rewritten atomically.
 */
export interface ScopeReport {
  /** Bare specifier names available via require() at runtime. */
  keys: string[];
  /** Free-form client identifier (e.g. 'apps/app' or a host name). */
  reportedBy?: string;
  /** Unix epoch millis. */
  reportedAt: number;
}

export class ScopeCache {
  private current: ScopeReport | null = null;
  private readonly path: string;

  constructor(sourceDir: string) {
    this.path = join(sourceDir, ".dynamico-scope.json");
    this.load();
  }

  /** Current cached scope, or null if no host has reported yet. */
  get(): ScopeReport | null {
    return this.current;
  }

  /** Get just the keys list, or undefined when nothing has been reported. */
  getKeys(): readonly string[] | undefined {
    return this.current?.keys;
  }

  /**
   * Replace the cached scope. Keys are deduped + sorted to make the value
   * trivially comparable across restarts and across clients.
   */
  set(report: { keys: string[]; reportedBy?: string }): ScopeReport {
    const dedup = Array.from(new Set(report.keys.filter((k) => typeof k === "string" && k.length > 0)));
    dedup.sort();
    this.current = {
      keys: dedup,
      ...(report.reportedBy ? { reportedBy: report.reportedBy } : {}),
      reportedAt: Date.now(),
    };
    this.persist();
    return this.current;
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const raw = readFileSync(this.path, "utf8");
      const parsed = JSON.parse(raw) as ScopeReport;
      if (Array.isArray(parsed?.keys) && parsed.keys.every((k) => typeof k === "string")) {
        this.current = parsed;
      }
    } catch {
      /* Corrupt cache file; ignore and start fresh. The next app boot will repopulate. */
    }
  }

  private persist(): void {
    if (!this.current) return;
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      writeFileSync(this.path, JSON.stringify(this.current, null, 2) + "\n", "utf8");
    } catch {
      /* Best-effort persistence: the cache is still valid in-memory. */
    }
  }
}
