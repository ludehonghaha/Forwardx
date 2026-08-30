import crypto from "node:crypto";
import type { ProtocolAccessConfig, ProtocolAccessProtocol } from "../shared/protocolAccess";

export type NoBrandCandidateKind = "mieru" | "snell" | "hysteria2" | "vless-sudoku";

export type NoBrandProtocolCandidate = {
  candidateId: string;
  source: "nobrand";
  sourceKind: NoBrandCandidateKind;
  name: string;
  publicHost: string;
  publicPort: number;
  supported: boolean;
  protocol: ProtocolAccessProtocol | null;
  config: ProtocolAccessConfig;
  unsupportedReason?: string;
};

type SnapshotObject = Record<string, unknown>;

const VALID_MIERU_TRANSPORTS = new Set(["TCP", "UDP"]);
const VALID_MIERU_MULTIPLEXING = new Set([
  "MULTIPLEXING_OFF",
  "MULTIPLEXING_LOW",
  "MULTIPLEXING_MIDDLE",
  "MULTIPLEXING_HIGH",
]);
const VALID_MIERU_HANDSHAKES = new Set(["HANDSHAKE_STANDARD", "HANDSHAKE_NO_WAIT"]);

function objectValue(value: unknown): SnapshotObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as SnapshotObject : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function secret(value: unknown) {
  return typeof value === "string" ? value : "";
}

function port(value: unknown) {
  const number = Math.floor(Number(value));
  return Number.isInteger(number) && number >= 1 && number <= 65535 ? number : 0;
}

function enabled(value: unknown, fallback = true) {
  return typeof value === "boolean" ? value : fallback;
}

function parseJsonObject(value: unknown): SnapshotObject | null {
  if (objectValue(value)) return objectValue(value);
  if (typeof value !== "string") return null;
  try {
    return objectValue(JSON.parse(value));
  } catch {
    return null;
  }
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseInstallState(value: unknown) {
  const state: Record<string, string> = {};
  if (typeof value !== "string") return state;
  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (!/^[A-Z0-9_]{1,64}$/.test(key)) continue;
    let raw = line.slice(index + 1).trim();
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      raw = raw.slice(1, -1);
    }
    state[key] = raw;
  }
  return state;
}

function candidateId(kind: NoBrandCandidateKind, publicHost: string, publicPort: number, identity = "") {
  return crypto.createHash("sha256")
    .update(JSON.stringify(["nobrand", kind, publicHost.toLowerCase(), publicPort, identity]))
    .digest("hex")
    .slice(0, 24);
}

function uniqueName(prefix: string, label: string, portNumber: number) {
  const suffix = label.trim() || String(portNumber);
  return `NoBrand ${prefix} · ${suffix}`.slice(0, 120);
}

function requireRegistry(snapshot: SnapshotObject) {
  const registry = parseJsonObject(snapshot.registry);
  if (!registry) throw new Error("NoBrand 扫描结果缺少有效 registry");
  if (Number(registry.schema_version) !== 3
    || text(registry.project) !== "NoBrand-OneClick"
    || text(registry.ownership) !== "nobrand-v3") {
    throw new Error("NoBrand 扫描结果 ownership marker 不受支持");
  }
}

function mieruCandidates(snapshot: SnapshotObject, publicHost: string) {
  const install = parseInstallState(snapshot.mieruInstallState);
  const users = parseJsonArray(snapshot.mieruUsers);
  const candidates: NoBrandProtocolCandidate[] = [];

  for (const rawUser of users) {
    const user = objectValue(rawUser);
    if (!user || !enabled(user.enabled, true)) continue;
    const username = text(user.name);
    const password = secret(user.password);
    const publicPort = port(user.advertise_port) || port(user.port);
    if (!username || !password || !publicPort) continue;

    const transportCandidate = (text(user.transport) || text(install.PROTOCOL) || "TCP").toUpperCase();
    const transport = VALID_MIERU_TRANSPORTS.has(transportCandidate) ? transportCandidate : "TCP";
    const multiplexingCandidate = text(user.multiplexing) || text(install.MULTIPLEXING) || "MULTIPLEXING_OFF";
    const multiplexing = VALID_MIERU_MULTIPLEXING.has(multiplexingCandidate)
      ? multiplexingCandidate
      : "MULTIPLEXING_OFF";
    const handshakeCandidate = text(user.handshake_mode) || text(user.handshakeMode) || text(install.HANDSHAKE_MODE) || "HANDSHAKE_NO_WAIT";
    const handshakeMode = VALID_MIERU_HANDSHAKES.has(handshakeCandidate)
      ? handshakeCandidate
      : "HANDSHAKE_NO_WAIT";
    const rawMtu = Number(user.mtu ?? install.MTU ?? 1400);
    const mtu = Number.isInteger(rawMtu) && rawMtu >= 1280 && rawMtu <= 1400 ? rawMtu : 1400;
    const trafficPattern = text(user.traffic_pattern) || text(user.trafficPattern) || text(install.TRAFFIC_PATTERN);

    candidates.push({
      candidateId: candidateId("mieru", publicHost, publicPort, username),
      source: "nobrand",
      sourceKind: "mieru",
      name: uniqueName("Mieru", username, publicPort),
      publicHost,
      publicPort,
      supported: true,
      protocol: "mieru",
      config: {
        username,
        password,
        transport,
        multiplexing,
        handshakeMode,
        mtu,
        udp: transport === "UDP",
        ...(trafficPattern && trafficPattern !== "off" ? { trafficPattern } : {}),
      },
    });
  }
  return candidates;
}

