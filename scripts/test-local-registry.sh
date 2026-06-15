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
  local test="$3"
  dynamico push "$name" --source "$source" --test "$test" --json 2>&1
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

assert_push_rejected() {
  local label="$1"
  local json="$2"
  local pattern="${3:-.}"
  if echo "$json" | python3 -c "
import sys,re,json
d=json.load(sys.stdin)
msg=d.get('error',{}).get('message','')
if d.get('error') and re.search(r'''$pattern''', msg):
    sys.exit(0)
sys.exit(1)
"; then
    pass "$label ($(echo "$json" | python3 -c "import sys,json; print(json.load(sys.stdin)['error']['message'][:120])"))"
  else
    echo "$json" | python3 -m json.tool
    fail "$label"
  fi
}

echo "Registry: $REGISTRY (parent NODE_ENV should be production)"
wait_for_health
report_scope

mkdir -p "$BROKEN_DIR"
cp /tmp/registry-pull/ProfileScreen.tsx "$BROKEN_DIR/ProfileScreen.tsx"
cp "$NEWSCAST/dynamico/expo/screens/ProfileScreen.test.tsx" "$BROKEN_DIR/ProfileScreen.test.tsx"

echo ""
echo "1) Good ProfileScreen"
OUT=$(push_json ProfileScreen \
  "$NEWSCAST/dynamico/expo/screens/ProfileScreen.tsx" \
  "$NEWSCAST/dynamico/expo/screens/ProfileScreen.test.tsx")
assert_push_ok "good ProfileScreen accepts" "$OUT"

echo ""
echo "2) TopicChip (await render)"
OUT=$(push_json TopicChip \
  "$NEWSCAST/dynamico/expo/ui/TopicChip/TopicChip.tsx" \
  "$NEWSCAST/dynamico/expo/ui/TopicChip/TopicChip.test.tsx")
assert_push_ok "TopicChip accepts" "$OUT"

echo ""
echo "3) Broken ProfileScreen (currentColors) — seed files then revalidate"
mkdir -p "$SRC_DIR"
cp "$BROKEN_DIR/ProfileScreen.tsx" "$SRC_DIR/ProfileScreen.tsx"
cp "$BROKEN_DIR/ProfileScreen.test.tsx" "$SRC_DIR/ProfileScreen.test.tsx"
report_scope  # triggers revalidateAll against broken source on disk

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

echo ""
echo "4) Restore good ProfileScreen after broken seed"
OUT=$(push_json ProfileScreen \
  "$NEWSCAST/dynamico/expo/screens/ProfileScreen.tsx" \
  "$NEWSCAST/dynamico/expo/screens/ProfileScreen.test.tsx")
assert_push_ok "good ProfileScreen restores" "$OUT"

echo ""
echo "All local registry tests passed."
