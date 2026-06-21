import type { BookConfig, BookEntry, BookSidebarSection } from './types.js';
import { normalizeBookPreviewConfig } from '@omriashke/dynamico-core';

export function normalizeBookConfig(raw: BookConfig): BookConfig {
  return normalizeBookPreviewConfig(raw) as BookConfig;
}

export function sidebarSections(config: BookConfig): BookSidebarSection[] {
  if (config.sidebar?.sections?.length) {
    return config.sidebar.sections;
  }
  const entries = config.entries ?? [];
  return [{ label: 'Catalog', entries: entries.map((e) => e.id) }];
}

export function findEntry(config: BookConfig, id: string): BookEntry | undefined {
  return (config.entries ?? []).find((entry) => entry.id === id);
}

export interface BookConfigClientOptions {
  registryUrl: string;
  headers?: () => Record<string, string>;
  pollMs?: number;
  onUpdate?: (config: BookConfig) => void;
  onError?: (error: Error) => void;
}

export function bookConfigUrl(registryUrl: string): string {
  return `${registryUrl.replace(/\/$/, '')}/book-config`;
}

export function createBookConfigClient(options: BookConfigClientOptions) {
  let etag: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function fetchConfig(): Promise<BookConfig | null> {
    const headers: Record<string, string> = { ...(options.headers?.() ?? {}) };
    if (etag) headers['If-None-Match'] = etag;

    const res = await fetch(bookConfigUrl(options.registryUrl), {
      headers,
      cache: 'no-store',
    });
    if (res.status === 304) return null;
    if (!res.ok) {
      throw new Error(`book-config returned ${res.status}`);
    }
    const nextEtag = res.headers.get('etag');
    if (nextEtag) etag = nextEtag;
    return normalizeBookConfig((await res.json()) as BookConfig);
  }

  async function refresh(): Promise<void> {
    try {
      const config = await fetchConfig();
      if (config) options.onUpdate?.(config);
    } catch (err) {
      options.onError?.(err instanceof Error ? err : new Error(String(err)));
    }
  }

  return {
    start() {
      void refresh();
      timer = setInterval(() => void refresh(), options.pollMs ?? 2000);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    refresh,
  };
}
