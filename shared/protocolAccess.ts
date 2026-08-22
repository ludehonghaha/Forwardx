export const PROTOCOL_ACCESS_PROTOCOLS = ["shadowsocks", "shadowsocks_ssh"] as const;
export type ProtocolAccessProtocol = typeof PROTOCOL_ACCESS_PROTOCOLS[number];

export const PROTOCOL_ACCESS_RUNTIME_MODES = ["external", "managed"] as const;
export type ProtocolAccessRuntimeMode = typeof PROTOCOL_ACCESS_RUNTIME_MODES[number];

export type ProtocolAccessConfig = Record<string, unknown>;

export type ProtocolFeedEntry = {
  assignmentId: number;
  endpointId: number;
  name: string;
  protocol: ProtocolAccessProtocol;
  publicHost: string;
  publicPort: number;
  endpointConfig: ProtocolAccessConfig;
  credential: ProtocolAccessConfig;
};

export function parseProtocolAccessConfig(value: unknown): ProtocolAccessConfig {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as ProtocolAccessConfig;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as ProtocolAccessConfig
      : {};
  } catch {
    return {};
  }
}

export function protocolConfigText(config: ProtocolAccessConfig, key: string) {
  const value = config[key];
  return typeof value === "string" ? value.trim() : "";
}

export function protocolConfigSecret(config: ProtocolAccessConfig, key: string) {
  const value = config[key];
  return typeof value === "string" ? value : "";
}

export function protocolConfigPort(config: ProtocolAccessConfig, key: string) {
  const value = Math.floor(Number(config[key]));
  return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : 0;
}

export function protocolConfigBool(config: ProtocolAccessConfig, key: string, fallback = false) {
  const value = config[key];
  return typeof value === "boolean" ? value : fallback;
}

export function effectiveProtocolSecret(entry: ProtocolFeedEntry) {
  return protocolConfigSecret(entry.credential, "password")
    || protocolConfigSecret(entry.endpointConfig, "password");
}

export function validateProtocolEndpointConfig(
  protocol: ProtocolAccessProtocol,
  config: ProtocolAccessConfig,
) {
  const errors: string[] = [];
  if (!protocolConfigText(config, "cipher")) errors.push("cipher 不能为空");
  if (protocol === "shadowsocks_ssh") {
    if (!protocolConfigPort(config, "remotePort")) errors.push("remotePort 必须是 1-65535");
    if (!protocolConfigText(config, "sshUsername")) errors.push("sshUsername 不能为空");
    if (!protocolConfigText(config, "sshPrivateKey")) errors.push("sshPrivateKey 不能为空");
  }
  return errors;
}

export function validateProtocolFeedEntry(entry: ProtocolFeedEntry) {
  const errors = validateProtocolEndpointConfig(entry.protocol, entry.endpointConfig);
  if (!entry.name.trim()) errors.push("name 不能为空");
  if (!entry.publicHost.trim()) errors.push("publicHost 不能为空");
  if (!Number.isInteger(entry.publicPort) || entry.publicPort < 1 || entry.publicPort > 65535) {
    errors.push("publicPort 必须是 1-65535");
  }
  if (!effectiveProtocolSecret(entry)) errors.push("password 不能为空");
  return errors;
}
