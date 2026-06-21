#!/usr/bin/env bash
# End-to-end push-gate test against a local Node registry (NODE_ENV=production).
# Usage: ./scripts/test-local-registry.sh [port]
set -euo pipefail

PORT="${1:-4001}"
REGISTRY="http://localhost:${PORT}"
NEWSCAST="${NEWSCAST_ROOT:-$HOME/Development/newscast}"
SRC_DIR="/tmp/dynamico-local-test/components"
BROKEN_DIR="/tmp/dynamico-broken-test"
DYNAMICO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

export DYNAMICO_REGISTRY="$REGISTRY"
export PATH="$DYNAMICO_ROOT/packages/cli/node_modules/.bin:${PATH:-}"

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; exit 1; }

wait_for_health() {
  for _ in $(seq 1 30); do
    if curl -sf "$REGISTRY/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.2
  done
  fail "registry not healthy at $REGISTRY"
}

report_scope() {
  curl -sf -X POST "$REGISTRY/scope" \
    -H 'Content-Type: application/json' \
    -d '{"keys":["@newscast/utils-app-ui","@newscast/app-auth","@newscast/app-hooks","@newscast/app-components","@newscast/app-constants","react","react-native","react-native-safe-area-context"],"reportedBy":"local-test"}' \
    >/dev/null
}

push_json() {
  local name="$1"
  local source="$2"
  dynamico push "$name" --source "$source" --json 2>&1
}

assert_push_ok() {
  local label="$1"
  local json="$2"
  if echo "$json" | python3 -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if not d.get('error') else 1)"; then
    pass "$label"
  else
    echo "$json" | python3 -m json.tool
    fail "$label"
  fi
}

echo "Registry: $REGISTRY (parent NODE_ENV should be production)"
wait_for_health
report_scope

mkdir -p "$BROKEN_DIR"
cp /tmp/registry-pull/ProfileScreen.tsx "$BROKEN_DIR/ProfileScreen.tsx" 2>/dev/null || true

echo ""
echo "1) Good ProfileScreen"
OUT=$(push_json ProfileScreen "$NEWSCAST/dynamico/expo/screens/ProfileScreen.tsx")
assert_push_ok "good ProfileScreen accepts" "$OUT"

echo ""
echo "2) TopicChip (await render)"
OUT=$(push_json TopicChip "$NEWSCAST/dynamico/expo/ui/TopicChip/TopicChip.tsx")
assert_push_ok "TopicChip accepts" "$OUT"

echo ""
echo "3) Broken ProfileScreen (currentColors) — seed files then revalidate"
mkdir -p "$SRC_DIR"
if [[ -f "$BROKEN_DIR/ProfileScreen.tsx" ]]; then
  cp "$BROKEN_DIR/ProfileScreen.tsx" "$SRC_DIR/ProfileScreen.tsx"
  report_scope

  sleep 1
  STATE=$(curl -sf "$REGISTRY/component/ProfileScreen" | python3 -c "
import sys,json
d=json.load(sys.stdin)
err=d.get('error',{})
print(err.get('message','OK'))
")
  if echo "$STATE" | grep -qE 'currentColors|not defined'; then
    pass "broken ProfileScreen stored as error ($STATE)"
  else
    fail "broken ProfileScreen should be rejected on disk, got: $STATE"
  fi
else
  echo "SKIP  broken ProfileScreen test (no /tmp/registry-pull/ProfileScreen.tsx)"
fi

echo ""
echo "4) Restore good ProfileScreen after broken seed"
OUT=$(push_json ProfileScreen "$NEWSCAST/dynamico/expo/screens/ProfileScreen.tsx")
assert_push_ok "good ProfileScreen restores" "$OUT"

echo ""
echo "All local registry tests passed."
