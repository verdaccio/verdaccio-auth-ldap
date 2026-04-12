#!/usr/bin/env bash
set -euo pipefail

# Local development script for @verdaccio/auth-ldap
# Builds the plugin, starts OpenLDAP + Verdaccio, runs smoke checks,
# then streams logs in the foreground (Ctrl-C to stop).

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

# ── Build images ──
info "Building Docker image..."
docker compose build

# ── Start services (detached for smoke checks) ──
info "Starting services..."
docker compose up -d

# ── Wait for Verdaccio ──
info "Waiting for Verdaccio to be healthy..."
for i in $(seq 1 60); do
  if pnpm verdaccioctl ping -r "$REGISTRY_URL" 2>/dev/null; then
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
sleep 2
if docker compose logs verdaccio 2>&1 | grep "ldap" > /dev/null; then
  ok "LDAP plugin detected in logs"
else
  docker compose logs verdaccio
  fail "LDAP plugin not found in Verdaccio logs"
fi

# ── Authenticate test user ──
info "Authenticating as $LDAP_USER..."
if pnpm verdaccioctl login -u "$LDAP_USER" -p "$LDAP_PASS" -r "$REGISTRY_URL"; then
  ok "Authenticated as $LDAP_USER"
else
  fail "Authentication failed"
fi

# ── Verify authenticated access ──
info "Verifying identity..."
pnpm verdaccioctl whoami -r "$REGISTRY_URL" || fail "whoami failed"
ok "Authenticated access verified"

# ── Summary ──
echo ""
ok "Local dev environment is ready!"
echo ""
echo "  Registry:  $REGISTRY_URL"
echo "  UI:        $REGISTRY_URL"
echo "  User:      $LDAP_USER / $LDAP_PASS"
echo "  Token:     $TOKEN"
echo ""
echo "  Press Ctrl-C to stop all services."
echo ""

# ── Attach to logs (foreground) ──
# Stop containers when the user hits Ctrl-C
trap 'echo ""; info "Stopping services..."; docker compose down -v; exit 0' INT TERM
docker compose logs -f
