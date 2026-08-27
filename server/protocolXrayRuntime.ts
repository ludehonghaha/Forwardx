import type { ManagedXrayRuntimePlan } from "./protocolXrayPlan";

export const XRAY_VERSION = "26.3.27";
export const XRAY_BIN = "/usr/local/bin/forwardx-xray";
export const XRAY_SERVICE_NAME = "forwardx-xray";
export const XRAY_CONFIG_DIR = "/etc/forwardx/xray";
export const XRAY_CONFIG_PATH = `${XRAY_CONFIG_DIR}/config.json`;

function shQuote(value: string) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

/**
 * Install the pinned upstream Xray binary used only for managed Reality.
 *
 * The official Linux release is a zip archive. Avoid mutating the host package
 * set just to obtain an unzip utility: use any already available extractor and
 * fail with an explicit error otherwise. ForwardX currently supports the same
 * primary Agent architectures as the managed Mihomo runtime (amd64/arm64).
 */
export function ensureXrayBinaryCmd() {
  const target = shQuote(XRAY_BIN);
  const versionText = shQuote(`Xray ${XRAY_VERSION} `);
  const releaseBase = `https://github.com/XTLS/Xray-core/releases/download/v${XRAY_VERSION}`;
  return [
    `xray_version_ok() { [ -x "$1" ] && "$1" version 2>&1 | head -n 1 | grep -F -- ${versionText} >/dev/null 2>&1; }`,
    `if ! xray_version_ok ${target}; then`,
    `  arch="$(uname -m)"; case "$arch" in x86_64|amd64) asset=${shQuote("Xray-linux-64.zip")} ;; aarch64|arm64) asset=${shQuote("Xray-linux-arm64-v8a.zip")} ;; *) echo "unsupported Xray architecture: $arch" >&2; exit 1 ;; esac;`,
    `  tmp_zip="$(mktemp /tmp/forwardx-xray.XXXXXX.zip)"; tmp_dir="$(mktemp -d /tmp/forwardx-xray.XXXXXX)"; trap 'rm -rf "$tmp_zip" "$tmp_dir"' EXIT;`,
    `  curl -fL --retry 3 --retry-delay 2 --connect-timeout 15 ${shQuote(`${releaseBase}/`)}"$asset" -o "$tmp_zip";`,
    `  if command -v unzip >/dev/null 2>&1; then unzip -oq "$tmp_zip" -d "$tmp_dir"; elif command -v busybox >/dev/null 2>&1 && busybox unzip -h >/dev/null 2>&1; then busybox unzip -o "$tmp_zip" -d "$tmp_dir" >/dev/null; elif command -v bsdtar >/dev/null 2>&1; then bsdtar -xf "$tmp_zip" -C "$tmp_dir"; elif command -v python3 >/dev/null 2>&1; then python3 -m zipfile -e "$tmp_zip" "$tmp_dir"; else echo "Xray install requires unzip, busybox unzip, bsdtar or python3" >&2; exit 1; fi;`,
    `  [ -s "$tmp_dir/xray" ] || { echo "Xray release archive did not contain xray" >&2; exit 1; }; chmod 0755 "$tmp_dir/xray"; xray_version_ok "$tmp_dir/xray"; install -m 0755 "$tmp_dir/xray" ${target};`,
    `  rm -rf "$tmp_zip" "$tmp_dir"; trap - EXIT;`,
    `fi; xray_version_ok ${target}`,
  ].join("\n");
}

export function xrayServiceUnit() {
  return [
    "[Unit]",
    "Description=ForwardX managed Xray Reality entry protocols",
    "After=network-online.target",
    "Wants=network-online.target",
    "StartLimitIntervalSec=60",
    "StartLimitBurst=5",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${XRAY_BIN} run -c ${XRAY_CONFIG_PATH}`,
    "Restart=on-failure",
    "RestartSec=2",
    "LimitNOFILE=1048576",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "",
  ].join("\n");
}

/**
 * Xray 26.3.27 exposes `run -test -c <file>` for config-only validation.
 * After systemd starts the service, also require every planned Reality TCP
 * socket to be present before the Agent reports the desired state as applied.
 */
export function verifyXrayRuntimeCmd(plan: ManagedXrayRuntimePlan | null) {
  if (!plan) return "true";
  const readyChecks = [
    `if command -v systemctl >/dev/null 2>&1; then systemctl is-active --quiet ${shQuote(XRAY_SERVICE_NAME)} || return 1; else pgrep -f ${shQuote(`${XRAY_BIN}.*${XRAY_CONFIG_PATH}`)} >/dev/null || return 1; fi`,
  ];
  for (const socket of plan.sockets) {
    readyChecks.push(`ss -H -lnt | awk '{print $4}' | grep -Eq ${shQuote(`(^|:|\\])${socket.listenPort}$`)} || return 1`);
  }
  readyChecks.push("return 0");

  return [
    `${shQuote(XRAY_BIN)} run -test -c ${shQuote(XRAY_CONFIG_PATH)} >/dev/null || exit 1`,
    "xray_runtime_ready() {",
    ...readyChecks.map((check) => `  ${check}`),
    "}",
    "attempt=1",
    "while ! xray_runtime_ready; do",
    `  if [ "$attempt" -ge 10 ]; then echo "ForwardX Xray runtime did not become ready after 10 checks" >&2; exit 1; fi`,
    "  attempt=$((attempt + 1))",
    "  sleep 1",
    "done",
  ].join("\n");
}
