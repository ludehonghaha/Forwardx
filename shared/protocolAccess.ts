export const PROTOCOL_ACCESS_PROTOCOLS = [
  "shadowsocks",
  "shadowsocks_ssh",
  "mieru",
  "snell",
  "vless_reality",
  "hysteria2",
] as const;
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

export const SNELL_VERSIONS = [1, 2, 3, 4, 5] as const;
export const SNELL_OBFS_MODES = ["", "http", "tls"] as const;
export const REALITY_CLIENT_FINGERPRINTS = ["chrome", "firefox", "safari", "iOS", "android", "edge", "random"] as const;
export const HYSTERIA2_OBFS_MODES = ["", "salamander"] as const;

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

export function protocolNeedsPassword(protocol: ProtocolAccessProtocol) {
  return protocol !== "vless_reality";
}

export function managedProtocolSocketProtocol(protocol: ProtocolAccessProtocol, config: ProtocolAccessConfig): "tcp" | "udp" | "both" {
  if (protocol === "mieru") {
    return protocolConfigText(config, "transport").toLowerCase() === "udp" ? "udp" : "tcp";
  }
  if (protocol === "hysteria2") return "udp";
  if (protocol === "snell" || protocol === "vless_reality") return "tcp";
  return protocolConfigBool(config, "udp", false) ? "both" : "tcp";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isRealityKey(value: string) {
  return /^[A-Za-z0-9_-]{40,64}$/.test(value);
}

function isShortId(value: string) {
  return /^(?:[0-9a-fA-F]{2}){1,8}$/.test(value);
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
  if (protocol === "snell") {
    const version = Number(config.version ?? 5);
    if (!(SNELL_VERSIONS as readonly number[]).includes(version)) errors.push("Snell version 必须是 1-5");
    if (protocolConfigBool(config, "udp", true) && version < 3) errors.push("Snell UDP 需要 version 3-5");
    const obfsMode = protocolConfigText(config, "obfsMode");
    if (!(SNELL_OBFS_MODES as readonly string[]).includes(obfsMode)) errors.push("Snell obfsMode 取值无效");
    if (obfsMode && !protocolConfigText(config, "obfsHost")) errors.push("启用 Snell 混淆时 obfsHost 不能为空");
    return errors;
  }
  if (protocol === "vless_reality") {
    const uuid = protocolConfigText(config, "uuid");
    if (!isUuid(uuid)) errors.push("VLESS UUID 无效");
    if (!protocolConfigText(config, "serverName")) errors.push("Reality serverName 不能为空");
    if (!protocolConfigText(config, "realityDest")) errors.push("Reality dest 不能为空");
    if (!isRealityKey(protocolConfigText(config, "realityPublicKey"))) errors.push("Reality public key 无效");
    if (!isShortId(protocolConfigText(config, "shortId"))) errors.push("Reality short ID 必须是 2-16 位十六进制字符");
    const fingerprint = protocolConfigText(config, "clientFingerprint") || "chrome";
    if (!(REALITY_CLIENT_FINGERPRINTS as readonly string[]).includes(fingerprint)) errors.push("Reality 客户端指纹无效");
    return errors;
  }
  if (protocol === "hysteria2") {
    const obfsMode = protocolConfigText(config, "obfsMode");
    if (!(HYSTERIA2_OBFS_MODES as readonly string[]).includes(obfsMode)) errors.push("Hysteria2 obfsMode 取值无效");
    if (obfsMode === "salamander" && !protocolConfigSecret(config, "obfsPassword")) {
      errors.push("启用 Hysteria2 Salamander 时 obfsPassword 不能为空");
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
  if (protocolNeedsPassword(entry.protocol) && !effectiveProtocolSecret(entry)) errors.push("password 不能为空");
  return errors;
}
