#!/bin/sh
# Read-only discovery for the existing ForwardX Agent-managed HY2 carrier.
# Intentionally does not read runtime configs, credentials, certificates, or secret env.
set -u

PUBLIC_PORT="${PUBLIC_PORT:-24618}"
LISTENER_PORT="${LISTENER_PORT:-13666}"

echo '===== ForwardX Dual / existing HY2 discovery ====='
date -Is 2>/dev/null || date
uname -srm 2>/dev/null || true

echo
echo '--- interfaces ---'
ip -br address show eth0 2>/dev/null || true
ip -br address show eth1 2>/dev/null || true

echo
echo "--- host UDP listeners (${LISTENER_PORT}/${PUBLIC_PORT}) ---"
ss -lunp 2>/dev/null | grep -E ":(${LISTENER_PORT}|${PUBLIC_PORT})[[:space:]]" || echo 'No matching UDP listener visible in host netns'

echo
echo '--- ForwardX/Xray processes ---'
PIDS="$(pgrep -x forwardx-xray 2>/dev/null || true)"
if [ -z "$PIDS" ]; then
  PIDS="$(pgrep -f '/forwardx-xray|forwardx-xray' 2>/dev/null || true)"
fi
if [ -z "$PIDS" ]; then
  echo 'No forwardx-xray process found'
else
  for pid in $PIDS; do
    [ -d "/proc/$pid" ] || continue
    printf 'pid=%s exe=' "$pid"
    readlink "/proc/$pid/exe" 2>/dev/null || echo '?'
    printf '  host-netns='; readlink /proc/1/ns/net 2>/dev/null || echo '?'
    printf '  proc-netns='; readlink "/proc/$pid/ns/net" 2>/dev/null || echo '?'
    if command -v nsenter >/dev/null 2>&1; then
      echo "  UDP listeners visible inside pid $pid netns:"
      nsenter -t "$pid" -n ss -lunp 2>/dev/null | grep -E ":(${LISTENER_PORT}|${PUBLIC_PORT})[[:space:]]" || echo '  (none on target ports)'
    fi
  done
fi

echo
echo '--- relevant services (names/status only) ---'
systemctl list-units --type=service --all --no-pager 2>/dev/null | grep -Ei 'forwardx|xray|agent' || true

echo
echo "--- NAT / redirect evidence for ${PUBLIC_PORT} -> ${LISTENER_PORT} ---"
if command -v nft >/dev/null 2>&1; then
  nft list ruleset 2>/dev/null | grep -E "${PUBLIC_PORT}|${LISTENER_PORT}" || true
fi
if command -v iptables >/dev/null 2>&1; then
  iptables -t nat -S 2>/dev/null | grep -E "${PUBLIC_PORT}|${LISTENER_PORT}" || true
fi

echo
echo '--- container hints (metadata only) ---'
if command -v docker >/dev/null 2>&1; then
  docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null | grep -Ei 'forwardx|xray|agent|hysteria|hy2|13666|24618' || true
fi

echo
echo '--- multipath candidate ---'
ss -lntup 2>/dev/null | grep ':39000[[:space:]]' || echo '127.0.0.1:39000 appears free in host netns'

echo
echo '===== END (read-only; no config/secret read, no mutation) ====='
