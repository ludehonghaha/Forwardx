#!/bin/sh
# Read-only discovery for the existing ForwardX Agent-managed HY2 carrier.
# Reads only non-secret runtime metadata. It never prints credential values,
# certificate private keys, Agent tokens, or raw configs.
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
echo '--- ForwardX runtime owners / network namespaces ---'
for process_name in forwardx-runtime forwardx-mihomo forwardx-xray; do
  PIDS="$(pgrep -x "$process_name" 2>/dev/null || true)"
  if [ -z "$PIDS" ]; then
    PIDS="$(pgrep -f "^/usr/local/bin/${process_name}([[:space:]]|$)" 2>/dev/null || true)"
  fi
  if [ -z "$PIDS" ]; then
    echo "No $process_name process found"
  else
    for pid in $PIDS; do
    [ -d "/proc/$pid" ] || continue
    printf 'process=%s pid=%s exe=' "$process_name" "$pid"
    readlink "/proc/$pid/exe" 2>/dev/null || echo '?'
    printf '  host-netns='; readlink /proc/1/ns/net 2>/dev/null || echo '?'
    printf '  proc-netns='; readlink "/proc/$pid/ns/net" 2>/dev/null || echo '?'
    if command -v nsenter >/dev/null 2>&1; then
      echo "  UDP listeners visible inside pid $pid netns:"
      nsenter -t "$pid" -n ss -lunp 2>/dev/null | grep -E ":(${LISTENER_PORT}|${PUBLIC_PORT})[[:space:]]" || echo '  (none on target ports)'
    fi
    done
  fi
done

echo
echo '--- ForwardX runtime UDP mapping (safe fields only) ---'
PUBLIC_PORT="$PUBLIC_PORT" LISTENER_PORT="$LISTENER_PORT" python3 - <<'PY' 2>/dev/null || true
import json
import os

path = "/etc/forwardx/runtime/gost.json"
ports = (os.environ["PUBLIC_PORT"], os.environ["LISTENER_PORT"])
try:
    document = json.load(open(path, encoding="utf-8"))
except Exception:
    print(f"runtime_config={path} parse=unavailable")
else:
    print(f"runtime_config={path} parse=valid")
    for service in document.get("services", []):
        address = str(service.get("addr", ""))
        nodes = service.get("forwarder", {}).get("nodes", [])
        for node in nodes:
            target = str(node.get("addr", ""))
            if any(port in address or port in target for port in ports):
                print(
                    "mapping="
                    + address
                    + " -> "
                    + target
                    + " listener="
                    + str(service.get("listener", {}).get("type", ""))
                    + " connector="
                    + str(node.get("connector", {}).get("type", ""))
                )
PY

echo
echo '--- ForwardX Mihomo HY2 metadata (secrets redacted) ---'
python3 - <<'PY' 2>/dev/null || true
path = "/etc/forwardx/mihomo/config.yaml"
try:
    import yaml
    document = yaml.safe_load(open(path, encoding="utf-8"))
except Exception:
    print(f"mihomo_config={path} parse=unavailable")
else:
    print(f"mihomo_config={path} parse=valid")
    for listener in document.get("listeners", []):
        if listener.get("type") != "hysteria2":
            continue
        print(
            "hy2_listener="
            + str(listener.get("listen", ""))
            + ":"
            + str(listener.get("port", ""))
            + " owner=forwardx-mihomo.service"
        )
        print("hy2_auth=resolved" if listener.get("users") else "hy2_auth=unresolved")
        print("hy2_obfs=" + str(listener.get("obfs", "none")))
        print("hy2_obfs_secret=resolved" if listener.get("obfs-password") else "hy2_obfs_secret=unresolved")
        print("hy2_certificate=" + str(listener.get("certificate", "unresolved")))
PY

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
