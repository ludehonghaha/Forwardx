#!/usr/bin/env bash
set -euo pipefail
umask 077

ROLE="${1:-}"
RUNTIME_DIR="${2:-}"
CONFIG_DIR="${3:-}"

usage() {
  echo "usage: collect-dual-pilot-evidence.sh <server|client> <runtime-dir> <config-dir>" >&2
  exit 2
}

case "$ROLE" in server|client) ;; *) usage ;; esac
[ -n "$RUNTIME_DIR" ] && [ -n "$CONFIG_DIR" ] || usage

EVIDENCE_ROOT="$RUNTIME_DIR/evidence"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$EVIDENCE_ROOT/$STAMP-$ROLE"
mkdir -p "$OUT"
chmod 700 "$EVIDENCE_ROOT" "$OUT" 2>/dev/null || true

sanitize_stream() {
  sed -E \
    -e 's/((password|passwd|auth|token|secret|private[_ -]?key)[[:space:]]*[:=][[:space:]]*)[^,[:space:]"}]+/\1[REDACTED]/Ig' \
    -e 's/("(password|auth|token|secret)"[[:space:]]*:[[:space:]]*")[^"]+"/\1[REDACTED]"/Ig'
}

copy_log_tail() {
  local source="$1" target="$2"
  [ -f "$source" ] || return 0
  tail -n 400 "$source" 2>/dev/null | sanitize_stream >"$OUT/$target" || true
}

copy_status() {
  local source="$CONFIG_DIR/multipath-status.json"
  [ -f "$source" ] || return 0
  # Runtime status contains counters/errors, not carrier credentials. Still run
  # the generic redactor defensively before persisting it as evidence.
  sanitize_stream <"$source" >"$OUT/multipath-status.json" || true
}

owner_snapshot() {
  local name="$1" pid_file="$RUNTIME_DIR/$name.pid" pid="" start="" exe="" state="missing"
  if [ -r "$pid_file" ]; then
    pid="$(cat "$pid_file" 2>/dev/null || true)"
    start="$(cat "$RUNTIME_DIR/$name.start" 2>/dev/null || true)"
    exe="$(cat "$RUNTIME_DIR/$name.exe" 2>/dev/null || true)"
    case "$pid" in
      ''|*[!0-9]*) state="invalid-pid" ;;
      *)
        if [ -d "/proc/$pid" ]; then state="present"; else state="exited"; fi
        ;;
    esac
  fi
  printf '%s\t%s\t%s\t%s\t%s\n' "$name" "$state" "$pid" "$start" "$exe" >>"$OUT/processes.tsv"
}

{
  printf 'schema=forwardx-dual-pilot-evidence-v1\n'
  printf 'captured_at_utc=%s\n' "$STAMP"
  printf 'role=%s\n' "$ROLE"
  printf 'kernel=%s\n' "$(uname -sr 2>/dev/null || printf unknown)"
  printf 'tcp_fast_open_expected=false\n'
  printf 'protected_production_mita_port=11464\n'
} >"$OUT/metadata.txt"

printf 'name\tstate\tpid\tstart_ticks\texecutable\n' >"$OUT/processes.tsv"
if [ "$ROLE" = server ]; then
  owner_snapshot server-singbox
  owner_snapshot server-mita
  copy_log_tail "$RUNTIME_DIR/server-singbox.log" server-singbox.log
  copy_log_tail "$RUNTIME_DIR/server-mita.log" server-mita.log
else
  owner_snapshot client-singbox
  owner_snapshot client-mieru
  copy_log_tail "$RUNTIME_DIR/client-singbox.log" client-singbox.log
  copy_log_tail "$RUNTIME_DIR/client-mieru.log" client-mieru.log
  copy_status
fi

# Record only the fixed Pilot ports. Do not dump the host's complete socket table.
: >"$OUT/ports.txt"
for port in 39000 24180 24181; do
  if command -v ss >/dev/null 2>&1; then
    ss -lntupH 2>/dev/null | awk -v p=":$port" '$5 ~ (p "$") {print}' | sanitize_stream >>"$OUT/ports.txt" || true
  elif command -v netstat >/dev/null 2>&1; then
    netstat -lntup 2>/dev/null | awk -v p=":$port" '$4 ~ (p "$") {print}' | sanitize_stream >>"$OUT/ports.txt" || true
  fi
done

# Intentionally never copy server-gray.json, dual-test.json, mita-pilot.json,
# mieru-gray.json, TLS material, HY2 auth or Mieru credentials.
printf '%s\n' "$OUT"
