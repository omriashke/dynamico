---
name: dynamico-release
description: >-
  Release Dynamico — bump versions, publish @omriashke npm packages, build and
  push omriashkenazi/dynamico-registry Docker image, redeploy on dev server,
  git tag, and install skills. Use when publishing dynamico, releasing registry,
  npm publish, docker push, redeploy registry, or cutting a version tag.
---

# Dynamico release

End-to-end release for the [dynamico](https://github.com/omriaskenazi/dynamico) monorepo.

Set a release version once (example **`0.1.9`**) and use it everywhere below.

**Always use `pnpm publish`, not `npm publish`.** Plain `npm publish` from a
package directory leaves `workspace:*` in the tarball (broken on npm) and
cannot republish an existing version.

## 0. Preflight

```bash
cd ~/Development/dynamico
git checkout main && git pull origin main
pnpm install
pnpm build
pnpm typecheck
```

Optional local gate before publish:

```bash
# registry auto-validate smoke (see scripts/test-local-registry.sh patterns)
PORT=4002 NODE_ENV=production DYNAMICO_SOURCE_DIR=/tmp/dynamico-test/components \
  node packages/registry-server/dist/bin.js &
# … push components without .test.tsx …
```

## 1. Bump versions

Edit `version` in each changed package (dependency order matters for publish):

| Package | Path | Example |
|---------|------|---------|
| `@omriashke/dynamico-core` | `packages/core/package.json` | `0.1.6` |
| `@omriashke/dynamico-validator` | `packages/dynamico-validator/package.json` | `0.1.9` |
| `@omriashke/dynamico-cli` | `packages/cli/package.json` | `0.1.4` |
| `@omriashke/dynamico-registry` | `packages/registry-server/package.json` | `0.1.9` |
| `@omriashke/dynamico-book` | `packages/book/package.json` | only if book changed |

Rebuild after bumps:

```bash
pnpm build
```

## 2. Publish npm packages (browser OTP)

Log in once — npm opens the browser for SSO / 2FA:

```bash
npm login
npm whoami
```

Publish in **dependency order** with pnpm (rewrites `workspace:*` → semver):

```bash
cd ~/Development/dynamico
pnpm build

pnpm --filter @omriashke/dynamico-core publish --access public --no-git-checks
pnpm --filter @omriashke/dynamico-validator publish --access public --no-git-checks
pnpm --filter @omriashke/dynamico-cli publish --access public --no-git-checks
# book only if changed:
# pnpm --filter @omriashke/dynamico-book publish --access public --no-git-checks
pnpm --filter @omriashke/dynamico-registry publish --access public --no-git-checks
```

Or one package:

```bash
pnpm --filter @omriashke/dynamico-cli publish --access public --no-git-checks
```

Verify:

```bash
npm view @omriashke/dynamico-core version
npm view @omriashke/dynamico-validator version
npm view @omriashke/dynamico-cli version
```

Global CLI update after publish:

```bash
npm install -g @omriashke/dynamico-cli@latest
dynamico --version
```

## 3. Build and push Docker image

Use **Docker Build Cloud** via `docker buildx` (or any multi-arch builder). List
builders with `docker buildx ls`; pick one that supports `linux/amd64` and
`linux/arm64` (Docker Build Cloud builders are named `cloud-<org>-<name>`).

```bash
docker buildx use "${DOCKER_BUILDX_BUILDER:?set to your cloud builder from docker buildx ls}"
```

**Registry image:**

```bash
cd ~/Development/dynamico
docker buildx use "${DOCKER_BUILDX_BUILDER:?set to your cloud builder}"

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --file packages/registry-server/Dockerfile \
  --tag omriashkenazi/dynamico-registry:0.1.9 \
  --tag omriashkenazi/dynamico-registry:latest \
  --push \
  .
```

**Book image** (only when book package changed):

```bash
cd ~/Development/dynamico
docker buildx use "${DOCKER_BUILDX_BUILDER:?set to your cloud builder}"

docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --file packages/book/Dockerfile \
  --tag omriashkenazi/dynamico-book:0.1.3 \
  --tag omriashkenazi/dynamico-book:latest \
  --push \
  .
```

Local-only fallback (single platform, no push):

```bash
docker buildx build \
  --platform linux/arm64 \
  --file packages/registry-server/Dockerfile \
  --tag omriashkenazi/dynamico-registry:dev \
  --load \
  .
```

## 4. Redeploy

On the host running your registry (compose, k8s, etc.):

```bash
docker compose pull dynamico-registry
docker compose up -d --no-deps dynamico-registry
docker compose ps dynamico-registry
```

Verify auto-validate is active (not legacy `runTest`):

```bash
docker exec <registry-container> grep runValidate /app/dist/validateWorker.js
curl -sS http://localhost:4000/health
```

## 5. Commit and push (git)

```bash
cd ~/Development/dynamico
git status
git add -A
git commit -m "$(cat <<'EOF'
Release 0.1.9: automatic push validation, drop author test files.

Registry runs runValidate (default props + book.config previews).
CLI no longer uploads .test.tsx.
EOF
)"
git push origin main
```

## 6. Git tag

```bash
cd ~/Development/dynamico
git tag -a v0.1.9 -m "dynamico-registry 0.1.9 — auto-validate push gate"
git push origin v0.1.9
```

## 7. Install Cursor skills

**Release skill** (this file — project-scoped):

```bash
mkdir -p ~/.cursor/skills/dynamico-release
cp ~/Development/dynamico/.cursor/skills/dynamico-release/SKILL.md \
   ~/.cursor/skills/dynamico-release/SKILL.md
```

**CLI skill** (bundled in npm package — push/pull workflow):

```bash
npm install -g @omriashke/dynamico-cli@latest
dynamico skill install --force
# or project-scoped:
dynamico skill install --target ~/Development/dynamico/.cursor/skills/dynamico-cli --force
```

Reload Cursor window after installing skills.

## Post-release smoke

```bash
export DYNAMICO_REGISTRY=http://localhost:4000
export DYNAMICO_TOKEN=your-bearer-token   # if auth is enabled

# Real push — NOT --dry-run (dry-run skips validation)
dynamico push MyButton --source path/to/MyButton.tsx

# Should fail scope check:
dynamico push BadScope --source /tmp/BadScope.tsx  # import from unknown package
```

## Notes

- **`--dry-run` only compiles** — it does not run auto-validate.
- **Docker `:latest` on deploy** — if compose pins `omriashkenazi/dynamico-registry:latest`, always push the `latest` tag with the version tag.
- **npm workspace** — publish from each `packages/*` directory, not the repo root (`private: true`).
- **Legacy test files on registry disk** — optional cleanup after deploy: remove stale `*.test.tsx` under the registry volume; they are no longer used.
