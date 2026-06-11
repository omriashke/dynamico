# omriashkenazi/dynamico-book

Docker image for the Newscast Dynamico Book component catalog. Serves a static
host with the Newscast app-ui scope; `book.config.json` and components come from
the Dynamico registry at runtime.

## TL;DR

```bash
docker run --rm -p 6006:6006 \
  -e DYNAMICO_REGISTRY_URL=http://localhost:4000 \
  omriashkenazi/dynamico-book:latest
```

Behind nginx (Newscast local/dev):

```yaml
dynamicobook:
  image: omriashkenazi/dynamico-book:latest
  environment:
    DYNAMICO_REGISTRY_URL: /api/dynamico
    DYNAMICO_TOKEN: ${DYNAMICO_TOKEN}
    NEWSCAST_API_KEY: ${NEWSCAST_API_KEY}
```

## Configuration

All runtime settings are environment variables. The server exposes them to the
browser via `GET /runtime-config.js` (loaded before the app bundle).

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `PORT` | `6006` | HTTP listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `DYNAMICO_BOOK_DIST` | bundled `dist/` | Path to built static assets |
| `DYNAMICO_REGISTRY_URL` | `/api/dynamico` | Registry base URL for the browser (relative or absolute) |
| `DYNAMICO_REGISTRY_PROXY` | *(none)* | When set, book server proxies `/api/dynamico/*` to this upstream (e.g. `http://dynamico-registry:4000`) |
| `DYNAMICO_TOKEN` | *(none)* | Bearer token sent to the registry (client + proxy) |
| `DYNAMICO_API_KEY` | *(none)* | `x-api-key` header for registry (alias: `NEWSCAST_API_KEY`) |
| `DYNAMICO_BOOK_POLL_MS` | `2000` | How often to poll `book-config` |
| `DYNAMICO_BOOK_BASE` | *(none)* | Base path for URL sync (usually set at build: `/book/`) |

### Newscast stack (nginx handles registry)

Use a same-origin registry URL — nginx routes `/api/dynamico` to
`dynamico-registry`:

```yaml
environment:
  DYNAMICO_REGISTRY_URL: /api/dynamico
  DYNAMICO_TOKEN: ${DYNAMICO_TOKEN}
  NEWSCAST_API_KEY: ${NEWSCAST_API_KEY}
```

Do **not** set `DYNAMICO_REGISTRY_PROXY` when nginx already proxies the registry.

### Standalone (no nginx)

Option A — browser talks to registry directly:

```bash
docker run --rm -p 6006:6006 \
  -e DYNAMICO_REGISTRY_URL=http://host.docker.internal:4000 \
  -e DYNAMICO_TOKEN=secret \
  omriashkenazi/dynamico-book:latest
```

Option B — book server proxies the registry:

```bash
docker run --rm -p 6006:6006 \
  -e DYNAMICO_REGISTRY_URL=/api/dynamico \
  -e DYNAMICO_REGISTRY_PROXY=http://dynamico-registry:4000 \
  -e DYNAMICO_TOKEN=secret \
  omriashkenazi/dynamico-book:latest
```

## Build & publish

```bash
cd dynamico
gcloud builds submit --config packages/book/cloudbuild.yaml .
```

Or locally:

```bash
docker build -f packages/book/Dockerfile -t omriashkenazi/dynamico-book:dev .
```

## License

Apache 2.0
