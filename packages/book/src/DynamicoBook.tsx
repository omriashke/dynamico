import { useEffect, useMemo, useState } from 'react';
import { DynamicoProvider, createRemoteSource } from '@omriashke/dynamico-web';
import { bookConfigUrl, createBookConfigClient, findEntry, sidebarSections } from './config.js';
import { BookEntryCanvas, entryCanvasStyle } from './render.js';
import { useBookEntrySelection } from './useBookEntrySelection.js';
import type { BookConfig, DynamicoBookProps } from './types.js';

const DEFAULT_REGISTRY = '/api/dynamico';

function registryHeaders(auth?: DynamicoBookProps['auth']): Record<string, string> {
  const headers: Record<string, string> = {};
  if (auth?.token) headers.Authorization = `Bearer ${auth.token}`;
  if (auth?.apiKey) headers['x-api-key'] = auth.apiKey;
  return headers;
}

export function DynamicoBook({
  registryUrl = DEFAULT_REGISTRY,
  scope,
  source: externalSource,
  auth,
  pollMs = 2000,
  syncUrl = true,
  urlMode = 'hash',
  basePath = '/',
  autoSelectFirst = false,
}: DynamicoBookProps) {
  const [config, setConfig] = useState<BookConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  const source = useMemo(
    () =>
      externalSource ??
      createRemoteSource({
        url: registryUrl,
        headers: () => registryHeaders(auth),
      }),
    [externalSource, registryUrl, auth?.token, auth?.apiKey],
  );

  useEffect(() => {
    const client = createBookConfigClient({
      registryUrl,
      pollMs,
      headers: () => registryHeaders(auth),
      onUpdate: (next) => {
        setConfig(next);
        setError(null);
      },
      onError: (err) => setError(err.message),
    });
    client.start();
    return () => client.stop();
  }, [registryUrl, pollMs, auth?.token, auth?.apiKey]);

  const sections = useMemo(() => (config ? sidebarSections(config) : []), [config]);
  const allIds = useMemo(() => sections.flatMap((s) => s.entries), [sections]);
  const [selectedId, selectEntry] = useBookEntrySelection({
    entryIds: allIds,
    syncUrl,
    urlMode,
    basePath,
    autoSelectFirst,
  });

  const entry = config && selectedId ? findEntry(config, selectedId) : undefined;
  const fixtures = (config?.fixtures ?? {}) as Record<string, Record<string, import('./types.js').JsonObject>>;
  const sidebarWidth = config?.sidebar?.width ?? 240;

  return (
    <DynamicoProvider source={source} scope={scope}>
      <div className="db-root">
        <header className="db-header">
          <div className="db-brand">
            <span className="db-brand-mark">◆</span>
            <span className="db-brand-title">{config?.title ?? 'Dynamico Book'}</span>
          </div>
          <div className="db-header-meta">
            <span className={`db-status ${error ? 'db-status-error' : config ? 'db-status-ok' : ''}`} />
            <code className="db-registry-url">{bookConfigUrl(registryUrl)}</code>
          </div>
        </header>

        <div className="db-body">
          <aside className="db-sidebar" style={{ width: sidebarWidth }}>
            {loadingState(config, error)}
            {sections.map((section) => (
              <div key={section.label ?? 'default'} className="db-sidebar-section">
                {section.label ? <div className="db-sidebar-heading">{section.label}</div> : null}
                <ul className="db-sidebar-list">
                  {section.entries.map((id) => {
                    const item = config ? findEntry(config, id) : undefined;
                    const active = id === selectedId;
                    return (
                      <li key={id}>
                        <button
                          type="button"
                          className={`db-sidebar-item${active ? ' db-sidebar-item-active' : ''}`}
                          onClick={() => selectEntry(id)}
                        >
                          <span className="db-sidebar-item-id">{id}</span>
                          {item?.label ? (
                            <span className="db-sidebar-item-label">{item.label}</span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </aside>

          <main className="db-canvas">
            {entry ? (
              <div style={entryCanvasStyle(entry)}>
                <BookEntryCanvas
                  entry={entry}
                  fixtures={fixtures}
                  registryUrl={registryUrl}
                  providers={config?.providers ?? []}
                />
              </div>
            ) : (
              <div className="db-empty">Select an entry from the sidebar</div>
            )}
          </main>
        </div>
      </div>
    </DynamicoProvider>
  );
}

function loadingState(config: BookConfig | null, error: string | null) {
  if (error && !config) {
    return <div className="db-sidebar-error">{error}</div>;
  }
  if (!config) {
    return <div className="db-sidebar-loading">Loading config…</div>;
  }
  return null;
}
