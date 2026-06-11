export type JsonValue = string | number | boolean | null | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export interface BookSidebarSection {
  label?: string;
  entries: string[];
}

export interface BookSidebar {
  width?: number;
  sections?: BookSidebarSection[];
}

export interface BookConfig {
  version: number;
  title: string;
  sidebar?: BookSidebar;
  fixtures?: Record<string, JsonObject>;
  /** Primary entry list (preferred). */
  entries?: BookEntry[];
  /** Legacy alias — normalized to `entries` on load. */
  stories?: BookEntry[];
}

export interface BookEntry {
  id: string;
  label?: string;
  kind?: 'info';
  layout?: 'centered' | 'padded' | 'fullscreen';
  blocks?: BookBlock[];
}

export type BookBlock =
  | { type: 'component'; component: string; props?: JsonObject }
  | { type: 'stack'; width?: number; gap?: number; items: BookBlockItem[] }
  | { type: 'row'; gap?: number; align?: string; items: BookBlockItem[] }
  | {
      type: 'variantGrid';
      component: string;
      variants: Array<{ id: string; label?: string; props: JsonObject }>;
    };

export type BookBlockItem = { component: string; props?: JsonObject };

export interface BookAuthOptions {
  token?: string;
  apiKey?: string;
}

export interface BookRuntimeConfig {
  /** Registry base URL. Default `/api/dynamico` (same-origin via nginx or book proxy). */
  registryUrl?: string;
  auth?: BookAuthOptions;
  /** book.config.json poll interval in ms. Default 2000. */
  pollMs?: number;
  /** App base path when using path-based URL sync (e.g. `/book/`). */
  basePath?: string;
}

export interface DynamicoBookProps {
  /** Registry base URL. Defaults to same-origin `/api/dynamico`. */
  registryUrl?: string;
  /** Host scope passed to DynamicoProvider — the only host-specific wiring. */
  scope: import('@omriashke/dynamico-web').Scope;
  auth?: BookAuthOptions;
  /** Config poll interval in ms. Default 2000. */
  pollMs?: number;
  /**
   * Keep the selected sidebar entry in the URL so refresh and share links work.
   * @default true
   */
  syncUrl?: boolean;
  /**
   * `hash` → `/book/#NCArticleCard` — survives refresh without server rewrite rules.
   * `path` → `/book/NCArticleCard` (set `basePath` to match Vite `base`).
   * @default 'hash'
   */
  urlMode?: import('./entryUrl.js').BookEntryUrlMode;
  /** App base path when `urlMode` is `path` (e.g. `/book/`). */
  basePath?: string;
}
