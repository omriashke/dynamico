# Dynamico

Runtime React renderer that loads components from a directory and updates them
live, on **web** (React DOM) and **Expo** (React Native), without rebuilding the
host app.

![architecture](diagrams/architecture.svg)

## What it does

1. You write plain `.tsx` files in a dedicated directory.
2. A small CLI watches the directory and uploads each file to a registry server.
3. The registry compiles `.tsx` → JS once with Babel and stores it.
4. Host apps (web or Expo) connect to the registry over HTTP + WebSocket. They
   fetch the latest compiled JS for each component, evaluate it via
   `new Function(...)`, and render the result.
5. When a file changes, the registry pushes the new version over the WebSocket.
   The host app hot-swaps the component in place.

The same `.tsx` file can render on web or Expo — what differs is which host
primitives the runtime exposes via the host scope.

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
diagrams/
  architecture.d2    source for the diagram above
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

Set `EXPO_PUBLIC_DYNAMICO_REGISTRY` if your registry isn't on `localhost:4000`
(your phone won't be able to reach `localhost` on your laptop — use the LAN IP,
e.g. `http://192.168.1.5:4000`).

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
- **No persistence or auth.** The registry is in-memory and open. Front it
  with whatever auth you use today; v2 can add token-scoped channels.
- **TypeScript types are stripped, not checked.** Do type-checking in your CI
  before uploading.
- **No CSS bundling.** Use inline styles, `StyleSheet`, or pass styled
  components in via `scope`.
- **No code splitting per component.** Each upload is a single file.
- **App Store guideline 4.7.** Shipping a registry-driven runtime to a
  consumer App Store app is a gray area. For internal/enterprise apps and
  EAS-Update-style flows it's a fit; review your distribution model.

## Architecture diagram

The diagram at `diagrams/architecture.svg` is rendered from
`diagrams/architecture.d2` with TALA:

```bash
D2_LAYOUT=tala d2 diagrams/architecture.d2 diagrams/architecture.svg
```
