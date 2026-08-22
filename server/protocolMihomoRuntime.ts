import type { ManagedMihomoRuntimePlan } from "./protocolRuntimePlan";

export const MIHOMO_VERSION = "1.19.29";
export const MIHOMO_BIN = "/usr/local/bin/forwardx-mihomo";
export const MIHOMO_SERVICE_NAME = "forwardx-mihomo";
export const MIHOMO_CONFIG_DIR = "/etc/forwardx/mihomo";
export const MIHOMO_CONFIG_PATH = `${MIHOMO_CONFIG_DIR}/config.yaml`;
export const MIHOMO_CERT_DIR = `${MIHOMO_CONFIG_DIR}/certs`;

function shQuote(value: string) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

export function ensureMihomoBinaryCmd() {
  const target = shQuote(MIHOMO_BIN);
  const version = shQuote(`v${MIHOMO_VERSION}`);
  const releaseBase = `https://github.com/MetaCubeX/mihomo/releases/download/v${MIHOMO_VERSION}`;
  return [
    `mihomo_version_ok() { [ -x "$1" ] && "$1" -v 2>&1 | grep -F -- ${version} >/dev/null 2>&1; }`,
    `if ! mihomo_version_ok ${target}; then`,
    `  arch="$(uname -m)"; case "$arch" in x86_64|amd64) asset=${shQuote(`mihomo-linux-amd64-v1-v${MIHOMO_VERSION}.gz`)} ;; aarch64|arm64) asset=${shQuote(`mihomo-linux-arm64-v${MIHOMO_VERSION}.gz`)} ;; *) echo "unsupported Mihomo architecture: $arch" >&2; exit 1 ;; esac;`,
    `  tmp_gz="$(mktemp /tmp/forwardx-mihomo.XXXXXX.gz)"; tmp_bin="$(mktemp /tmp/forwardx-mihomo.XXXXXX)"; trap 'rm -f "$tmp_gz" "$tmp_bin"' EXIT;`,
    `  curl -fL --retry 3 --retry-delay 2 --connect-timeout 15 ${shQuote(`${releaseBase}/`)}"$asset" -o "$tmp_gz";`,
    `  gzip -dc "$tmp_gz" > "$tmp_bin"; chmod 0755 "$tmp_bin"; mihomo_version_ok "$tmp_bin"; install -m 0755 "$tmp_bin" ${target};`,
    `  rm -f "$tmp_gz" "$tmp_bin"; trap - EXIT;`,
    `fi; mihomo_version_ok ${target}`,
  ].join(" ");
}

export function mihomoServiceUnit() {
  return [
    "[Unit]",
    "Description=ForwardX managed Mihomo entry protocols",
    "After=network-online.target",
    "Wants=network-online.target",
    "StartLimitIntervalSec=60",
    "StartLimitBurst=5",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${MIHOMO_BIN} -d ${MIHOMO_CONFIG_DIR} -f ${MIHOMO_CONFIG_PATH}`,
    "Restart=on-failure",
    "RestartSec=2",
    "LimitNOFILE=1048576",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    "",
  ].join("\n");
}

export function ensureMihomoCertificateCmds(plan: ManagedMihomoRuntimePlan | null) {
  if (!plan || plan.certificates.length === 0) return [];
  const commands = [`mkdir -p ${shQuote(MIHOMO_CERT_DIR)}`, "command -v openssl >/dev/null 2>&1"];
  for (const certificate of plan.certificates) {
    const cert = shQuote(certificate.certPath);
    const key = shQuote(certificate.keyPath);
    const subject = shQuote(`/CN=${certificate.serverName.replace(/[\r\n/]/g, "_")}`);
    commands.push(
      `if [ ! -s ${cert} ] || [ ! -s ${key} ] || ! openssl x509 -checkend 86400 -noout -in ${cert} >/dev/null 2>&1; then rm -f ${cert} ${key}; openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 3650 -subj ${subject} -keyout ${key} -out ${cert} >/dev/null 2>&1; chmod 0600 ${key}; chmod 0644 ${cert}; fi`,
    );
  }
  return commands;
}

export function verifyMihomoRuntimeCmd(plan: ManagedMihomoRuntimePlan | null) {
  if (!plan) return "true";
  const checks = [
    `${shQuote(MIHOMO_BIN)} -t -d ${shQuote(MIHOMO_CONFIG_DIR)} -f ${shQuote(MIHOMO_CONFIG_PATH)} >/dev/null`,
    `if command -v systemctl >/dev/null 2>&1; then systemctl is-active --quiet ${shQuote(MIHOMO_SERVICE_NAME)}; else pgrep -f ${shQuote(`${MIHOMO_BIN}.*${MIHOMO_CONFIG_PATH}`)} >/dev/null; fi`,
  ];
  for (const socket of plan.sockets) {
    const ssFlag = socket.transport === "udp" ? "-H -lnu" : "-H -lnt";
    checks.push(`ss ${ssFlag} | awk '{print $5}' | grep -Eq ${shQuote(`(^|:|\\])${socket.listenPort}$`)}`);
  }
  return checks.join(" && ");
}
