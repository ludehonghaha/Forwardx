#!/usr/bin/env bash
set -euo pipefail
umask 077

SOURCE_CONFIG_DIR="${1:-}"
SOURCE_ARTIFACT_DIR="${2:-}"

INSTALL_ROOT="/usr/local/lib/forwardx/dual-pilot"
INSTALL_ARTIFACT_DIR="$INSTALL_ROOT/artifacts"
INSTALL_CONFIG_DIR="/etc/forwardx/dual-pilot"
RUNTIME_DIR="/var/lib/forwardx-agent/dual-pilot"
PROTECTED_MITA_PORT="${PROTECTED_MITA_PORT:-11464}"

usage() {
  cat >&2 <<'EOF'
usage: install-dual-pilot-server.sh <materialized-config-dir> <built-artifact-dir>

Installs, but DOES NOT START, the experimental Dual server Pilot runtime.
Expected source files:
  materialized-config-dir/server-gray.json
  materialized-config-dir/mita-pilot.json
  built-artifact-dir/sing-box-linux-amd64

The installer never writes systemd, firewall, route, production Mita or HY2 config.
EOF
  exit 2
}

[ -n "$SOURCE_CONFIG_DIR" ] && [ -n "$SOURCE_ARTIFACT_DIR" ] || usage
[ "$(id -u)" -eq 0 ] || { echo "ERROR: run as root" >&2; exit 1; }

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
LAUNCHER_SOURCE="$SCRIPT_DIR/run-dual-pilot.sh"
SERVER_SOURCE="$SOURCE_CONFIG_DIR/server-gray.json"
MITA_SOURCE="$SOURCE_CONFIG_DIR/mita-pilot.json"
SING_BOX_SOURCE="$SOURCE_ARTIFACT_DIR/sing-box-linux-amd64"

fail() { printf '[dual-pilot-install] ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '[dual-pilot-install] %s\n' "$*"; }

for file in "$LAUNCHER_SOURCE" "$SERVER_SOURCE" "$MITA_SOURCE" "$SING_BOX_SOURCE"; do
  [ -f "$file" ] || fail "missing required file: $file"
done
[ -x "$LAUNCHER_SOURCE" ] || fail "launcher is not executable: $LAUNCHER_SOURCE"
[ -x "$SING_BOX_SOURCE" ] || fail "pinned sing-box is not executable: $SING_BOX_SOURCE"

json_sanity() {
  local file="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 -m json.tool "$file" >/dev/null
  elif command -v node >/dev/null 2>&1; then
    node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$file"
  else
    grep -q '^[[:space:]]*{' "$file" || return 1
  fi
}

json_sanity "$SERVER_SOURCE" || fail "invalid JSON: $SERVER_SOURCE"
json_sanity "$MITA_SOURCE" || fail "invalid JSON: $MITA_SOURCE"

if grep -Eq '"tcp_fast_open"[[:space:]]*:[[:space:]]*true' "$SERVER_SOURCE"; then
  fail "tcp_fast_open=true is forbidden in Dual Pilot"
fi
grep -Eq '"listen"[[:space:]]*:[[:space:]]*"127\.0\.0\.1"' "$SERVER_SOURCE" \
  || fail "server multipath listener must stay on 127.0.0.1"
grep -Eq '"listen_port"[[:space:]]*:[[:space:]]*39000' "$SERVER_SOURCE" \
  || fail "server multipath listener must stay on port 39000"
grep -Eq '"allowLoopbackIP"[[:space:]]*:[[:space:]]*true' "$MITA_SOURCE" \
  || fail "dedicated Pilot Mita user must explicitly allow loopback"

pilot_port="$(sed -nE 's/.*"port"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$MITA_SOURCE" | head -n1)"
case "$pilot_port" in ''|*[!0-9]*) fail "cannot resolve Pilot Mita port" ;; esac
[ "$pilot_port" -ge 1025 ] || fail "Pilot Mita port must be >= 1025"
[ "$pilot_port" != "$PROTECTED_MITA_PORT" ] \
  || fail "refusing to reuse protected production Mita port $PROTECTED_MITA_PORT"

"$SING_BOX_SOURCE" check -c "$SERVER_SOURCE" >/dev/null \
  || fail "pinned sing-box rejected server config"

if [ -x /usr/local/lib/nobrand-oneclick/bin/mita ]; then
  MITA_BIN=/usr/local/lib/nobrand-oneclick/bin/mita
elif command -v mita >/dev/null 2>&1; then
  MITA_BIN="$(command -v mita)"
else
  fail "mita not found; existing NoBrand installation is required"
fi
"$MITA_BIN" version >/dev/null 2>&1 || fail "mita binary is not runnable"

# Never replace files underneath a running Pilot. PID ownership validation and
# stopping remain the launcher's responsibility; this installer only checks
# for a live PID recorded in the dedicated runtime directory.
for pid_file in "$RUNTIME_DIR"/*.pid; do
  [ -f "$pid_file" ] || continue
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  case "$pid" in ''|*[!0-9]*) continue ;; esac
  if kill -0 "$pid" 2>/dev/null; then
    fail "Pilot appears to be running (pid=$pid); stop it before reinstalling"
  fi
done

install -d -m 0755 "$INSTALL_ROOT" "$INSTALL_ARTIFACT_DIR"
install -d -m 0700 "$INSTALL_CONFIG_DIR" "$RUNTIME_DIR"
install -m 0755 "$LAUNCHER_SOURCE" "$INSTALL_ROOT/run-dual-pilot.sh"
install -m 0755 "$SING_BOX_SOURCE" "$INSTALL_ARTIFACT_DIR/sing-box-linux-amd64"
install -m 0600 "$SERVER_SOURCE" "$INSTALL_CONFIG_DIR/server-gray.json"
install -m 0600 "$MITA_SOURCE" "$INSTALL_CONFIG_DIR/mita-pilot.json"

# Re-validate the exact installed bytes. Validation must not start any process.
PROTECTED_MITA_PORT="$PROTECTED_MITA_PORT" \
  "$INSTALL_ROOT/run-dual-pilot.sh" server validate "$INSTALL_CONFIG_DIR" "$INSTALL_ARTIFACT_DIR" "$RUNTIME_DIR"

log "installation PASS"
log "installed launcher: $INSTALL_ROOT/run-dual-pilot.sh"
log "installed config: $INSTALL_CONFIG_DIR (0600 files)"
log "installed pinned artifact: $INSTALL_ARTIFACT_DIR/sing-box-linux-amd64"
log "Pilot was NOT started; use the ForwardX Pilot start action only after reviewing this validation."
