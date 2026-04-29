---
name: dynamico
description: Push, pull, list, search, and remove React components on a Dynamico runtime registry using the `dynamico` CLI. Use when the user wants to ship or update a live React component, edit an existing deployed component, find components by description, runs the Dynamico registry, mentions dynamico, @dynamico, a registry server at port 4000, or asks to upload .tsx files for hot-swapping on web or Expo.
---

# Dynamico CLI

Dynamico is a runtime React renderer. Components live as `.tsx` files and are hot-swapped into web or Expo host apps over WebSocket. The `dynamico` CLI is the primary interface for agents.

## Mental model

**The registry's source directory is the source of truth.** Every component exists as a source file on disk (`.tsx`, `.jsx`, `.ts`, or `.js`) plus an entry in `dynamico.config.json`. Any change — from the CLI or from disk directly — flows through the same watcher and broadcasts over WebSocket. The server requires `DYNAMICO_SOURCE_DIR` to start.

Subdirectories under the source dir are allowed as authoring layout, but **component names are flat**: the registry key is the file's basename (e.g. `forms/Button.tsx` registers as `Button`). Two files with the same basename in different folders are a startup error.

That means the agent can do a proper edit loop:
1. **Discover** — `dynamico search <keywords>` or `dynamico list` to find components.
2. **Read** — `dynamico pull <name> --source` to get the current `.tsx`.
3. **Modify** — edit the text.
4. **Validate** — `dynamico push <name> --source <file> --dry-run --json` to get structured diagnostics without writing.
5. **Commit** — `dynamico push <name> --source <file>` to write + broadcast.

## Subcommands

```
dynamico push <name> [--source <path> | --stdin | --dir <path>]
                     [--description <text>] [--dry-run] [--json]
dynamico pull <name> [--source] [--out <path>] [--json]
dynamico list [--json]
dynamico search <query> [--json]
dynamico edit <name> --description <text>            # metadata-only update
dynamico edit --config <path>                        # replace full dynamico.config.json
dynamico rm <name> [--json]
dynamico dev <dir>            # watch a directory and auto-push on save
dynamico skill install        # (re)install this skill
```

Common flags (every command): `--registry`, `--token`, `--user`, `--password`, `--json`. All can also be set via `DYNAMICO_REGISTRY`, `DYNAMICO_TOKEN`, `DYNAMICO_USER`, `DYNAMICO_PASSWORD`.

## Exit codes

| Code | Meaning                                                                     |
| ---- | --------------------------------------------------------------------------- |
| 0    | success                                                                     |
| 1    | client/usage error (missing arg, file not found, network)                   |
| 2    | registry rejected the call (auth, 4xx, 5xx)                                 |
| 3    | source failed validation (compile or typecheck)                             |

**Do NOT retry on exit 3 without fixing the source first.** Parse `error.diagnostics` from `--json` output.

## Key workflow: update an existing component

```bash
# 1. find the component
dynamico search "counter button"

# 2. pull its source
dynamico pull Counter --source --out Counter.tsx

# 3. edit Counter.tsx …

# 4. dry-run first, parse diagnostics on failure
dynamico push Counter --source Counter.tsx --dry-run --json

# 5. commit
dynamico push Counter --source Counter.tsx \
  --description "Clickable counter with optional initial value"
```

## Key workflow: create a new component

```bash
# write ./NewThing.tsx with a default export, then:
dynamico push NewThing --source NewThing.tsx \
  --description "What this component does and its key props"
```

Always include a `--description` for new components. It's what `dynamico search` indexes, and other agents (or humans) rely on it to find the component later.

## Bulk push: `--dir`

To push a whole directory, the directory **must** contain a `dynamico.config.json` at its root. This file is the contract for which components exist:

```json
{
  "version": 1,
  "components": {
    "Hello":   { "path": "Hello.tsx",            "description": "Greeting banner"    },
    "Counter": { "path": "forms/Counter.tsx",    "description": "Clickable counter"  }
  }
}
```

Rules:
- `path` is relative to the directory you're pushing and must end in `.tsx` or `.jsx`.
- Subfolders are fine; component names (the keys) are still flat.
- Missing files listed in the manifest → hard error (exit 1).
- `.tsx`/`.jsx` files on disk not listed in the manifest → printed as warnings, not pushed.

## Dry-run diagnostics format

When a push fails validation, the `--json` response looks like:

```json
{
  "error": {
    "kind": "typecheck",
    "diagnostics": [
      { "severity": "error", "line": 5, "column": 1, "code": "TS1381",
        "message": "...", "snippet": "}" }
    ]
  }
}
```

Edit the source at `{line}:{column}` and re-run. Repeat until exit 0.

## Edit metadata without re-uploading source

Use `dynamico edit` when the source file is unchanged but metadata isn't:

```bash
# Update just the description. No recompile, no broadcast.
dynamico edit Counter --description "New clearer description"

# Replace the whole dynamico.config.json (git-style). Entries dropped from the
# local file are DELETED on the registry (source files removed, clients get
# unload events). Validation is all-or-nothing — on failure nothing is written.
dynamico edit --config ./dynamico.config.json
```

When using `--config`, the file must list every component you want to keep.
Omission = deletion.

## Authoring rules

- **Must have a default export.** Missing default → code `DYN0001`.
- **Only import the host scope.** Web: `"react"`. Expo: `"react"` and `"react-native"`. Plus anything the host registered via `<DynamicoProvider scope={...}>`.
- **Relative imports resolve to other dynamic components.** `import Other from "./Other"` expects `Other` to exist in the registry; it's fetched lazily and hot-swapped independently.
- **Props must be JSON-serializable** (primitives, arrays, plain objects). Functions live in scope, not props.
- **Classic JSX runtime:** you must `import React from "react"` (or `import * as React`).
- **Optional:** export `const propsSchema = { ... } as const` for runtime prop validation. Keys map to `{ type: "string" | "number" | "boolean" | "object" | "array" | "any", required?: boolean }`.

## Minimal component template

```tsx
import React from "react";

export const propsSchema = {
  label: { type: "string", required: false },
} as const;

export default function MyComponent({ label = "hi" }: { label?: string }) {
  return <div>{label}</div>;
}
```

## Auth patterns

```bash
export DYNAMICO_TOKEN=...              # bearer token
dynamico push Hello --user alice --password wonderland  # HTTP basic
DYNAMICO_REGISTRY=https://... dynamico list             # remote registry
```

Exit 2 with `registry rejected credentials` means bad/missing token. Exit 2 with `registry returned 403` + the registry has IP allow-listing means the request came from an unallowed IP.

## Running the registry

If no registry is reachable:

```bash
# Docker, with persistent source volume
docker run --rm -p 4000:4000 \
  -v $PWD/components:/data/components \
  -e DYNAMICO_TOKEN=dev \
  dynamico/registry-server:latest
```

Or inside the Dynamico monorepo:

```bash
DYNAMICO_SOURCE_DIR=./components \
  pnpm --filter @omriaske/registry-server dev
```

The server exits with a startup error if `DYNAMICO_SOURCE_DIR` isn't set.

## When NOT to use this skill

- User asks about **React** in general, not Dynamico → answer without this skill.
- User wants a **static build** (Vite, Next, Expo prebuild) → Dynamico is runtime-only.
- User asks about **scaffolding** a React project (`create-react-app` / `create-vite`) → not relevant.
