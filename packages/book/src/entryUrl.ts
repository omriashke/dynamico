export type BookEntryUrlMode = 'hash' | 'path';

export interface BookEntryUrlOptions {
  mode: BookEntryUrlMode;
  /** Required when mode is 'path' (e.g. '/book/'). */
  basePath?: string;
}

function normalizeBasePath(basePath: string): string {
  if (!basePath || basePath === '/') return '/';
  return basePath.endsWith('/') ? basePath : `${basePath}/`;
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Find a catalog entry id in the current pathname (handles base-path mismatches). */
function readEntryFromPathname(
  pathname: string,
  basePath: string,
  validEntryIds?: readonly string[],
): string | null {
  const base = normalizeBasePath(basePath);
  const valid = validEntryIds?.length ? new Set(validEntryIds) : null;

  const trySegment = (segment: string | undefined): string | null => {
    if (!segment) return null;
    const id = decodeSegment(segment);
    if (!valid || valid.has(id)) return id;
    return null;
  };

  if (base !== '/' && pathname.startsWith(base)) {
    const fromBase = trySegment(pathname.slice(base.length).split('/').filter(Boolean)[0]);
    if (fromBase) return fromBase;
  }

  if (base === '/') {
    const fromRoot = trySegment(pathname.replace(/^\//, '').split('/').filter(Boolean)[0]);
    if (fromRoot) return fromRoot;
  }

  // e.g. pathname /book/NCArticleCard while Vite base is /
  if (valid) {
    const segments = pathname.split('/').filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
      const id = decodeSegment(segments[i]!);
      if (valid.has(id)) return id;
    }
  }

  return null;
}

export function readEntryFromUrl(
  options: BookEntryUrlOptions,
  validEntryIds?: readonly string[],
): string | null {
  if (options.mode === 'hash') {
    const raw = window.location.hash.replace(/^#\/?/, '').trim();
    if (raw) {
      const id = decodeSegment(raw);
      if (!validEntryIds?.length || validEntryIds.includes(id)) return id;
    }
    // Legacy path URLs (/book/NCArticleCard) before hash mode.
    if (validEntryIds?.length) {
      return readEntryFromPathname(
        window.location.pathname,
        options.basePath ?? '/',
        validEntryIds,
      );
    }
    return null;
  }

  return readEntryFromPathname(
    window.location.pathname,
    options.basePath ?? '/',
    validEntryIds,
  );
}

export function writeEntryToUrl(entryId: string, options: BookEntryUrlOptions): void {
  const encoded = encodeURIComponent(entryId);

  if (options.mode === 'hash') {
    const nextHash = `#${encoded}`;
    if (window.location.hash !== nextHash) {
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${window.location.search}${nextHash}`,
      );
    }
    return;
  }

  const base = normalizeBasePath(options.basePath ?? '/');
  const nextPath = `${base}${encoded}`;
  const current = `${window.location.pathname}${window.location.search}`;
  if (current !== nextPath) {
    history.replaceState(null, '', nextPath);
  }
}

export function subscribeEntryUrl(
  options: BookEntryUrlOptions,
  onChange: (entryId: string | null) => void,
  validEntryIds?: readonly string[],
): () => void {
  const handler = () => onChange(readEntryFromUrl(options, validEntryIds));
  if (options.mode === 'hash') {
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }
  window.addEventListener('popstate', handler);
  return () => window.removeEventListener('popstate', handler);
}
