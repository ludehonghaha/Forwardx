#!/usr/bin/env bash
set -euo pipefail
umask 077

ROLE="${1:-}"
ACTION="${2:-}"
CONFIG_DIR="${3:-}"
ARTIFACT_DIR="${4:-}"
RUNTIME_DIR="${5:-}"

usage() {
  cat >&2 <<'EOF'
usage: run-dual-pilot.sh <server|client> <validate|start|status|stop|cleanup> <config-dir> <artifact-dir> <runtime-dir>

Environment overrides:
  SING_BOX_BIN       pinned sing-box-multipath binary
  MITA_BIN           dedicated Pilot Mita binary (server role)
  MIERU_BIN          official mieru client binary (client role)
  PROTECTED_MITA_PORT production Mita listener that must never be reused (default: 11464)
EOF
  exit 2
}

case "$ROLE" in server|client) ;; *) usage ;; esac
case "$ACTION" in validate|start|status|stop|cleanup) ;; *) usage ;; esac
[ -n "$CONFIG_DIR" ] && [ -n "$ARTIFACT_DIR" ] && [ -n "$RUNTIME_DIR" ] || usage

log() { printf '[dual-pilot] %s\n' "$*"; }
fail() { printf '[dual-pilot] ERROR: %s\n' "$*" >&2; exit 1; }

canonical_path() {
  readlink -f "$1" 2>/dev/null || printf '%s' "$1"
}

require_file() {
  [ -f "$1" ] || fail "missing file: $1"
}

require_executable() {
  [ -x "$1" ] || fail "missing executable: $1"
}

find_sing_box() {
  if [ -n "${SING_BOX_BIN:-}" ]; then
    printf '%s' "$SING_BOX_BIN"
    return
  fi
  local candidate
  for candidate in \
    "$ARTIFACT_DIR/sing-box-linux-amd64" \
    "$ARTIFACT_DIR/sing-box-linux-arm64" \
    "$ARTIFACT_DIR/sing-box"; do
    if [ -x "$candidate" ]; then printf '%s' "$candidate"; return; fi
  done
  fail "pinned sing-box artifact not found; set SING_BOX_BIN"
}

find_mita() {
  if [ -n "${MITA_BIN:-}" ]; then printf '%s' "$MITA_BIN"; return; fi
  if [ -x /usr/local/lib/nobrand-oneclick/bin/mita ]; then
    printf '%s' /usr/local/lib/nobrand-oneclick/bin/mita
    return
  fi
  command -v mita 2>/dev/null || fail "mita not found; set MITA_BIN"
}

find_mieru() {
  if [ -n "${MIERU_BIN:-}" ]; then printf '%s' "$MIERU_BIN"; return; fi
  local candidate
  for candidate in "$ARTIFACT_DIR/mieru" "$ARTIFACT_DIR/mieru-linux-amd64" "$ARTIFACT_DIR/mieru-linux-arm64"; do
    if [ -x "$candidate" ]; then printf '%s' "$candidate"; return; fi
  done
  command -v mieru 2>/dev/null || fail "mieru not found; set MIERU_BIN"
}

SING_BOX_BIN_RESOLVED="$(find_sing_box)"
require_executable "$SING_BOX_BIN_RESOLVED"

SERVER_CONFIG="$CONFIG_DIR/server-gray.json"
MITA_CONFIG="$CONFIG_DIR/mita-pilot.json"
CLIENT_CONFIG="$CONFIG_DIR/dual-test.json"
MIERU_CONFIG="$CONFIG_DIR/mieru-gray.json"
PROTECTED_MITA_PORT="${PROTECTED_MITA_PORT:-11464}"

mkdir -p "$RUNTIME_DIR"
chmod 700 "$RUNTIME_DIR" 2>/dev/null || true

json_sanity() {
  local file="$1"
  if command -v python3 >/dev/null 2>&1; then
    python3 -m json.tool "$file" >/dev/null
  elif command -v node >/dev/null 2>&1; then
    node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$file"
  else
    # Materializers emit JSON themselves. On minimal targets without a JSON
    # parser, native sing-box validation still covers sing-box configs.
    grep -q '^[[:space:]]*{' "$file" || return 1
  fi
}

