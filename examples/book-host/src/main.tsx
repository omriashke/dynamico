/** Polyfill for react-native-web Animated JS fallback (Book runs in browser, not native). */
(globalThis as typeof globalThis & { global?: typeof globalThis }).global ??= globalThis;

import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DynamicoBook, loadRuntimeConfig } from '@omriashke/dynamico-book';
import '@omriashke/dynamico-book/styles.css';
import type { Scope } from '@omriashke/dynamico-web';
import { buildGenericBookScope, createRemoteSource, fetchBookConfigScopeKeys, fetchRegistryMetadata } from './scope';

const DEFAULT_SCOPE_KEYS = [
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

  const [scope, setScope] = useState<Scope | null>(null);
  const [scopeError, setScopeError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadScope() {
      try {
        const hdrs = registryHeaders(runtime);
        const [meta, configScopeKeys] = await Promise.all([
          fetchRegistryMetadata(registryUrl, hdrs),
          fetchBookConfigScopeKeys(registryUrl, hdrs),
        ]);
        const scopeKeys =
          meta.scopeKeys.length > 0
            ? meta.scopeKeys
            : configScopeKeys.length > 0
              ? configScopeKeys
              : DEFAULT_SCOPE_KEYS;
        const next = buildGenericBookScope(source, {
          scopeKeys,
          componentNames: meta.componentNames,
        });
        if (!cancelled) {
          setScope(next);
          setScopeError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setScopeError(err instanceof Error ? err.message : String(err));
          setScope(
            buildGenericBookScope(source, {
              scopeKeys: ['@dynamico/ui', '@newscast/app-auth', '@newscast/host'],
              componentNames: [],
            }),
          );
        }
      }
    }

    void loadScope();
    return () => {
      cancelled = true;
    };
  }, [source, registryUrl, runtime.auth?.token, runtime.auth?.apiKey]);

  if (!scope) {
    return (
      <div className="db-root">
        <div className="db-empty">Loading host scope…</div>
      </div>
    );
  }

  return (
    <>
      {scopeError ? (
        <div className="db-sidebar-error" style={{ padding: 8 }}>
          Scope warning: {scopeError}
        </div>
      ) : null}
      <DynamicoBook
        registryUrl={registryUrl}
        scope={scope}
        basePath={runtime.basePath ?? import.meta.env.BASE_URL}
        pollMs={runtime.pollMs}
        auth={runtime.auth}
      />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BookRoot />
  </StrictMode>,
);
