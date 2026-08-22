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
