export const PROTOCOL_ACCESS_PROTOCOLS = ["shadowsocks", "shadowsocks_ssh", "mieru"] as const;
export type ProtocolAccessProtocol = typeof PROTOCOL_ACCESS_PROTOCOLS[number];

export const PROTOCOL_ACCESS_RUNTIME_MODES = ["external", "managed"] as const;
export type ProtocolAccessRuntimeMode = typeof PROTOCOL_ACCESS_RUNTIME_MODES[number];

export type ProtocolAccessConfig = Record<string, unknown>;

export const MANAGED_SHADOWSOCKS_CIPHERS = [
  "chacha20-ietf-poly1305",
  "aes-256-gcm",
  "aes-128-gcm",
] as const;

export const MIERU_TRANSPORTS = ["TCP", "UDP"] as const;
export const MIERU_MULTIPLEXING_LEVELS = [
  "MULTIPLEXING_OFF",
  "MULTIPLEXING_LOW",
  "MULTIPLEXING_MIDDLE",
  "MULTIPLEXING_HIGH",
] as const;
export const MIERU_HANDSHAKE_MODES = ["HANDSHAKE_STANDARD", "HANDSHAKE_NO_WAIT"] as const;

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

export function managedProtocolListenPort(config: ProtocolAccessConfig, publicPort: number) {
  return protocolConfigPort(config, "listenPort") || publicPort;
}

export function isManagedShadowsocksCipher(value: unknown) {
  return (MANAGED_SHADOWSOCKS_CIPHERS as readonly string[]).includes(String(value || "").trim());
}

export function effectiveProtocolSecret(entry: ProtocolFeedEntry) {
  return protocolConfigSecret(entry.credential, "password")
    || protocolConfigSecret(entry.endpointConfig, "password");
}

export function effectiveProtocolUsername(entry: ProtocolFeedEntry) {
  return protocolConfigText(entry.credential, "username")
    || protocolConfigText(entry.endpointConfig, "username");
}

export function validateProtocolEndpointConfig(
  protocol: ProtocolAccessProtocol,
  config: ProtocolAccessConfig,
) {
  const errors: string[] = [];
  if (protocol === "mieru") {
    const transport = protocolConfigText(config, "transport");
    if (!(MIERU_TRANSPORTS as readonly string[]).includes(transport)) {
      errors.push("transport 必须是 TCP 或 UDP");
    }
    const mtuValue = config.mtu;
    if (mtuValue !== undefined && mtuValue !== null && mtuValue !== "") {
      const mtu = Number(mtuValue);
      if (!Number.isInteger(mtu) || mtu < 1280 || mtu > 1400) errors.push("mtu 必须是 1280-1400");
    }
    const multiplexing = protocolConfigText(config, "multiplexing");
    if (!(MIERU_MULTIPLEXING_LEVELS as readonly string[]).includes(multiplexing)) {
      errors.push("multiplexing 取值无效");
    }
    const handshakeMode = protocolConfigText(config, "handshakeMode");
    if (!(MIERU_HANDSHAKE_MODES as readonly string[]).includes(handshakeMode)) {
      errors.push("handshakeMode 取值无效");
    }
    return errors;
  }
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
  if (entry.protocol === "mieru" && !effectiveProtocolUsername(entry)) errors.push("username 不能为空");
  if (!effectiveProtocolSecret(entry)) errors.push("password 不能为空");
  return errors;
}
