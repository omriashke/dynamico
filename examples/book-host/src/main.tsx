/** Polyfill for react-native-web Animated JS fallback (Book runs in browser, not native). */
(globalThis as typeof globalThis & { global?: typeof globalThis }).global ??= globalThis;

import { useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { DynamicoBook, loadRuntimeConfig } from '@omriashke/dynamico-book';
import '@omriashke/dynamico-book/styles.css';
import { buildGenericBookScope, createRemoteSource } from './scope';

/** Matches `book.config.json` scopeKeys — no registry fetch needed to build host scope. */
const BOOK_SCOPE_KEYS = [
  '@dynamico/ui',
  '@newscast/app-auth',
  '@newscast/host',
  '@react-native-async-storage/async-storage',
  'libphonenumber-js',
];

function registryHeaders(runtime: ReturnType<typeof loadRuntimeConfig>): Record<string, string> {
  const headers: Record<string, string> = {};
  if (runtime.auth?.token) headers.Authorization = `Bearer ${runtime.auth.token}`;
  if (runtime.auth?.apiKey) headers['x-api-key'] = runtime.auth.apiKey;
  return headers;
}

function BookRoot() {
  const runtime = loadRuntimeConfig();
  const registryUrl = runtime.registryUrl ?? '/api/dynamico';
  const source = useMemo(
    () =>
      createRemoteSource({
        url: registryUrl,
        headers: () => registryHeaders(runtime),
      }),
    [registryUrl, runtime.auth?.token, runtime.auth?.apiKey],
  );

  const scope = useMemo(
    () =>
      buildGenericBookScope(source, {
        scopeKeys: BOOK_SCOPE_KEYS,
      }),
    [source],
  );

  return (
    <DynamicoBook
      registryUrl={registryUrl}
      source={source}
      scope={scope}
      basePath={runtime.basePath ?? import.meta.env.BASE_URL}
      pollMs={runtime.pollMs}
      auth={runtime.auth}
      autoSelectFirst={false}
    />
  );
}

createRoot(document.getElementById('root')!).render(<BookRoot />);