extract_first_json_port() {
  sed -nE 's/.*"port"[[:space:]]*:[[:space:]]*([0-9]+).*/\1/p' "$1" | head -n1
}

port_listening() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -lntH 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)$port$"
    return
  fi
  if command -v netstat >/dev/null 2>&1; then
    netstat -lnt 2>/dev/null | awk 'NR>2 {print $4}' | grep -Eq "(^|:)$port$"
    return
  fi
  return 2
}

assert_port_free() {
  local port="$1" label="$2" rc=0
  if port_listening "$port"; then
    fail "$label port $port is already listening"
  else
    rc=$?
    [ "$rc" -eq 1 ] || log "port probe unavailable; process ownership checks remain active for $label"
  fi
}

wait_port() {
  local port="$1" name="$2" i rc
  for i in $(seq 1 20); do
    if port_listening "$port"; then return 0; else rc=$?; fi
    if [ "$rc" -eq 2 ]; then sleep 1; return 0; fi
    verify_owned "$name" >/dev/null 2>&1 || return 1
    sleep 0.25
  done
  return 1
}

process_start_ticks() {
  local pid="$1"
  [ -r "/proc/$pid/stat" ] || return 1
  sed 's/^[^)]*) //' "/proc/$pid/stat" | awk '{print $20}'
}

process_exe() {
  canonical_path "/proc/$1/exe"
}

owner_file() { printf '%s/%s.%s' "$RUNTIME_DIR" "$1" "$2"; }

record_owned() {
  local name="$1" pid="$2" expected_bin="$3" ticks exe
  ticks="$(process_start_ticks "$pid")" || fail "cannot record $name start time"
  exe="$(process_exe "$pid")" || fail "cannot record $name executable"
  [ "$exe" = "$(canonical_path "$expected_bin")" ] || fail "$name executable mismatch immediately after start"
  printf '%s\n' "$pid" >"$(owner_file "$name" pid)"
  printf '%s\n' "$ticks" >"$(owner_file "$name" start)"
  printf '%s\n' "$exe" >"$(owner_file "$name" exe)"
}

clear_owner() {
  rm -f "$(owner_file "$1" pid)" "$(owner_file "$1" start)" "$(owner_file "$1" exe)"
}

verify_owned() {
  local name="$1" pid ticks exe current_ticks current_exe
  [ -r "$(owner_file "$name" pid)" ] || return 1
  [ -r "$(owner_file "$name" start)" ] || return 1
  [ -r "$(owner_file "$name" exe)" ] || return 1
  pid="$(cat "$(owner_file "$name" pid)")"
  ticks="$(cat "$(owner_file "$name" start)")"
  exe="$(cat "$(owner_file "$name" exe)")"
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  kill -0 "$pid" 2>/dev/null || return 1
  current_ticks="$(process_start_ticks "$pid" 2>/dev/null || true)"
  current_exe="$(process_exe "$pid" 2>/dev/null || true)"
  [ -n "$current_ticks" ] && [ "$current_ticks" = "$ticks" ] && [ "$current_exe" = "$exe" ]
}

stop_owned() {
  local name="$1" pid i
  if [ ! -e "$(owner_file "$name" pid)" ]; then return 0; fi
  if ! verify_owned "$name"; then
    fail "refusing to kill $name: PID ownership proof does not match (possible PID reuse)"
  fi
  pid="$(cat "$(owner_file "$name" pid)")"
  kill "$pid" 2>/dev/null || true
  for i in $(seq 1 20); do
    if ! kill -0 "$pid" 2>/dev/null; then clear_owner "$name"; return 0; fi
    sleep 0.25
  done
  if verify_owned "$name"; then kill -KILL "$pid" 2>/dev/null || true; fi
  sleep 0.1
  if kill -0 "$pid" 2>/dev/null; then fail "$name did not stop"; fi
  clear_owner "$name"
}

