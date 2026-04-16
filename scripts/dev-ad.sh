#!/usr/bin/env bash
set -euo pipefail

# Local development script for the Active Directory stack.
# Uses a real Samba AD DC (docker/samba-ad/) — not an OpenLDAP mock.
# Test user: cfiehe / testpassword (based on issue #3 example).

COMPOSE_FILE="docker-compose.ad.yaml"
REGISTRY_URL="http://localhost:4873"
LDAP_USER="cfiehe"
LDAP_PASS="testpassword"

info()  { printf '\033[1;34m==> %s\033[0m\n' "$*"; }
ok()    { printf '\033[1;32m==> %s\033[0m\n' "$*"; }
fail()  { printf '\033[1;31m==> %s\033[0m\n' "$*"; exit 1; }

cd "$(dirname "$0")/.."

# ── Cleanup from previous runs ──
info "Stopping any existing AD containers..."
docker compose -f "$COMPOSE_FILE" down -v 2>/dev/null || true

# ── Build images ──
info "Building Docker images (Samba AD DC + Verdaccio)..."
docker compose -f "$COMPOSE_FILE" build

# ── Start services (detached for smoke checks) ──
info "Starting Samba AD DC + Verdaccio..."
docker compose -f "$COMPOSE_FILE" up -d

# ── Wait for Verdaccio ──
info "Waiting for Verdaccio to be healthy (AD DC may take a moment)..."
for i in $(seq 1 90); do
  if pnpm verdaccioctl ping -r "$REGISTRY_URL" 2>/dev/null; then
    ok "Verdaccio is healthy"
    break
  fi
  if [ "$i" -eq 90 ]; then
    docker compose -f "$COMPOSE_FILE" logs
    fail "Verdaccio failed to start within 180 seconds"
  fi
  sleep 2
done

# ── Verify plugin loaded ──
info "Checking plugin loaded..."
sleep 2
if docker compose -f "$COMPOSE_FILE" logs verdaccio 2>&1 | grep "ldap" > /dev/null; then
  ok "LDAP plugin detected in logs"
else
  docker compose -f "$COMPOSE_FILE" logs verdaccio
  fail "LDAP plugin not found in Verdaccio logs"
fi

# ── Authenticate test user ──
info "Authenticating as $LDAP_USER (AD user)..."
if pnpm verdaccioctl login -u "$LDAP_USER" -p "$LDAP_PASS" -r "$REGISTRY_URL"; then
  ok "Authenticated as $LDAP_USER"
else
  docker compose -f "$COMPOSE_FILE" logs
  fail "Authentication failed — check Samba AD DC logs above"
fi

# ── Verify authenticated access ──
info "Verifying identity..."
pnpm verdaccioctl whoami -r "$REGISTRY_URL" || fail "whoami failed"
ok "Authenticated access verified"

# ── Verify memberOf groups resolved ──
info "Checking group resolution via memberOf..."
if docker compose -f "$COMPOSE_FILE" logs verdaccio 2>&1 | grep -i "GroupA\|GroupB" > /dev/null; then
  ok "Groups resolved from AD memberOf attribute"
else
  echo "  (groups may appear after the next auth call — check logs manually)"
fi

# ── Summary ──
echo ""
ok "Active Directory dev environment is ready!"
echo ""
echo "  Registry:  $REGISTRY_URL"
echo "  UI:        $REGISTRY_URL"
echo "  User:      $LDAP_USER / $LDAP_PASS"
echo "  Backend:   Samba AD DC (MYCOMPANY.DE domain)"
echo ""
echo "  Press Ctrl-C to stop all services."
echo ""

# ── Attach to logs (foreground) ──
trap 'echo ""; info "Stopping services..."; docker compose -f "$COMPOSE_FILE" down -v; exit 0' INT TERM
docker compose -f "$COMPOSE_FILE" logs -f
