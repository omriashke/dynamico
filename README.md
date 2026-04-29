# Dynamico

Runtime React renderer that loads components from a directory and updates them
live, on **web** (React DOM) and **Expo** (React Native), without rebuilding the
host app.

## What it does

1. The registry server owns a directory of `.tsx` files plus a
   `components.json` manifest — **disk is the source of truth**.
2. A CLI (`dynamico`) lets humans and agents `push` (write), `pull` (read,
   source or compiled), `list`, `search`, and `rm` components.
3. The registry compiles `.tsx` → JS with Babel (after a TypeScript
   syntax/sanity pass) and keeps the compiled artifact in memory. A
   filesystem watcher recompiles on every change — from the API or from
   someone editing the file directly.
4. Host apps (web or Expo) connect over HTTP + WebSocket. They fetch
   compiled JS and evaluate it via `new Function(...)`.
5. Any change to a source file triggers a WebSocket broadcast. Host apps
   hot-swap (or unload) in place. No rebuild, no restart.

Because source lives on the server, an agent can **pull the current source,
edit it, and push it back** — a real update loop without hand-keeping local
copies.

The same `.tsx` file can render on web or Expo; what differs is which host
primitives the runtime exposes via the host scope.

## Contents

- [Concepts in 60 seconds](#concepts-in-60-seconds)
- [Quick start](#quick-start)
- [Run the registry with Docker](#run-the-registry-with-docker)
- [Source storage and the manifest](#source-storage-and-the-manifest)
- [CLI](#cli) — `push`, `pull`, `list`, `search`, `rm`, `dev`
- [Cursor skill](#cursor-skill) — one-liner install so the agent learns the CLI
- [Public API](#public-api)
- [Authoring components](#authoring-components)
- [Error handling](#error-handling)
- [How web and Expo share one core](#how-web-and-expo-share-one-core)
- [Limitations / v2 roadmap](#limitations--v2-roadmap)

## Repo layout

```
packages/
  core/              @dynamico/core            renderer-agnostic registry, loader, source adapter, runtime factory
  web/               @dynamico/web             React-DOM runtime (Provider, DynamicComponent) + default scope
  native/            @dynamico/native          React-Native / Expo runtime
  cli/               @dynamico/cli             watches a dir and uploads to a registry
  registry-server/   @dynamico/registry-server reference HTTP+WS server: compile, store, broadcast
examples/
  components/        web-flavored .tsx files (Hello, Counter, Card)
  components-native/ RN-flavored .tsx files (HelloNative, CounterNative)
  web-host/          Vite + React app consuming the registry
  expo-host/         Expo app consuming the registry
```

## Concepts in 60 seconds

- **Compile** — `.tsx` → plain JS, done once on the **server** with Babel
  (preset-typescript, preset-react classic runtime, preset-env to commonjs).
  Clients never run Babel.
- **Eval** — clients run the compiled JS via
  `new Function("module", "exports", "require", code)`. The `require` we hand
  in is the only way the dynamic code can reach the outside world.
- **Host scope** — the object backing `require(name)`. The web runtime exposes
  `{ react }`. The native runtime exposes `{ react, "react-native" }`. The
  host can extend it with design-system components or hooks via
  `<DynamicoProvider scope={{...}}>`.
- **Cross-component imports** — `import Other from "./Other"` inside a dynamic
  component is rewritten to `require("./Other")`. The loader resolves it
  through the registry, so `Other` is itself a hot-swappable dynamic component.
- **Hot swap** — every component has a content-hash `version`. The
  `DynamicComponent` re-mounts when the version changes (`key={name@version}`).

## Quick start

Install dependencies (uses pnpm workspaces):

```bash
pnpm install
pnpm build
```

Run the registry, the CLI watcher, and the web host in three terminals:

```bash
pnpm --filter @dynamico/registry-server dev
pnpm --filter @dynamico/cli dev -- dev examples/components --registry http://localhost:4000
pnpm --filter web-host dev
```

Open `http://localhost:5173`. Edit `examples/components/Hello.tsx` —
the page updates without a refresh.

For Expo (after the registry is running, with components-native pushed):

```bash
pnpm --filter @dynamico/cli dev -- dev examples/components-native --registry http://localhost:4000
pnpm --filter expo-host start
```

## Run the registry with Docker

A production-shaped image lives at `packages/registry-server/Dockerfile`. It's
multi-stage (alpine, non-root, ~150 MB compressed) and uses `pnpm deploy` to
ship only the prod deps.

Build + run the local stack:

```bash
docker compose up --build         # uses ./docker-compose.yml
# or, image-only:
docker build -f packages/registry-server/Dockerfile -t dynamico/registry-server:dev .
docker run --rm -p 4000:4000 -e DYNAMICO_TOKEN=secret dynamico/registry-server:dev
```

Configuration is via env vars (see [DOCKER.md](packages/registry-server/DOCKER.md)
for the full reference): `PORT`, `HOST`, `DYNAMICO_TOKEN`, `DYNAMICO_BASIC_USER`
+ `DYNAMICO_BASIC_PASSWORD`, `DYNAMICO_ALLOW_IPS`, `DYNAMICO_SOURCE_DIR`. The
image declares `VOLUME /data/components` and defaults `DYNAMICO_SOURCE_DIR` to
that path; mount a host directory there and your components survive restarts:

```bash
docker run --rm -p 4000:4000 \
  -v $PWD/components:/data/components \
  -e DYNAMICO_TOKEN=secret \
  dynamico/registry-server:latest
```

The image also ships with a `HEALTHCHECK` against `/health`, so it works with
orchestrators out of the box.

## Source storage and the manifest

When the server is started with `DYNAMICO_SOURCE_DIR`, **disk is the source of
truth**. The directory contains:

```
<source dir>/
├── components.json       # manifest maintained by the server
├── Hello.tsx
├── Counter.tsx
└── PrimaryButton.tsx
```

`components.json`:

```json
{
  "version": 1,
  "components": {
    "Hello":         { "path": "Hello.tsx",         "description": "Simple greeting" },
    "Counter":       { "path": "Counter.tsx",       "description": "Clickable counter, optional initial value" },
    "PrimaryButton": { "path": "PrimaryButton.tsx", "description": "Blue call-to-action button" }
  }
}
```

Every source change — whether it came from `dynamico push`, from editing a
file directly in the mounted volume, or from `git pull` into that volume —
goes through the same path: a filesystem watcher recompiles and broadcasts
over WebSocket. You never hand-edit `components.json`; the server keeps it in
sync with reality.

Consequences:

- **`push` is a write.** The CLI `POST /upload`s the source; the server
  writes `<name>.tsx`, upserts the manifest entry, waits briefly for the
  watcher to compile, and returns the result.
- **`pull --source`** returns the actual source file contents plus the
  manifest entry — so an agent can read → edit → push without keeping local
  state.
- **`search`** is a ranked text query over names and descriptions, powered by
  the manifest.
- **`rm`** deletes the file and the manifest entry, and broadcasts a removal
  event to clients so they unload the component.

The server **requires** `DYNAMICO_SOURCE_DIR` to start. It exits immediately
if it isn't set.

## CLI

The `dynamico` CLI talks to the registry HTTP API. It's the recommended
interface for both humans and agents — every command supports `--json` for
machine-readable output, returns deterministic exit codes, and surfaces
TypeScript diagnostics with file/line/column when source code is broken.

### Install

```bash
npm install -g @dynamico/cli
# or, in this monorepo, run it directly:
pnpm --filter @dynamico/cli build
node packages/cli/dist/bin.js --help
```

### Subcommands

```
dynamico push <name>   [--source <path> | --stdin | --dir <path>]
                       [--description <text>] [--dry-run] [--json]
dynamico pull <name>   [--source] [--out <path>] [--json]
dynamico list          [--json]
dynamico search <query> [--json]
dynamico rm <name>     [--json]
dynamico dev <dir>     # watch a directory and auto-push on save
dynamico skill install # install the Cursor skill (see below)
```

Common flags (every subcommand):

| Flag                  | Default                        | Purpose                              |
| --------------------- | ------------------------------ | ------------------------------------ |
| `--registry <url>`    | `$DYNAMICO_REGISTRY` or `:4000` | Registry base URL                   |
| `--token <token>`     | `$DYNAMICO_TOKEN`              | Bearer token (`Authorization: Bearer ...`) |
| `--user <name>`       | `$DYNAMICO_USER`               | HTTP basic auth username             |
| `--password <pwd>`    | `$DYNAMICO_PASSWORD`           | HTTP basic auth password             |
| `--json`              | off                            | Emit JSON to stdout                  |

Exit codes:

| Code | Meaning                                                                              |
| ---- | ------------------------------------------------------------------------------------ |
| 0    | success                                                                              |
| 1    | client/usage error (missing arg, file not found, network)                            |
| 2    | registry rejected the call (auth, 4xx, 5xx)                                          |
| 3    | source failed validation (compile or typecheck) — diagnostics in stderr/stdout       |

### `push` — upload a component

```bash
# happy path: reads ./Hello.tsx
dynamico push Hello --token $TOKEN

# with a description (indexed by `search`; always set one for new components)
dynamico push Hello --description "Simple greeting component" --token $TOKEN

# explicit path
dynamico push Hello --source ./src/components/Hello.tsx --token $TOKEN

# from stdin (handy for agents)
cat Hello.tsx | dynamico push Hello --stdin --token $TOKEN

# bulk upload a whole directory in one request
dynamico push _ --dir ./src/components --token $TOKEN

# server-side validation only — does NOT write or store
dynamico push Hello --dry-run --json --token $TOKEN
```

When validation fails, the CLI prints classic compiler-style diagnostics:

```
x Broken  typecheck: typecheck failed
Broken.tsx:5:1 - error TS1381: Unexpected token. Did you mean `{'}'}` or `&rbrace;`?
   5 | }
     | ^
```

In `--json` mode the same information is structured as `{error: { kind, message, diagnostics: [{line, column, code, message, snippet}] }}` — designed for an agent to read, fix, and retry.

### `pull` — fetch live source or compiled JS

```bash
# default: compiled JS (what clients actually evaluate)
dynamico pull Hello                          # prints compiled JS to stdout
dynamico pull Hello --out ./snapshot.js      # writes to a file

# with --source: the original .tsx (requires DYNAMICO_SOURCE_DIR on the server)
dynamico pull Hello --source                 # prints .tsx to stdout
dynamico pull Hello --source --out Hello.tsx # writes to a file
dynamico pull Hello --source --json          # envelope: { name, path, source, description, version }
```

The source variant is the agent's read path for an **edit-existing** loop:

```bash
dynamico pull Counter --source --out Counter.tsx
$EDITOR Counter.tsx
dynamico push Counter --source Counter.tsx --dry-run --json  # validate
dynamico push Counter --source Counter.tsx                    # commit
```

### `list`

```bash
dynamico list
# Hello         f2b81d91a4fdba43   ok   Simple greeting
# Counter       abc1234567890abcd  ok   Clickable counter, optional initial value
```

The description column is populated from `components.json`.

### `search` — ranked text match over names and descriptions

```bash
dynamico search button
# PrimaryButton   (score  77) Blue call-to-action button
# Counter         (score   5) Clickable counter, optional initial value

dynamico search "counter initial" --json
# {"query":"counter initial","hits":[{"name":"Counter","description":"...","score":32}]}
```

Exact name match > name prefix > name substring > name tokens > description
tokens.

### `rm`

```bash
dynamico rm Hello
# removed Hello
```

The server broadcasts a removal event over the WebSocket; live clients unload
the component immediately.

### Server auth

The reference server enables auth when any of these are set:

```bash
# bearer token
DYNAMICO_TOKEN=secret123 pnpm --filter @dynamico/registry-server start

# HTTP basic
DYNAMICO_BASIC_USER=alice DYNAMICO_BASIC_PASSWORD=wonderland \
  pnpm --filter @dynamico/registry-server start

# IP allow-list (comma-separated; matches with or without ::ffff: prefix)
DYNAMICO_ALLOW_IPS=10.0.0.5,10.0.0.6 \
  pnpm --filter @dynamico/registry-server start
```

Multiple methods can be combined; a request is allowed if it satisfies any
configured method (e.g. internal hosts skip auth via the allow-list, external
agents must present a token). `/health` is always public.

Set `EXPO_PUBLIC_DYNAMICO_REGISTRY` if your registry isn't on `localhost:4000`
(your phone won't be able to reach `localhost` on your laptop — use the LAN IP,
e.g. `http://192.168.1.5:4000`).

## Cursor skill

If you use Cursor, install the bundled Dynamico skill so the agent knows the
CLI's subcommands, flags, exit codes, and authoring rules for dynamic
components — no copying from this README.

```bash
npx @dynamico/cli skill install
# or, if @dynamico/cli is installed globally:
dynamico skill install
```

The command copies a single `SKILL.md` into `~/.cursor/skills/dynamico/`.
Flags:

| Flag               | Purpose                                                          |
| ------------------ | ---------------------------------------------------------------- |
| `--target <dir>`   | Install elsewhere, e.g. `--target .cursor/skills/dynamico` to make it a project skill committed to git. |
| `--force`          | Overwrite an existing `SKILL.md` without prompting.              |
| `--json`           | Emit `{installed, source, target}` for scripting.                |

Reload Cursor after installing. Skill content is also viewable in the package
at `packages/cli/skill/SKILL.md`.

## Public API

```tsx
// web
import {
  DynamicoProvider,
  DynamicComponent,
  createRemoteSource,
} from "@dynamico/web";

// expo
import {
  DynamicoProvider,
  DynamicComponent,
  createRemoteSource,
} from "@dynamico/native";

const source = createRemoteSource({ url: "http://localhost:4000" });

function App() {
  return (
    <DynamicoProvider source={source} scope={{ "@my/ds": MyDesignSystem }}>
      <DynamicComponent
        name="Counter"
        props={{ initial: 5, label: "clicks" }}
        fallback={<Spinner />}
        errorFallback={({ error }) => <ErrorView error={error} />}
      />
    </DynamicoProvider>
  );
}
```

## Authoring components

A dynamic component is a regular React file with a default export. Optionally
declare a `propsSchema` for runtime validation:

```tsx
import * as React from "react";

export const propsSchema = {
  initial: { type: "number", required: false },
  label: { type: "string", required: false },
} as const;

export default function Counter({
  initial = 0,
  label = "count",
}: {
  initial?: number;
  label?: string;
}) {
  const [n, setN] = React.useState(initial);
  return <button onClick={() => setN(n + 1)}>{label}: {n}</button>;
}
```

Rules in v1:

- Only imports the host scope provides (e.g. `react`, `react-native`,
  anything you registered) plus relative imports of other dynamic files.
- Props must be JSON-serializable (primitives, arrays, plain objects).
  Functions/components live in `scope`.

## Error handling

`<DynamicComponent>` wraps the dynamic subtree in an error boundary and
surfaces three failure kinds via `errorFallback`:

- `compile` — server-side Babel error (component never ran).
- `load` — client-side eval error (e.g. `require("foo")` not in scope).
- `render` — the component threw at render time, or its props failed schema validation.

The fallback receives `{ kind, name, version, message, stack? }` and resets
automatically when a new version arrives — so once you fix the source the UI
recovers without restarting the host app.

## How web and Expo share one core

`@dynamico/core` exports `createRuntime(defaultScope)` which returns a
`{ DynamicoProvider, DynamicComponent, useDynamico }` triple built against any
scope. Both `@dynamico/web` and `@dynamico/native` are 12-line wrappers that
call `createRuntime` with their respective default scope. There is **no** code
that knows about React-DOM specifically; React on Hermes/RN works the same way.

The compiler emits classic-runtime JSX (`React.createElement(...)`) instead of
the automatic runtime, so dynamic code only needs `react` in scope on every
platform — no `react/jsx-runtime` plumbing differences between web and Hermes.

## Hermes spike

The plan called for an on-device experiment confirming `new Function(...)`
works in Hermes before committing to native. We chose the configuration that
maximizes Hermes compatibility (preset-env to `modules: "commonjs"`, classic
JSX runtime), which is the same pattern Hermes uses internally for OTA-style
updates. If you find a Hermes target where `new Function` is disabled, the
fallback is a data-mode interpreter — the `Source`/`Registry` interfaces would
remain unchanged, only `loader.ts` would be replaced.

## Limitations / v2 roadmap

- **Sandboxing.** v1 trusts the registry. v2 should run dynamic code in a
  Worker (web) or a separate JSC realm (RN) and post props/state across the
  boundary.
- **No persistence.** The registry is in-memory; restarting drops every
  component. Wire `Store` to a database for production.
- **Auth is bearer/basic/IP — no users, roles, or rotation.** Suitable for
  trusted agents and internal tools. v2: token-scoped channels per component.
- **Single-file typecheck.** The server typechecks each upload in isolation —
  syntax errors and basic mistakes are caught, but cross-file/library type
  errors against your host's `@types` aren't (the server doesn't have them).
  Run `tsc --noEmit` against your sources in CI for that.
- **No CSS bundling.** Use inline styles, `StyleSheet`, or pass styled
  components in via `scope`.
- **No code splitting per component.** Each upload is a single file.
- **App Store guideline 4.7.** Shipping a registry-driven runtime to a
  consumer App Store app is a gray area. For internal/enterprise apps and
  EAS-Update-style flows it's a fit; review your distribution model.
