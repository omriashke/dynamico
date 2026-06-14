# syntax=docker/dockerfile:1.7
#
# Dynamico Book — Vite frontend + tiny Node static server (runtime-config.js, SPA fallback).
#
#   docker build -f packages/book/Dockerfile -t omriashkenazi/dynamico-book:latest .

ARG NODE_VERSION=23-slim
ARG PNPM_VERSION=10.30.3

# ---- Build the Vite app -------------------------------------------------------
FROM node:${NODE_VERSION} AS builder

ARG PNPM_VERSION=10.30.3

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@${PNPM_VERSION}

WORKDIR /dynamico

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages/book/package.json packages/book/
COPY packages/core/package.json packages/core/
COPY packages/web/package.json packages/web/
COPY examples/book-host/package.json examples/book-host/

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter book-host...

COPY packages/book packages/book
COPY packages/core packages/core
COPY packages/web packages/web
COPY examples/book-host examples/book-host

RUN pnpm --filter @omriashke/dynamico-core build \
 && pnpm --filter @omriashke/dynamico-web build \
 && pnpm --filter @omriashke/dynamico-book build

WORKDIR /dynamico/examples/book-host
ENV DYNAMICO_BOOK_BASE=/book/
RUN pnpm build

# ---- Serve static assets ------------------------------------------------------
FROM node:${NODE_VERSION} AS runner

WORKDIR /app

COPY --from=builder /dynamico/examples/book-host/dist ./dist
COPY --from=builder /dynamico/packages/book/dist/server ./server

RUN printf '%s\n' \
  '{' \
  '  "type": "module",' \
  '  "dependencies": {' \
  '    "fastify": "^5.2.1",' \
  '    "@fastify/static": "^8.1.0"' \
  '  }' \
  '}' > package.json \
 && npm install --omit=dev

ENV NODE_ENV=production \
    PORT=6006 \
    DYNAMICO_BOOK_DIST=/app/dist

EXPOSE 6006

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/bin.js"]
