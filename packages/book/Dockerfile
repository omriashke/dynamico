# syntax=docker/dockerfile:1.7
#
# Newscast Dynamico Book — static host with @newscast/utils-app-ui scope.
# Clones the newscast monorepo at build time for app-ui sources only.

ARG NODE_VERSION=23-slim
ARG PNPM_VERSION=10.30.3
ARG NEWSCAST_REPO=https://github.com/omriashke/newscast.git
ARG NEWSCAST_REF=versions/0.0.4

FROM node:${NODE_VERSION} AS builder

ARG PNPM_VERSION=10.30.3
ARG NEWSCAST_REPO=https://github.com/omriashke/newscast.git
ARG NEWSCAST_REF

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g pnpm@${PNPM_VERSION}

WORKDIR /newscast
RUN git clone --depth 1 --branch ${NEWSCAST_REF} ${NEWSCAST_REPO} .

WORKDIR /dynamico

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages/book/package.json packages/book/
COPY packages/core/package.json packages/core/
COPY packages/web/package.json packages/web/
COPY examples/newscast-book-host/package.json examples/newscast-book-host/

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile \
      --filter newscast-book-host... \
      --filter @omriashke/dynamico-book...

COPY packages/book packages/book
COPY packages/core packages/core
COPY packages/web packages/web
COPY examples/newscast-book-host examples/newscast-book-host

RUN pnpm --filter @omriashke/dynamico-core build \
 && pnpm --filter @omriashke/dynamico-web build \
 && pnpm --filter @omriashke/dynamico-book build

WORKDIR /dynamico/examples/newscast-book-host

ENV DYNAMICO_BOOK_BASE=/book/ \
    NEWSCAST_ROOT=/newscast

RUN pnpm build

FROM node:${NODE_VERSION} AS runner

WORKDIR /app

RUN npm install -g @omriashke/dynamico-book@0.1.2

COPY --from=builder /dynamico/examples/newscast-book-host/dist ./dist

ENV NODE_ENV=production \
    PORT=6006 \
    DYNAMICO_BOOK_DIST=/app/dist

EXPOSE 6006

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["dynamico-book"]