assert_safe_sing_box_config() {
  local file="$1"
  require_file "$file"
  json_sanity "$file" || fail "invalid JSON: $file"
  if grep -Eq '"tcp_fast_open"[[:space:]]*:[[:space:]]*true' "$file"; then
    fail "tcp_fast_open=true is forbidden in Dual Pilot"
  fi
  "$SING_BOX_BIN_RESOLVED" check -c "$file" >/dev/null || fail "sing-box check failed: $file"
}

validate_server() {
  local pilot_port mita_bin
  assert_safe_sing_box_config "$SERVER_CONFIG"
  require_file "$MITA_CONFIG"
  json_sanity "$MITA_CONFIG" || fail "invalid JSON: $MITA_CONFIG"
  grep -Eq '"listen"[[:space:]]*:[[:space:]]*"127\.0\.0\.1"' "$SERVER_CONFIG" \
    || fail "server multipath listener must stay on 127.0.0.1"
  grep -Eq '"listen_port"[[:space:]]*:[[:space:]]*39000' "$SERVER_CONFIG" \
    || fail "server multipath listener must stay on port 39000"
  grep -Eq '"allowLoopbackIP"[[:space:]]*:[[:space:]]*true' "$MITA_CONFIG" \
    || fail "Pilot Mita must enable allowLoopbackIP only in its dedicated config"
  pilot_port="$(extract_first_json_port "$MITA_CONFIG")"
  case "$pilot_port" in ''|*[!0-9]*) fail "cannot resolve Pilot Mita port" ;; esac
  [ "$pilot_port" -ge 1025 ] || fail "Pilot Mita port must be >= 1025"
  [ "$pilot_port" != "$PROTECTED_MITA_PORT" ] \
    || fail "Pilot Mita must never reuse protected production port $PROTECTED_MITA_PORT"
  mita_bin="$(find_mita)"
  require_executable "$mita_bin"
  "$mita_bin" version >/dev/null 2>&1 || fail "mita binary is not runnable"
  log "server validation PASS (multipath=127.0.0.1:39000, pilot-mita=$pilot_port, protected=$PROTECTED_MITA_PORT)"
}

validate_client() {
  local mieru_bin
  assert_safe_sing_box_config "$CLIENT_CONFIG"
  require_file "$MIERU_CONFIG"
  json_sanity "$MIERU_CONFIG" || fail "invalid JSON: $MIERU_CONFIG"
  grep -Eq '"socks5Port"[[:space:]]*:[[:space:]]*24181' "$MIERU_CONFIG" \
    || fail "Pilot Mieru child SOCKS must stay on 127.0.0.1:24181"
  grep -Eq '"socks5ListenLAN"[[:space:]]*:[[:space:]]*false' "$MIERU_CONFIG" \
    || fail "Pilot Mieru SOCKS must not listen on LAN"
  grep -Eq '"listen"[[:space:]]*:[[:space:]]*"127\.0\.0\.1"' "$CLIENT_CONFIG" \
    || fail "Dual client ingress must stay on 127.0.0.1"
  grep -Eq '"listen_port"[[:space:]]*:[[:space:]]*24180' "$CLIENT_CONFIG" \
    || fail "Dual client ingress must stay on 24180"
  mieru_bin="$(find_mieru)"
  require_executable "$mieru_bin"
  "$mieru_bin" version >/dev/null 2>&1 || fail "mieru binary is not runnable"
  log "client validation PASS (ingress=127.0.0.1:24180, mieru-socks=127.0.0.1:24181)"
}

