# omriashkenazi/dynamico-book

Docker image for the Dynamico Book component catalog. Serves a generic web
host; `book.config.json` and components come from the Dynamico registry at
runtime via env-configured registry URL.

Consumer apps (e.g. Newscast) only need to run this image and point nginx at
it — no checkout of the consumer repo is involved in the build.

## TL;DR

```bash
docker run --rm -p 6006:6006 \
  -e DYNAMICO_REGISTRY_URL=http://localhost:4000 \
  omriashkenazi/dynamico-book:latest
```

Behind a reverse proxy:

```yaml
dynamicobook:
  image: omriashkenazi/dynamico-book:latest
  environment:
    DYNAMICO_REGISTRY_URL: /api/dynamico
    DYNAMICO_TOKEN: ${DYNAMICO_TOKEN}
```

## Configuration

Runtime settings are environment variables, exposed to the browser via
`GET /runtime-config.js`.

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `PORT` | `6006` | HTTP listen port |
| `DYNAMICO_BOOK_DIST` | bundled `dist/` | Static assets path |
| `DYNAMICO_REGISTRY_URL` | `/api/dynamico` | Registry URL for the browser |
| `DYNAMICO_REGISTRY_PROXY` | *(none)* | Book server proxies `/api/dynamico/*` here |
| `DYNAMICO_TOKEN` | *(none)* | Bearer token for registry auth |
| `DYNAMICO_API_KEY` | *(none)* | `x-api-key` header (alias: `NEWSCAST_API_KEY`) |
| `DYNAMICO_BOOK_POLL_MS` | `2000` | `book-config` poll interval |
| `DYNAMICO_BOOK_BASE` | *(none)* | Base path for URL sync (build default: `/book/`) |

## Build & publish

```bash
cd dynamico
docker build -f packages/book/Dockerfile -t omriashkenazi/dynamico-book:dev .
gcloud builds submit --config packages/book/cloudbuild.yaml .
```

## License

Apache 2.0