function snellCandidates(snapshot: SnapshotObject, publicHost: string) {
  const states = Array.isArray(snapshot.snellStates) ? snapshot.snellStates : [];
  const candidates: NoBrandProtocolCandidate[] = [];
  for (const rawState of states) {
    const state = parseJsonObject(rawState);
    if (!state) continue;
    const publicPort = port(state.listen_port);
    const password = secret(state.psk);
    const version = Math.floor(Number(state.version ?? 5));
    if (!publicPort || !password || version < 1 || version > 5) continue;
    candidates.push({
      candidateId: candidateId("snell", publicHost, publicPort),
      source: "nobrand",
      sourceKind: "snell",
      name: uniqueName("Snell", "", publicPort),
      publicHost,
      publicPort,
      supported: true,
      protocol: "snell",
      config: {
        password,
        version,
        udp: version >= 3,
        obfsMode: "",
      },
    });
  }
  return candidates;
}

function hysteria2Candidates(snapshot: SnapshotObject, publicHost: string) {
  const state = parseJsonObject(snapshot.hysteria2State);
  if (!state) return [];
  const publicPort = port(state.listen_port);
  const password = secret(state.password);
  const sni = text(state.server_name);
  const obfsPassword = secret(state.obfs_password);
  if (!publicPort || !password || !sni || !obfsPassword) return [];
  return [{
    candidateId: candidateId("hysteria2", publicHost, publicPort),
    source: "nobrand" as const,
    sourceKind: "hysteria2" as const,
    name: uniqueName("Hysteria2", "", publicPort),
    publicHost,
    publicPort,
    supported: true,
    protocol: "hysteria2" as const,
    config: {
      password,
      sni,
      insecure: true,
      alpn: ["h3"],
      obfsMode: "salamander",
      obfsPassword,
    },
  }];
}

function vlessSudokuCandidates(snapshot: SnapshotObject, publicHost: string) {
  const state = parseJsonObject(snapshot.vlessSudokuState);
  if (!state) return [];
  const publicPort = port(state.listen_port) || 443;
  const serverName = text(state.steal_domain);
  const users = parseJsonArray(state.users);
  const candidates: NoBrandProtocolCandidate[] = [];
  for (const rawUser of users) {
    const user = objectValue(rawUser);
    if (!user || !enabled(user.enable, true)) continue;
    const uuid = text(user.uuid);
    if (!uuid) continue;
    const label = text(user.label);
    candidates.push({
      candidateId: candidateId("vless-sudoku", publicHost, publicPort, label || uuid),
      source: "nobrand",
      sourceKind: "vless-sudoku",
      name: uniqueName("VLESS Sudoku", label, publicPort),
      publicHost,
      publicPort,
      supported: false,
      protocol: null,
      config: {
        uuid,
        serverName,
        network: "tcp",
        tls: true,
        clientFingerprint: "chrome",
      },
      unsupportedReason: "NoBrand VLESS Sudoku 是普通 TLS VLESS；ForwardX 当前端点类型是 VLESS Reality，不能安全等价导入",
    });
  }
  return candidates;
}

/**
 * Convert one ephemeral Agent snapshot into deterministic, selectable candidates.
 * Credentials stay inside the returned candidate config and are never logged here.
 * The public host is supplied by ForwardX host state rather than trusted from the
 * discovered NoBrand files, so stale advertise_host values cannot redirect imports.
 */
export function parseNoBrandProviderSnapshot(snapshotInput: unknown, publicHostInput: string) {
  const snapshot = objectValue(snapshotInput);
  if (!snapshot) throw new Error("NoBrand 扫描结果格式无效");
  requireRegistry(snapshot);
  const publicHost = text(publicHostInput);
  if (!publicHost || /\s|:\/\//.test(publicHost)) throw new Error("ForwardX 主机公网地址无效");

  const candidates = [
    ...mieruCandidates(snapshot, publicHost),
    ...snellCandidates(snapshot, publicHost),
    ...hysteria2Candidates(snapshot, publicHost),
    ...vlessSudokuCandidates(snapshot, publicHost),
  ];
  return candidates.sort((left, right) => (
    left.sourceKind.localeCompare(right.sourceKind)
    || left.publicPort - right.publicPort
    || left.name.localeCompare(right.name)
  ));
}
