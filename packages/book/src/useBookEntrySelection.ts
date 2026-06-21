import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  readEntryFromUrl,
  subscribeEntryUrl,
  writeEntryToUrl,
  type BookEntryUrlMode,
} from './entryUrl.js';

export interface UseBookEntrySelectionOptions {
  entryIds: string[];
  syncUrl: boolean;
  urlMode: BookEntryUrlMode;
  basePath?: string;
  /** When true, select the first entry once the catalog loads. Default false. */
  autoSelectFirst?: boolean;
}

export function useBookEntrySelection({
  entryIds,
  syncUrl,
  urlMode,
  basePath,
  autoSelectFirst = false,
}: UseBookEntrySelectionOptions): [string | null, (id: string) => void] {
  const urlOptions = useMemo(
    () => ({ mode: urlMode, basePath }),
    [urlMode, basePath],
  );
  const entryIdsKey = entryIds.join('\0');

  // Capture URL entry on first paint (before config loads) so refresh keeps selection.
  const initialUrlEntry = useRef<string | null>(
    syncUrl ? readEntryFromUrl(urlOptions) : null,
  );

  const [selectedId, setSelectedId] = useState<string | null>(() => initialUrlEntry.current);

  useEffect(() => {
    if (!syncUrl || entryIds.length === 0) return;
    return subscribeEntryUrl(
      urlOptions,
      (id) => {
        if (id && entryIds.includes(id)) setSelectedId(id);
      },
      entryIds,
    );
  }, [syncUrl, urlOptions, entryIdsKey, entryIds]);

  useEffect(() => {
    if (entryIds.length === 0) return;

    const fromUrl =
      syncUrl
        ? readEntryFromUrl(urlOptions, entryIds) ?? initialUrlEntry.current
        : null;

    if (fromUrl && entryIds.includes(fromUrl)) {
      setSelectedId(fromUrl);
      if (syncUrl) writeEntryToUrl(fromUrl, urlOptions);
      return;
    }

    setSelectedId((current) => {
      if (current && entryIds.includes(current)) {
        if (syncUrl) writeEntryToUrl(current, urlOptions);
        return current;
      }
      if (autoSelectFirst) {
        const fallback = entryIds[0] ?? null;
        if (syncUrl && fallback) writeEntryToUrl(fallback, urlOptions);
        return fallback;
      }
      return null;
    });
  }, [entryIdsKey, syncUrl, urlOptions, entryIds, autoSelectFirst]);

  const selectEntry = useCallback(
    (id: string) => {
      setSelectedId(id);
      if (syncUrl) writeEntryToUrl(id, urlOptions);
    },
    [syncUrl, urlOptions],
  );

  return [selectedId, selectEntry];
}
