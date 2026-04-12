#!/usr/bin/env bash
set -euo pipefail

# Local development script for @verdaccio/auth-ldap
# Builds the plugin, starts OpenLDAP + Verdaccio, verifies everything works,
# and authenticates a test user.

REGISTRY_URL="http://localhost:4873"
LDAP_USER="testuser"
LDAP_PASS="testpassword"

info()  { printf '\033[1;34m==> %s\033[0m\n' "$*"; }
ok()    { printf '\033[1;32m==> %s\033[0m\n' "$*"; }
fail()  { printf '\033[1;31m==> %s\033[0m\n' "$*"; exit 1; }

cd "$(dirname "$0")/.."

# ── Cleanup from previous runs ──
info "Stopping any existing containers..."
docker compose down -v 2>/dev/null || true

# ── Build and start ──
info "Building Docker image and starting services..."
docker compose up -d --build

# ── Wait for Verdaccio ──
info "Waiting for Verdaccio to be healthy..."
for i in $(seq 1 60); do
  STATUS=$(docker inspect --format='{{.State.Health.Status}}' "$(docker compose ps -q verdaccio)" 2>/dev/null || echo "starting")
  if [ "$STATUS" = "healthy" ]; then
    ok "Verdaccio is healthy"
    break
  fi
  if [ "$i" -eq 60 ]; then
    docker compose logs verdaccio
    fail "Verdaccio failed to start within 120 seconds"
  fi
  sleep 2
done

# ── Verify plugin loaded ──
info "Checking plugin loaded..."
if docker compose logs verdaccio 2>&1 | grep -q "ldap"; then
  ok "LDAP plugin detected in logs"
else
  docker compose logs verdaccio
  fail "LDAP plugin not found in Verdaccio logs"
fi

# ── Authenticate test user ──
info "Authenticating as $LDAP_USER..."
TOKEN=$(curl -sf -X PUT "$REGISTRY_URL/-/user/org.couchdb.user:$LDAP_USER" \
  -H 'Content-Type: application/json' \
  -d "{\"name\":\"$LDAP_USER\",\"password\":\"$LDAP_PASS\"}" | node -e "
    process.stdin.setEncoding('utf8');
    let d='';
    process.stdin.on('data',c=>d+=c);
    process.stdin.on('end',()=>console.log(JSON.parse(d).token))")

if [ -z "$TOKEN" ]; then
  fail "Authentication failed — no token returned"
fi
ok "Authenticated. Token: ${TOKEN:0:16}..."

# ── Publish a test package ──
info "Publishing a test package..."
TMPDIR=$(mktemp -d)
cat > "$TMPDIR/package.json" <<'EOF'
{"name":"ldap-dev-test","version":"1.0.0","description":"dev smoke test"}
EOF
(cd "$TMPDIR" && npm publish --registry "$REGISTRY_URL" --//localhost:4873/:_authToken="$TOKEN") 2>&1

RESULT=$(curl -sf "$REGISTRY_URL/ldap-dev-test" | node -e "
  process.stdin.setEncoding('utf8');
  let d='';
  process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>console.log(JSON.parse(d).name))")

if [ "$RESULT" = "ldap-dev-test" ]; then
  ok "Package published and fetched successfully"
else
  fail "Package verification failed"
fi

rm -rf "$TMPDIR"

# ── Summary ──
echo ""
ok "Local dev environment is ready!"
echo ""
echo "  Registry:  $REGISTRY_URL"
echo "  UI:        $REGISTRY_URL"
echo "  User:      $LDAP_USER / $LDAP_PASS"
echo "  Token:     $TOKEN"
echo ""
echo "  Useful commands:"
echo "    docker compose logs -f verdaccio          # tail logs"
echo "    pnpm e2e:ui                               # open Cypress"
echo "    docker compose down -v                    # stop everything"
echo ""
