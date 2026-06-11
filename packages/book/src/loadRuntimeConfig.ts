import type { BookRuntimeConfig } from './types.js';

declare global {
  interface Window {
    __DYNAMICO_BOOK_CONFIG__?: BookRuntimeConfig;
  }
}

/** Runtime settings injected by `dynamico-book` from container env (`/runtime-config.js`). */
export function loadRuntimeConfig(): BookRuntimeConfig {
  if (typeof window === 'undefined') return {};
  return window.__DYNAMICO_BOOK_CONFIG__ ?? {};
}
