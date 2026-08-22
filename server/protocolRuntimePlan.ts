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
