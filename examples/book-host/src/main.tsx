/** Polyfill for react-native-web Animated JS fallback (Book runs in browser, not native). */
(globalThis as typeof globalThis & { global?: typeof globalThis }).global ??= globalThis;

import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { DynamicoBook, loadRuntimeConfig } from '@omriashke/dynamico-book';
import '@omriashke/dynamico-book/styles.css';
import { buildBookScope, createRemoteSource } from './scope';

function BookRoot() {
  const runtime = loadRuntimeConfig();
  const registryUrl = runtime.registryUrl ?? '/api/dynamico';
  const source = useMemo(() => createRemoteSource({ url: registryUrl }), [registryUrl]);
  const scope = useMemo(() => buildBookScope(source), [source]);

  return (
    <DynamicoBook
      registryUrl={registryUrl}
      scope={scope}
      basePath={runtime.basePath ?? import.meta.env.BASE_URL}
      pollMs={runtime.pollMs}
      auth={runtime.auth}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BookRoot />
  </StrictMode>,
);
