/** Defaults and env parsing for the book static server (Docker / production). */

export interface BookRuntimeConfig {
  registryUrl?: string;
  pollMs?: number;
  basePath?: string;
}

export const DEFAULT_REGISTRY_URL = '/api/dynamico';

export function runtimeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BookRuntimeConfig {
  const config: BookRuntimeConfig = {};

  const registryUrl = env.DYNAMICO_REGISTRY_URL?.trim();
  if (registryUrl) config.registryUrl = registryUrl.replace(/\/$/, '');

  const pollMs = env.DYNAMICO_BOOK_POLL_MS?.trim();
  if (pollMs && !Number.isNaN(Number(pollMs))) config.pollMs = Number(pollMs);

  const basePath = env.DYNAMICO_BOOK_BASE?.trim();
  if (basePath) config.basePath = basePath;

  return config;
}

export function runtimeConfigScript(config: BookRuntimeConfig): string {
  return `window.__DYNAMICO_BOOK_CONFIG__=${JSON.stringify(config)};`;
}

export function proxyAuthHeaders(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = env.DYNAMICO_TOKEN?.trim();
  const apiKey = (env.DYNAMICO_API_KEY ?? env.NEWSCAST_API_KEY)?.trim();
  if (token) headers.authorization = `Bearer ${token}`;
  if (apiKey) headers['x-api-key'] = apiKey;
  return headers;
}