start_server() {
  local pilot_port mita_bin pid
  validate_server
  pilot_port="$(extract_first_json_port "$MITA_CONFIG")"
  mita_bin="$(find_mita)"
  verify_owned server-singbox >/dev/null 2>&1 && fail "server-singbox already running"
  verify_owned server-mita >/dev/null 2>&1 && fail "server-mita already running"
  assert_port_free 39000 "multipath"
  assert_port_free "$pilot_port" "Pilot Mita"

  nohup "$SING_BOX_BIN_RESOLVED" run -c "$SERVER_CONFIG" >"$RUNTIME_DIR/server-singbox.log" 2>&1 &
  pid=$!
  sleep 0.1
  record_owned server-singbox "$pid" "$SING_BOX_BIN_RESOLVED"
  if ! wait_port 39000 server-singbox; then
    stop_owned server-singbox || true
    fail "server multipath listener did not become ready"
  fi

  nohup env \
    MITA_CONFIG_JSON_FILE="$MITA_CONFIG" \
    MITA_UDS_PATH="$RUNTIME_DIR/mita-pilot.sock" \
    "$mita_bin" run >"$RUNTIME_DIR/server-mita.log" 2>&1 &
  pid=$!
  sleep 0.1
  if ! record_owned server-mita "$pid" "$mita_bin"; then
    stop_owned server-singbox || true
    fail "failed to record Pilot Mita ownership"
  fi
  if ! wait_port "$pilot_port" server-mita; then
    stop_owned server-mita || true
    stop_owned server-singbox || true
    fail "Pilot Mita listener did not become ready"
  fi
  log "server Pilot RUNNING; production Mita port $PROTECTED_MITA_PORT was not touched"
}

start_client() {
  local mieru_bin pid
  validate_client
  mieru_bin="$(find_mieru)"
  verify_owned client-mieru >/dev/null 2>&1 && fail "client-mieru already running"
  verify_owned client-singbox >/dev/null 2>&1 && fail "client-singbox already running"
  assert_port_free 24181 "Mieru child SOCKS"
  assert_port_free 24180 "Dual client ingress"

  nohup env MIERU_CONFIG_JSON_FILE="$MIERU_CONFIG" \
    "$mieru_bin" run >"$RUNTIME_DIR/client-mieru.log" 2>&1 &
  pid=$!
  sleep 0.1
  record_owned client-mieru "$pid" "$mieru_bin"
  if ! wait_port 24181 client-mieru; then
    stop_owned client-mieru || true
    fail "Mieru child SOCKS did not become ready"
  fi

  nohup "$SING_BOX_BIN_RESOLVED" run -c "$CLIENT_CONFIG" >"$RUNTIME_DIR/client-singbox.log" 2>&1 &
  pid=$!
  sleep 0.1
  record_owned client-singbox "$pid" "$SING_BOX_BIN_RESOLVED"
  if ! wait_port 24180 client-singbox; then
    stop_owned client-singbox || true
    stop_owned client-mieru || true
    fail "Dual client ingress did not become ready"
  fi
  log "client Pilot RUNNING at socks5://127.0.0.1:24180"
}

status_one() {
  local name="$1"
  if verify_owned "$name"; then
    printf '%s=running pid=%s\n' "$name" "$(cat "$(owner_file "$name" pid)")"
  elif [ -e "$(owner_file "$name" pid)" ]; then
    printf '%s=ownership-mismatch\n' "$name"
    return 2
  else
    printf '%s=stopped\n' "$name"
    return 1
  fi
}

status_role() {
  local rc=0
  if [ "$ROLE" = server ]; then
    status_one server-singbox || rc=$?
    status_one server-mita || rc=$?
  else
    status_one client-mieru || rc=$?
    status_one client-singbox || rc=$?
  fi
  return "$rc"
}

stop_role() {
  if [ "$ROLE" = server ]; then
    stop_owned server-mita
    stop_owned server-singbox
    rm -f "$RUNTIME_DIR/mita-pilot.sock" 2>/dev/null || true
  else
    stop_owned client-singbox
    stop_owned client-mieru
  fi
  log "$ROLE Pilot STOPPED"
}

case "$ACTION" in
  validate)
    if [ "$ROLE" = server ]; then validate_server; else validate_client; fi
    ;;
  start)
    if [ "$ROLE" = server ]; then start_server; else start_client; fi
    ;;
  status)
    status_role
    ;;
  stop)
    stop_role
    ;;
  cleanup)
    stop_role
    find "$RUNTIME_DIR" -mindepth 1 -maxdepth 1 -type f -delete 2>/dev/null || true
    log "$ROLE Pilot runtime files cleaned"
    ;;
esac
