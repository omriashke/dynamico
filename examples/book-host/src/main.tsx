import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DynamicoBook, loadRuntimeConfig } from '@omriashke/dynamico-book';
import '@omriashke/dynamico-book/styles.css';
import { dynamicoScope } from './scope';

const runtime = loadRuntimeConfig();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DynamicoBook
      registryUrl={runtime.registryUrl ?? '/api/dynamico'}
      scope={dynamicoScope}
      basePath={runtime.basePath ?? import.meta.env.BASE_URL}
      pollMs={runtime.pollMs}
      auth={runtime.auth}
    />
  </StrictMode>,
);
