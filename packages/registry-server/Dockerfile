# syntax=docker/dockerfile:1.7
#
# Multi-stage build for @omriashke/dynamico-registry.
#
# Stage 1 (builder): install the full pnpm workspace and compile every package
#   the registry depends on (which means @omriashke/dynamico-core too, since
#   it's a workspace dep). We also use `pnpm deploy` here to produce a flat,
#   self-contained directory with only the prod deps the server actually needs.
#
# Stage 2 (runner): a tiny non-root Node Alpine image that serves the deployed
#   bundle. No pnpm, no build tools, no source.

ARG NODE_VERSION=20.18.0
# Keep this in sync with packageManager in the root package.json.
ARG PNPM_VERSION=10.30.3

# ---- Stage 1: builder ---------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /repo

# Install pnpm directly. We avoid corepack here because older corepack bundles
# ship outdated signing keys, which makes `corepack enable` unreliable for
# fresh pnpm releases inside cached node base images.
RUN npm install -g pnpm@${PNPM_VERSION}

# Copy lockfile + workspace metadata first so dependency installation caches
# well across source changes.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/dynamico-validator/package.json packages/dynamico-validator/
COPY packages/registry-server/package.json packages/registry-server/

# Install only the workspace projects we need to build the server, with all
# devDeps (we need typescript / tsc to build).
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile \
      --filter @omriashke/dynamico-registry... \
      --filter @omriashke/dynamico-validator... \
      --filter @omriashke/dynamico-core

# Copy sources and build.
COPY packages/core/ packages/core/
COPY packages/dynamico-validator/ packages/dynamico-validator/
COPY packages/registry-server/ packages/registry-server/
RUN pnpm --filter @omriashke/dynamico-core build \
 && pnpm --filter @omriashke/dynamico-validator build \
 && pnpm --filter @omriashke/dynamico-registry build

# Produce a self-contained, prod-only deployment for the registry server.
# `pnpm deploy --legacy` resolves workspace deps (including
# @omriashke/dynamico-core) and writes everything into /out as a normal
# node_modules tree. The `--legacy` flag is required on pnpm >=10 unless
# you opt every workspace package into injected dependencies.
RUN pnpm deploy --legacy --filter=@omriashke/dynamico-registry --prod /out

# ---- Stage 2: runner ----------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0 \
    DYNAMICO_SOURCE_DIR=/data/components

# Drop privileges. node:alpine ships a `node` user (uid 1000).
COPY --from=builder --chown=node:node /out /app

# Create the default source directory with correct ownership so the `node`
# user can read + write when mounted as a volume. Users who mount a different
# path can override DYNAMICO_SOURCE_DIR at runtime.
RUN mkdir -p /data/components && chown -R node:node /data
VOLUME ["/data/components"]

USER node

EXPOSE 4000

# Healthcheck hits the always-public /health endpoint.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/bin.js"]
