# omriashkenazi/dynamico-registry

Reference Docker image for the [Dynamico](https://github.com/omriaskenazi/dynamico)
runtime React component registry.

The registry compiles `.tsx` / `.jsx` / `.ts` / `.js` to portable JS, owns a
directory of source files on disk as the source of truth, exposes an HTTP +
WebSocket API, and broadcasts updates to connected clients (web and Expo) so
they hot-swap components live.

> **Status:** v0 reference image. Disk-backed: mount a volume at
> `/data/components` and components (and their metadata) survive restarts.
> Suitable for development, internal tools, and small production deployments.

## TL;DR

```bash
# pull and run, open registry, no auth (development only)
docker run --rm -p 4000:4000 \
  -v $PWD/components:/data/components \
  omriashkenazi/dynamico-registry:latest

# with bearer-token auth
docker run --rm -p 4000:4000 \
  -v $PWD/components:/data/components \
  -e DYNAMICO_TOKEN=$(openssl rand -hex 32) \
  omriashkenazi/dynamico-registry:latest
```

Test it:

```bash
curl http://localhost:4000/health
# {"ok":true}
```

## Tags

| Tag       | Meaning                                                  |
| --------- | -------------------------------------------------------- |
| `latest`  | Latest stable release                                    |
| `0.x.y`   | Specific semantic version (recommended for production)   |
| `0.x`     | Latest patch within a minor                              |
| `main`    | Bleeding edge from `main` branch (not recommended)       |

The image is published for `linux/amd64` and `linux/arm64`.

## Configuration

All configuration is via environment variables.

### Network

| Variable | Default     | Description                                    |
| -------- | ----------- | ---------------------------------------------- |
| `PORT`   | `4000`      | TCP port to listen on                          |
| `HOST`   | `0.0.0.0`   | Bind address                                   |

### Source storage

| Variable              | Default              | Description                                                                 |
| --------------------- | -------------------- | --------------------------------------------------------------------------- |
| `DYNAMICO_SOURCE_DIR` | `/data/components`   | **Required.** Directory holding `.tsx`/`.jsx` source + `dynamico.config.json`. |

Disk is the **source of truth**:

- `POST /upload` writes the `.tsx` file + upserts the manifest entry. The
  watcher compiles asynchronously and the response carries the result.
- Editing a file directly in the mounted volume (editor, `git pull`, rsync,
  etc.) triggers a recompile and a WebSocket broadcast — exactly as if the
  CLI had pushed.
- `GET /component/:name/source` returns the raw `.tsx` text so agents can
  read, edit, and push back without keeping local copies.
- `GET /search?q=<query>` runs ranked text search over names + descriptions.

If the directory doesn't exist the server exits with a startup error. The
image defaults to `/data/components` and declares a `VOLUME` there, so the
simplest usage is to mount a host directory in its place.

### Authentication (all opt-in)

The registry has three independent auth methods. Enable any combination — a
request is allowed if it satisfies **at least one** active method. `/health`
is always public so orchestrators can probe liveness.

| Variable                    | Effect                                                      |
| --------------------------- | ----------------------------------------------------------- |
| `DYNAMICO_TOKEN`            | Require `Authorization: Bearer <token>`                     |
| `DYNAMICO_BASIC_USER`       | Username for HTTP basic auth (must pair with the next)      |
| `DYNAMICO_BASIC_PASSWORD`   | Password for HTTP basic auth                                |
| `DYNAMICO_ALLOW_IPS`        | Comma-separated list of source IPs that bypass auth         |

If none of the above are set, the registry runs **open**. That's fine for a
laptop; do not do this in production.

Example: token + IP allow-list (CI bypasses auth on the corp VPN, agents
elsewhere must present a token):

```bash
docker run -d --name dynamico-registry \
  -p 4000:4000 \
  -e DYNAMICO_TOKEN=s3cret \
  -e DYNAMICO_ALLOW_IPS=10.0.0.0/8 \
  omriashkenazi/dynamico-registry:latest
```

> Note: v0 IP matching is **exact match only** (with handling for the
> `::ffff:` IPv4-on-IPv6 form). True CIDR support is on the roadmap; for now
> use a comma-separated list of explicit addresses, or front the registry
> with a reverse proxy that filters by CIDR.

## Endpoints

| Method | Path                        | Purpose                                                     |
| ------ | --------------------------- | ----------------------------------------------------------- |
| GET    | `/health`                   | Liveness probe (always public)                              |
| GET    | `/components`               | List components (name, version, description, status)         |
| GET    | `/component/:name`          | Fetch the latest `CompiledModule` for one                   |
| GET    | `/component/:name/source`   | Raw source + manifest entry                                 |
| GET    | `/search?q=<query>`         | Ranked name + description search                            |
| GET    | `/config`                   | Current `dynamico.config.json`                              |
| POST   | `/upload`                   | Upload one or many components; optional `description`       |
| POST   | `/upload?dryRun=true`       | Compile + validate without writing or storing               |
| PATCH  | `/component/:name`          | Metadata-only update (currently `description`)              |
| PUT    | `/config`                   | Replace the entire manifest (drops = deletions, validated)  |
| DELETE | `/component/:name`          | Remove a component (broadcasts a removal)                   |
| WS     | `/subscribe`                | Stream every change as `CompiledModule` JSON                |

The CLI [`@omriashke/dynamico-cli`](https://www.npmjs.com/package/@omriashke/dynamico-cli) wraps
all of these — that's the recommended way for humans and agents to interact
with the registry. See the README for `push`, `pull`, `list`, `search`,
`edit`, `rm`, and the flag reference.

## Healthcheck

The image ships with a Docker `HEALTHCHECK` that hits `/health` every 30s. It
will mark the container as `unhealthy` after three consecutive failures. The
endpoint is auth-free so you don't need to inject credentials into the probe.

## Volumes & persistence

The image declares `VOLUME /data/components` and defaults
`DYNAMICO_SOURCE_DIR` to that path. Mount a host directory (or a named
volume) there and components survive restarts — the watcher rehydrates the
store from disk on startup.

```bash
docker run -d --name dynamico-registry \
  -p 4000:4000 \
  -v $PWD/components:/data/components \
  -e DYNAMICO_TOKEN=secret \
  omriashkenazi/dynamico-registry:latest
```

The files inside the volume are just `.tsx`/`.jsx` alongside a single
`dynamico.config.json` manifest owned by the server. You can keep them in a
git repo, mount a Kubernetes `ConfigMap`, or edit them with a normal editor.
Every change triggers a recompile + broadcast.

Subdirectories under the source dir are fine — they're authoring layout.
**Component names stay flat**: the registry key is the file's basename, so
`forms/Counter.tsx` is served as `Counter`. Two files with the same basename
in different folders cause a startup error, by design.

Recognized source extensions: `.tsx`, `.jsx`, `.ts`, `.js`. Anything else in
the directory is ignored by the watcher.

### Manifest shape (`dynamico.config.json`)

```json
{
  "version": 1,
  "components": {
    "Hello": {
      "path": "Hello.tsx",
      "description": "Simple greeting component"
    }
  }
}
```

You never need to hand-edit this file — `push`, `rm`, and the watcher keep
it in sync — but it's plain JSON if you want to inspect it.

## docker-compose example

```yaml
services:
  registry:
    image: omriashkenazi/dynamico-registry:latest
    ports:
      - "4000:4000"
    volumes:
      - ./components:/data/components
    environment:
      DYNAMICO_TOKEN: ${DYNAMICO_TOKEN}
    restart: unless-stopped
```

```bash
DYNAMICO_TOKEN=$(openssl rand -hex 32) docker compose up -d
```

## Talking to the registry

From the CLI:

```bash
DYNAMICO_TOKEN=s3cret \
DYNAMICO_REGISTRY=http://localhost:4000 \
  dynamico push Hello --source ./src/Hello.tsx
```

From a web/Expo host app:

```ts
import { createRemoteSource } from "@omriashke/dynamico-web"; // or @omriashke/dynamico-native

const source = createRemoteSource({
  url: "http://localhost:4000",
  // pass a header function if you need auth on the WS handshake too:
  headers: () => ({ authorization: `Bearer ${TOKEN}` }),
});
```

## Building from source

```bash
git clone https://github.com/omriaskenazi/dynamico.git
cd dynamico
docker build -f packages/registry-server/Dockerfile -t omriashkenazi/dynamico-registry:dev .
```

The build is multi-stage:

1. **builder** installs the pnpm workspace, builds `@omriashke/dynamico-core` and
   `@omriashke/dynamico-registry`, then runs `pnpm deploy` to materialize a
   self-contained `node_modules`.
2. **runner** is `node:20-alpine`, runs as the unprivileged `node` user,
   contains only the deployed bundle (no source, no pnpm, no build tools).

Final image is roughly 150 MB compressed.

## Security notes

- The image runs as **uid 1000** (`node`), not root.
- Only `/app` is writable to that user. There is no shell access intended for
  end users; if you need to debug, run with `--entrypoint sh` against a known
  digest.
- The compiler runs **untrusted source code through Babel** in the same
  process. Anyone who can `POST /upload` can crash or slow the server with
  pathological inputs. Always require auth on internet-facing deployments.
- The runtime on the *client* evaluates compiled code via `new Function(...)`.
  Treat your registry like a code-signing key: anyone who can push can run
  arbitrary code in every host app subscribed to it.

## License

[Apache 2.0](https://github.com/omriaskenazi/dynamico/blob/main/LICENSE).
