import {
  isManagedShadowsocksCipher,
  managedProtocolListenPort,
  parseProtocolAccessConfig,
  protocolConfigBool,
  protocolConfigSecret,
  protocolConfigText,
} from "../shared/protocolAccess";

export type ManagedProtocolEndpointRow = {
  id: number;
  protocol: string;
  runtimeMode: string;
  publicPort: number;
  configJson: unknown;
  isEnabled: boolean;
};

export type ManagedProtocolGostService = {
  name: string;
  addr: string;
  handler: {
    type: "ss" | "ssu";
    auth: { username: string; password: string };
  };
  listener: { type: "tcp" | "udp" };
};

export type ManagedMieruRuntimePlan = {
  endpointId: number;
  listenPort: number;
  transport: "TCP" | "UDP";
  config: {
    portBindings: Array<{ port: number; protocol: "TCP" | "UDP" }>;
    users: Array<{ name: string; password: string }>;
    loggingLevel: "INFO";
    mtu: number;
  };
};

export type ManagedMihomoRuntimeSocket = {
  endpointId: number;
  protocol: "snell" | "vless_reality" | "hysteria2";
  listenPort: number;
  transport: "tcp" | "udp";
};

export type ManagedMihomoCertificate = {
  endpointId: number;
  serverName: string;
  certPath: string;
  keyPath: string;
};

export type ManagedMihomoRuntimePlan = {
  sockets: ManagedMihomoRuntimeSocket[];
  certificates: ManagedMihomoCertificate[];
  config: Record<string, unknown>;
};

/**
 * Compile managed protocol endpoints into the existing shared GOST runtime.
 * The protocol layer deliberately does not create another Agent task, config
 * file or service: gost-runtime-sync validates and applies this combined list.
 */
export function buildManagedProtocolGostServices(rows: ManagedProtocolEndpointRow[]) {
  const services: ManagedProtocolGostService[] = [];
  for (const row of [...rows].sort((left, right) => Number(left.id) - Number(right.id))) {
    if (!row?.isEnabled || row.runtimeMode !== "managed" || row.protocol !== "shadowsocks") continue;
    const config = parseProtocolAccessConfig(row.configJson);
    const cipher = protocolConfigText(config, "cipher");
    const password = protocolConfigSecret(config, "password");
    const listenPort = managedProtocolListenPort(config, Number(row.publicPort));
    if (!isManagedShadowsocksCipher(cipher) || !password || listenPort < 1 || listenPort > 65535) continue;
    const auth = { username: cipher, password };
    services.push({
      name: `fwx-protocol-${Number(row.id)}-tcp`,
      addr: `:${listenPort}`,
      handler: { type: "ss", auth },
      listener: { type: "tcp" },
    });
    if (protocolConfigBool(config, "udp", false)) {
      services.push({
        name: `fwx-protocol-${Number(row.id)}-udp`,
        addr: `:${listenPort}`,
        handler: { type: "ssu", auth },
        listener: { type: "udp" },
      });
    }
  }
  return services;
}

/**
 * Compile the single managed Mieru endpoint on a host into one mita config.
 * Client-only settings intentionally stay in subscriptions and never create
 * additional server listeners.
 */
export function buildManagedMieruRuntimePlan(rows: ManagedProtocolEndpointRow[]): ManagedMieruRuntimePlan | null {
  const candidates = [...rows]
    .filter((row) => row?.isEnabled && row.runtimeMode === "managed" && row.protocol === "mieru")
    .sort((left, right) => Number(left.id) - Number(right.id));
  if (candidates.length !== 1) return null;

  const row = candidates[0];
  const config = parseProtocolAccessConfig(row.configJson);
  const username = protocolConfigText(config, "username");
  const password = protocolConfigSecret(config, "password");
  const listenPort = managedProtocolListenPort(config, Number(row.publicPort));
  const transport = protocolConfigText(config, "transport");
  const mtu = Number(config.mtu ?? 1400);
  if (!username || !password || listenPort < 1 || listenPort > 65535) return null;
  if (transport !== "TCP" && transport !== "UDP") return null;
  if (!Number.isInteger(mtu) || mtu < 1280 || mtu > 1400) return null;

  return {
    endpointId: Number(row.id),
    listenPort,
    transport,
    config: {
      portBindings: [{ port: listenPort, protocol: transport }],
      users: [{ name: username, password }],
      loggingLevel: "INFO",
      mtu,
    },
  };
}

