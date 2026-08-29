import type { ProtocolAccessConfig, ProtocolAccessProtocol } from "../shared/protocolAccess";

export const NOBRAND_PROVIDER_SOURCE = {
  repository: "ike-sh/NoBrand-OneClick",
  schemaVersion: 3,
  project: "NoBrand-OneClick",
  ownership: "nobrand-v3",
  mieruUsersVersion: 2,
  mieruDeploymentModel: "isolated-v2",
} as const;

export type NoBrandProviderSnapshot = {
  registry: unknown;
  autoPublicHost?: string;
  mieruInstallState?: string;
  mieruUsers?: unknown;
  snellStates?: unknown[];
  hysteria2State?: unknown;
  vlessSudokuState?: unknown;
};

export type NoBrandExternalNode = {
  sourceKey: string;
  protocol: ProtocolAccessProtocol;
  name: string;
  publicHost: string;
  publicPort: number;
  endpointConfig: ProtocolAccessConfig;
  credential: ProtocolAccessConfig;
  enabled: boolean;
};

export type NoBrandProviderSkip = {
  sourceKey: string;
  reason: string;
};

export type NoBrandProviderParseResult = {
  registryValid: boolean;
  nodes: NoBrandExternalNode[];
  skipped: NoBrandProviderSkip[];
  errors: string[];
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function jsonRecord(value: unknown): JsonRecord | null {
  if (typeof value !== "string") return record(value);
  try {
    return record(JSON.parse(value));
  } catch {
    return null;
  }
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function secret(value: unknown) {
  return typeof value === "string" ? value : "";
}

function integer(value: unknown, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : 0;
}

function booleanValue(value: unknown, fallback = true) {
  return typeof value === "boolean" ? value : fallback;
}

function validHost(value: string) {
  const host = value.trim();
  return host.length > 0 && host.length <= 253 && !/[\s\x00-\x1f\x7f]/.test(host);
}

function exactRegistryValid(value: unknown) {
  const registry = jsonRecord(value);
  return !!registry
    && registry.schema_version === NOBRAND_PROVIDER_SOURCE.schemaVersion
    && registry.project === NOBRAND_PROVIDER_SOURCE.project
    && registry.ownership === NOBRAND_PROVIDER_SOURCE.ownership;
}

/**
 * NoBrand writes install-state.env with Bash printf %q. Provider discovery must
 * never source that file, so we intentionally accept only the simple scalar
 * subset needed for protocol rendering. The relevant v3 values are enums and
 * integers and therefore never require shell evaluation.
 */
function parseSafeInstallState(input: unknown) {
  if (typeof input !== "string") return null;
  const values = new Map<string, string>();
  for (const rawLine of input.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(rawLine);
    if (!match) continue;
    const rawValue = match[2];
    if (rawValue === "''") {
      values.set(match[1], "");
      continue;
    }
    if (!/^[A-Za-z0-9._:/+@,-]*$/.test(rawValue)) continue;
    values.set(match[1], rawValue);
  }
  if (values.get("SCHEMA_VERSION") !== "3"
      || values.get("OWNERSHIP") !== "nobrand-v3"
      || values.get("INSTALL_METHOD") !== "nobrand-v3") {
    return null;
  }
  return values;
}

function endpointFromState(
  state: JsonRecord,
  listenPort: number,
  autoPublicHost: string,
): { host: string; port: number } | null {
  const mode = text(state.advertise_mode);
  if (mode === "custom") {
    const host = text(state.advertise_host);
    const port = integer(state.advertise_port, 1, 65535);
    return validHost(host) && port ? { host, port } : null;
  }
  if (mode === "auto") {
    return validHost(autoPublicHost) ? { host: autoPublicHost, port: listenPort } : null;
  }
  return null;
}

function endpointFromMieruUser(
  user: JsonRecord,
  autoPublicHost: string,
): { host: string; port: number } | null {
  const listenPort = integer(user.port, 1, 65535);
  if (!listenPort) return null;
  const advertisedHost = text(user.advertise_host);
  const advertisedPort = integer(user.advertise_port, 1, 65535);
  if (advertisedHost || advertisedPort) {
    return validHost(advertisedHost) && advertisedPort
      ? { host: advertisedHost, port: advertisedPort }
      : null;
  }
  return validHost(autoPublicHost) ? { host: autoPublicHost, port: listenPort } : null;
}

function pushMieruNodes(
  snapshot: NoBrandProviderSnapshot,
  nodes: NoBrandExternalNode[],
  skipped: NoBrandProviderSkip[],
) {
  if (snapshot.mieruUsers === undefined && snapshot.mieruInstallState === undefined) return;
  const install = parseSafeInstallState(snapshot.mieruInstallState);
  const usersState = jsonRecord(snapshot.mieruUsers);
  if (!install || !usersState) {
    skipped.push({ sourceKey: "mieru", reason: "Mieru v3 install-state/users.json 不完整或不可信" });
    return;
  }
  if (usersState.version !== NOBRAND_PROVIDER_SOURCE.mieruUsersVersion
      || usersState.deployment_model !== NOBRAND_PROVIDER_SOURCE.mieruDeploymentModel) {
    skipped.push({ sourceKey: "mieru", reason: "仅接受 NoBrand Mieru users.json v2 isolated-v2" });
    return;
  }

  const stateProtocol = text(usersState.protocol).toUpperCase();
  const installProtocol = text(install.get("PROTOCOL")).toUpperCase();
  if (!["TCP", "UDP", "BOTH"].includes(stateProtocol) || stateProtocol !== installProtocol) {
    skipped.push({ sourceKey: "mieru", reason: "Mieru 协议状态不一致" });
    return;
  }
  const mtu = integer(install.get("MTU"), 1280, 1400);
  const multiplexing = text(install.get("MULTIPLEXING"));
  const handshakeMode = text(install.get("HANDSHAKE_MODE"));
  const trafficPatternMode = text(install.get("TRAFFIC_PATTERN")).toLowerCase();
  const lowEntropyMode = text(install.get("LOW_ENTROPY_MODE")).toUpperCase();
  if (!mtu
      || !["MULTIPLEXING_OFF", "MULTIPLEXING_LOW", "MULTIPLEXING_MIDDLE", "MULTIPLEXING_HIGH"].includes(multiplexing)
      || !["HANDSHAKE_STANDARD", "HANDSHAKE_NO_WAIT"].includes(handshakeMode)) {
    skipped.push({ sourceKey: "mieru", reason: "Mieru 客户端参数不足，拒绝猜测配置" });
    return;
  }
  // NoBrand stores only the traffic-pattern mode in install-state.env. When
  // enabled, its client export asks Mita for the actual generated pattern and
  // emits that opaque value. Passing through "conservative"/"aggressive" (or
  // literal "off") would silently produce a different client configuration.
  if (trafficPatternMode !== "off") {
    skipped.push({ sourceKey: "mieru", reason: "Mieru 已启用 traffic-pattern，需读取 Mita 实际导出值后才能无损导入" });
    return;
  }
  // ForwardX does not yet model NoBrand's experimental low-entropy client
  // option. Import only the exact off state rather than dropping it silently.
  if (lowEntropyMode !== "LOW_ENTROPY_MODE_OFF") {
    skipped.push({ sourceKey: "mieru", reason: "Mieru 已启用 Low Entropy，ForwardX 当前不能无损表达该客户端参数" });
    return;
  }

  const users = Array.isArray(usersState.users) ? usersState.users : [];
  for (const rawUser of users) {
    const user = record(rawUser);
    const instanceId = user ? text(user.instance_id) : "";
    const sourceBase = instanceId && /^u[0-9a-f]{16}$/.test(instanceId) ? `mieru:${instanceId}` : "mieru:invalid";
    if (!user || !/^u[0-9a-f]{16}$/.test(instanceId)) {
      skipped.push({ sourceKey: sourceBase, reason: "Mieru instance_id 无效" });
      continue;
    }
    const username = text(user.name);
    const password = secret(user.password);
    const endpoint = endpointFromMieruUser(user, text(snapshot.autoPublicHost));
    if (!username || !password || !endpoint) {
      skipped.push({ sourceKey: sourceBase, reason: "Mieru 用户凭据或客户端入口无效" });
      continue;
    }

    const transports = stateProtocol === "BOTH" ? ["TCP", "UDP"] as const : [stateProtocol as "TCP" | "UDP"];
    for (const transport of transports) {
      const isSecondaryUdp = stateProtocol === "BOTH" && transport === "UDP";
      if (isSecondaryUdp && endpoint.port >= 65535) {
        skipped.push({ sourceKey: `${sourceBase}:udp`, reason: "Mieru BOTH 的 UDP 端口超出范围" });
        continue;
      }
      nodes.push({
        sourceKey: `${sourceBase}:${transport.toLowerCase()}`,
        protocol: "mieru",
        name: stateProtocol === "BOTH" ? `${username} · ${transport}` : username,
        publicHost: endpoint.host,
        publicPort: endpoint.port + (isSecondaryUdp ? 1 : 0),
        endpointConfig: {
          transport,
          mtu,
          multiplexing,
          handshakeMode,
          trafficPattern: "",
          udp: true,
          provider: "nobrand-v3",
        },
        credential: { username, password },
        enabled: booleanValue(user.enabled),
      });
    }
  }
}

function pushSnellNodes(
  snapshot: NoBrandProviderSnapshot,
  nodes: NoBrandExternalNode[],
  skipped: NoBrandProviderSkip[],
) {
  for (const rawState of snapshot.snellStates || []) {
    const state = jsonRecord(rawState);
    const instanceId = state ? text(state.instance_id) : "";
    const sourceKey = instanceId ? `snell:${instanceId}` : "snell:invalid";
    if (!state || !/^s[0-9a-f]{16}$/.test(instanceId) || state.protocol !== "snell") {
      skipped.push({ sourceKey, reason: "Snell state 无效" });
      continue;
    }
    const version = integer(state.version, 4, 5);
    const listenPort = integer(state.listen_port, 1, 65535);
    const endpoint = listenPort ? endpointFromState(state, listenPort, text(snapshot.autoPublicHost)) : null;
    const psk = secret(state.psk);
    if (!version || !endpoint || !psk) {
      skipped.push({ sourceKey, reason: "Snell 版本、凭据或客户端入口无效" });
      continue;
    }
    // NoBrand's Mihomo export always uses ordinary `udp: true`. Its separate
    // Snell v5 QUIC Proxy Mode opens same-port UDP but the upstream exporter
    // explicitly marks the client semantics NOT VERIFIED. Do not silently map
    // that runtime feature to Mihomo's ordinary Snell UDP relay flag.
    if (version === 5 && state.quic_proxy_enabled === true) {
      skipped.push({ sourceKey, reason: "Snell v5 已启用 QUIC Proxy Mode；NoBrand 标记客户端语义未验证，当前拒绝降级为普通 Snell UDP" });
      continue;
    }
    nodes.push({
      sourceKey,
      protocol: "snell",
      name: text(state.name) || `NoBrand-Snell-v${version}`,
      publicHost: endpoint.host,
      publicPort: endpoint.port,
      endpointConfig: {
        version,
        udp: true,
        obfsMode: "",
        provider: "nobrand-v3",
      },
      credential: { password: psk },
      enabled: booleanValue(state.enabled),
    });
  }
}

function pushHysteria2Node(
  snapshot: NoBrandProviderSnapshot,
  nodes: NoBrandExternalNode[],
  skipped: NoBrandProviderSkip[],
) {
  if (snapshot.hysteria2State === undefined) return;
  const state = jsonRecord(snapshot.hysteria2State);
  const sourceKey = "hysteria2:default";
  if (!state || state.protocol !== "hysteria2") {
    skipped.push({ sourceKey, reason: "Hysteria2 state 无效" });
    return;
  }
  const listenPort = integer(state.listen_port, 1, 65535);
  const endpoint = listenPort ? endpointFromState(state, listenPort, text(snapshot.autoPublicHost)) : null;
  const auth = secret(state.auth);
  const sni = text(state.sni);
  const obfsPassword = secret(state.obfs);
  if (!endpoint || !auth || !sni) {
    skipped.push({ sourceKey, reason: "Hysteria2 凭据、SNI 或客户端入口无效" });
    return;
  }
  nodes.push({
    sourceKey,
    protocol: "hysteria2",
    name: "NoBrand-Hysteria2",
    publicHost: endpoint.host,
    publicPort: endpoint.port,
    endpointConfig: {
      sni,
      insecure: true,
      obfsMode: obfsPassword ? "salamander" : "",
      obfsPassword,
      alpn: ["h3"],
      provider: "nobrand-v3",
    },
    credential: { password: auth },
    enabled: booleanValue(state.enabled),
  });
}

function noteUnsupportedVless(
  snapshot: NoBrandProviderSnapshot,
  skipped: NoBrandProviderSkip[],
) {
  if (snapshot.vlessSudokuState === undefined) return;
  const state = jsonRecord(snapshot.vlessSudokuState);
  if (state?.protocol === "vless-sudoku") {
    skipped.push({
      sourceKey: "vless-sudoku:default",
      reason: "ForwardX 当前支持 VLESS Reality，不把 VLESS + FinalMask Sudoku 伪装成 Reality 导入",
    });
    return;
  }
  skipped.push({ sourceKey: "vless-sudoku:default", reason: "VLESS Sudoku state 无效" });
}

/**
 * Pure, read-only adapter for NoBrand v3 state. It never reads the filesystem,
 * runs NoBrand commands or takes runtime ownership. A later Agent probe may
 * supply these file contents and import the returned nodes as runtimeMode=external.
 */
export function parseNoBrandProviderSnapshot(snapshot: NoBrandProviderSnapshot): NoBrandProviderParseResult {
  const result: NoBrandProviderParseResult = {
    registryValid: exactRegistryValid(snapshot.registry),
    nodes: [],
    skipped: [],
    errors: [],
  };
  if (!result.registryValid) {
    result.errors.push("NoBrand state.json 不是精确 schema v3 / nobrand-v3 ownership，拒绝读取子状态");
    return result;
  }

  pushMieruNodes(snapshot, result.nodes, result.skipped);
  pushSnellNodes(snapshot, result.nodes, result.skipped);
  pushHysteria2Node(snapshot, result.nodes, result.skipped);
  noteUnsupportedVless(snapshot, result.skipped);

  const seen = new Set<string>();
  result.nodes = result.nodes.filter((node) => {
    if (seen.has(node.sourceKey)) {
      result.skipped.push({ sourceKey: node.sourceKey, reason: "重复 NoBrand sourceKey" });
      return false;
    }
    seen.add(node.sourceKey);
    return true;
  });
  return result;
}
