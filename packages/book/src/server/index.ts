import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import {
  DEFAULT_REGISTRY_URL,
  proxyAuthHeaders,
  runtimeConfigFromEnv,
  runtimeConfigScript,
} from './envConfig.js';

export interface BookServerOptions {
  port?: number;
  host?: string;
  /** Directory with built Dynamico Book static assets (index.html). */
  distDir?: string;
  /** Optional registry proxy target, e.g. http://127.0.0.1:4000 */
  registryProxy?: string;
  /** Base path when served behind nginx, e.g. /book */
  basePath?: string;
}

function moduleDir(): string {
  return dirname(fileURLToPath(import.meta.url));
}

export async function createBookServer(options: BookServerOptions = {}) {
  const port = options.port ?? Number(process.env.PORT ?? 6006);
  const host = options.host ?? '0.0.0.0';
  const distDir = resolve(
    options.distDir ??
      process.env.DYNAMICO_BOOK_DIST ??
      join(moduleDir(), '../app'),
  );
  const basePath = (options.basePath ?? process.env.DYNAMICO_BOOK_BASE ?? '').replace(/\/$/, '');
  const registryProxy = (options.registryProxy ?? process.env.DYNAMICO_REGISTRY_PROXY ?? '').replace(
    /\/$/,
    '',
  );
  const runtimeConfig = runtimeConfigFromEnv();
  if (!runtimeConfig.registryUrl) {
    runtimeConfig.registryUrl = DEFAULT_REGISTRY_URL;
  }
  const upstreamAuth = proxyAuthHeaders();

  const app = Fastify({ logger: false });

  app.get('/runtime-config.js', async (_req, reply) => {
    reply
      .header('Cache-Control', 'no-store')
      .type('application/javascript')
      .send(runtimeConfigScript(runtimeConfig));
  });

  if (registryProxy) {
    app.all('/api/dynamico/*', async (req, reply) => {
      const suffix = req.url.replace(/^\/api\/dynamico/, '');
      const target = `${registryProxy}${suffix}`;
      const headers = new Headers();
      for (const [key, value] of Object.entries(upstreamAuth)) {
        headers.set(key, value);
      }
      for (const [key, value] of Object.entries(req.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
        else headers.set(key, value);
      }
      const res = await fetch(target, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : JSON.stringify(req.body),
      });
      reply.code(res.status);
      res.headers.forEach((value, key) => {
        if (key.toLowerCase() === 'transfer-encoding') return;
        reply.header(key, value);
      });
      const buf = Buffer.from(await res.arrayBuffer());
      return reply.send(buf);
    });
  }

  await app.register(fastifyStatic, {
    root: distDir,
    prefix: basePath ? `${basePath}/` : '/',
  });

  app.setNotFoundHandler((_req, reply) => {
    const indexPath = join(distDir, 'index.html');
    if (existsSync(indexPath)) {
      reply.type('text/html').send(readFileSync(indexPath, 'utf8'));
      return;
    }
    reply.code(404).send({ error: 'not found' });
  });

  await app.listen({ port, host });
  return app;
}

export function configEtag(body: string): string {
  return `"${createHash('md5').update(body).digest('hex')}"`;
}