function validPort(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function managedSnellListener(row: ManagedProtocolEndpointRow) {
  const config = parseProtocolAccessConfig(row.configJson);
  const listenPort = managedProtocolListenPort(config, Number(row.publicPort));
  const password = protocolConfigSecret(config, "password");
  const version = Number(config.version ?? 5);
  if (!validPort(listenPort) || !password || !Number.isInteger(version) || version < 1 || version > 5) return null;
  const listener: Record<string, unknown> = {
    name: `fwx-snell-${Number(row.id)}`,
    type: "snell",
    port: listenPort,
    listen: "0.0.0.0",
    psk: password,
    version,
    udp: protocolConfigBool(config, "udp", true),
  };
  const obfsMode = protocolConfigText(config, "obfsMode");
  const obfsHost = protocolConfigText(config, "obfsHost");
  if (obfsMode && obfsHost) listener["obfs-opts"] = { mode: obfsMode, host: obfsHost };
  return { listener, socket: { endpointId: Number(row.id), protocol: "snell" as const, listenPort, transport: "tcp" as const } };
}

function managedRealityListener(row: ManagedProtocolEndpointRow) {
  const config = parseProtocolAccessConfig(row.configJson);
  const listenPort = managedProtocolListenPort(config, Number(row.publicPort));
  const uuid = protocolConfigText(config, "uuid");
  const serverName = protocolConfigText(config, "serverName");
  const dest = protocolConfigText(config, "realityDest");
  const privateKey = protocolConfigSecret(config, "realityPrivateKey");
  const shortId = protocolConfigText(config, "shortId");
  if (!validPort(listenPort) || !uuid || !serverName || !dest || !privateKey || !shortId) return null;
  const listener = {
    name: `fwx-reality-${Number(row.id)}`,
    type: "vless",
    port: listenPort,
    listen: "0.0.0.0",
    users: [{ username: "forwardx", uuid, flow: "xtls-rprx-vision" }],
    "reality-config": {
      dest,
      "private-key": privateKey,
      "short-id": [shortId],
      "server-names": [serverName],
    },
  };
  return { listener, socket: { endpointId: Number(row.id), protocol: "vless_reality" as const, listenPort, transport: "tcp" as const } };
}

function managedHysteria2Listener(row: ManagedProtocolEndpointRow) {
  const config = parseProtocolAccessConfig(row.configJson);
  const listenPort = managedProtocolListenPort(config, Number(row.publicPort));
  const password = protocolConfigSecret(config, "password");
  const serverName = protocolConfigText(config, "sni") || "www.cloudflare.com";
  if (!validPort(listenPort) || !password) return null;
  const certPath = `/etc/forwardx/mihomo/certs/hy2-${Number(row.id)}.crt`;
  const keyPath = `/etc/forwardx/mihomo/certs/hy2-${Number(row.id)}.key`;
  const listener: Record<string, unknown> = {
    name: `fwx-hysteria2-${Number(row.id)}`,
    type: "hysteria2",
    port: listenPort,
    listen: "0.0.0.0",
    users: { forwardx: password },
    up: 1000,
    down: 1000,
    "ignore-client-bandwidth": true,
    alpn: ["h3"],
    certificate: certPath,
    "private-key": keyPath,
  };
  const obfsMode = protocolConfigText(config, "obfsMode");
  const obfsPassword = protocolConfigSecret(config, "obfsPassword");
  if (obfsMode && obfsPassword) {
    listener.obfs = obfsMode;
    listener["obfs-password"] = obfsPassword;
  }
  return {
    listener,
    socket: { endpointId: Number(row.id), protocol: "hysteria2" as const, listenPort, transport: "udp" as const },
    certificate: { endpointId: Number(row.id), serverName, certPath, keyPath },
  };
}

/**
 * Snell, VLESS-Reality and Hysteria2 deliberately share one Mihomo service per
 * Agent host. They are entry protocols only; ForwardX Realm/GOST/FXP remains
 * responsible for server-to-server forwarding.
 */
export function buildManagedMihomoRuntimePlan(rows: ManagedProtocolEndpointRow[]): ManagedMihomoRuntimePlan | null {
  const candidates = [...rows]
    .filter((row) => row?.isEnabled && row.runtimeMode === "managed" && ["snell", "vless_reality", "hysteria2"].includes(row.protocol))
    .sort((left, right) => Number(left.id) - Number(right.id));
  if (candidates.length === 0) return null;

  const listeners: Record<string, unknown>[] = [];
  const sockets: ManagedMihomoRuntimeSocket[] = [];
  const certificates: ManagedMihomoCertificate[] = [];
  for (const row of candidates) {
    const compiled = row.protocol === "snell"
      ? managedSnellListener(row)
      : row.protocol === "vless_reality"
        ? managedRealityListener(row)
        : managedHysteria2Listener(row);
    if (!compiled) return null;
    listeners.push(compiled.listener);
    sockets.push(compiled.socket);
    if ("certificate" in compiled && compiled.certificate) certificates.push(compiled.certificate);
  }

  const socketKeys = sockets.map((socket) => `${socket.transport}:${socket.listenPort}`);
  if (new Set(socketKeys).size !== socketKeys.length) return null;

  return {
    sockets,
    certificates,
    config: {
      mode: "rule",
      "log-level": "warning",
      ipv6: true,
      listeners,
      rules: ["MATCH,DIRECT"],
    },
  };
}
