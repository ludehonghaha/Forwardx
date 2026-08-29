export const MULTIPATH_POC_UPSTREAM = {
  repository: "WuSiYu/singbox-multipath",
  branch: "multipath-poc3",
  commit: "1c36787d956d750f2ee58d73710d8006a11ccf2c",
  protocolGeneration: "v4",
} as const;

export type MultipathPocLeg = {
  legIndex: 0 | 1;
  outboundTag: string;
  expectedBandwidthMbps?: number;
  supportsUdp?: boolean;
};

export type MultipathPocLine = {
  id: number;
  server: string;
  serverPort: number;
  listen?: string;
  preferredLegIndex?: 0 | 1;
  udpLegIndex?: 0 | 1;
  tcpFastOpen?: boolean;
  activationThresholdMbps?: number;
  activationAfterBytes?: number;
  activationWindow?: string;
  chunkSize?: number;
  queueFrames?: number;
  maxReorderFrames?: number;
  maxReorderBytes?: number;
  leg1ReplayBytes?: number;
  leg1ReplayTimeout?: string;
  handshakeTimeout?: string;
};

const DEFAULTS = {
  tcpFastOpen: true,
  activationThresholdMbps: 120,
  activationWindow: "1s",
  chunkSize: 64 * 1024,
  queueFrames: 256,
  maxReorderFrames: 2048,
  maxReorderBytes: 64 * 1024 * 1024,
  leg1ReplayBytes: 64 * 1024 * 1024,
  leg1ReplayTimeout: "5s",
  handshakeTimeout: "10s",
} as const;

function validPositiveInteger(value: number) {
  return Number.isInteger(value) && value > 0;
}

function validDuration(value: string) {
  return /^\d+(?:\.\d+)?(?:ms|s|m|h)$/.test(value);
}

function normalizedLegs(legs: MultipathPocLeg[]) {
  if (!Array.isArray(legs) || legs.length !== 2) return null;
  const ordered = [...legs].sort((left, right) => left.legIndex - right.legIndex);
  if (ordered[0]?.legIndex !== 0 || ordered[1]?.legIndex !== 1) return null;
  const tags = ordered.map((leg) => String(leg.outboundTag || "").trim());
  if (!tags[0] || !tags[1] || tags[0] === tags[1]) return null;
  for (const leg of ordered) {
    if (leg.expectedBandwidthMbps !== undefined && (!Number.isFinite(leg.expectedBandwidthMbps) || leg.expectedBandwidthMbps <= 0)) return null;
  }
  return ordered.map((leg, index) => ({ ...leg, outboundTag: tags[index] }));
}

function normalizedLine(line: MultipathPocLine) {
  const id = Number(line?.id || 0);
  const server = String(line?.server || "").trim();
  const serverPort = Number(line?.serverPort || 0);
  const preferredLegIndex = line.preferredLegIndex ?? 0;
  const udpLegIndex = line.udpLegIndex ?? preferredLegIndex;
  const tcpFastOpen = line.tcpFastOpen ?? DEFAULTS.tcpFastOpen;
  const activationThresholdMbps = line.activationThresholdMbps ?? DEFAULTS.activationThresholdMbps;
  const activationAfterBytes = line.activationAfterBytes;
  const activationWindow = line.activationWindow ?? DEFAULTS.activationWindow;
  const chunkSize = line.chunkSize ?? DEFAULTS.chunkSize;
  const queueFrames = line.queueFrames ?? DEFAULTS.queueFrames;
  const maxReorderFrames = line.maxReorderFrames ?? DEFAULTS.maxReorderFrames;
  const maxReorderBytes = line.maxReorderBytes ?? DEFAULTS.maxReorderBytes;
  const leg1ReplayBytes = line.leg1ReplayBytes ?? DEFAULTS.leg1ReplayBytes;
  const leg1ReplayTimeout = line.leg1ReplayTimeout ?? DEFAULTS.leg1ReplayTimeout;
  const handshakeTimeout = line.handshakeTimeout ?? DEFAULTS.handshakeTimeout;

  if (!validPositiveInteger(id) || !server || !validPositiveInteger(serverPort) || serverPort > 65535) return null;
  if (preferredLegIndex !== 0 && preferredLegIndex !== 1) return null;
  if (udpLegIndex !== 0 && udpLegIndex !== 1) return null;
  if (!Number.isFinite(activationThresholdMbps) || activationThresholdMbps <= 0) return null;
  if (activationAfterBytes !== undefined && !validPositiveInteger(activationAfterBytes)) return null;
  if (!validDuration(activationWindow) || !validDuration(leg1ReplayTimeout) || !validDuration(handshakeTimeout)) return null;
  if (!validPositiveInteger(chunkSize) || chunkSize < 1024 || chunkSize > 1024 * 1024) return null;
  if (!validPositiveInteger(queueFrames) || queueFrames < 8 || queueFrames > 4096) return null;
  if (chunkSize * queueFrames > 64 * 1024 * 1024) return null;
  if (!validPositiveInteger(maxReorderFrames)) return null;
  if (!validPositiveInteger(maxReorderBytes) || maxReorderBytes > 512 * 1024 * 1024) return null;
  if (!validPositiveInteger(leg1ReplayBytes) || leg1ReplayBytes > 512 * 1024 * 1024) return null;

  return {
    id,
    server,
    serverPort,
    listen: String(line.listen || "0.0.0.0").trim() || "0.0.0.0",
    preferredLegIndex,
    udpLegIndex,
    tcpFastOpen,
    activationThresholdMbps,
    activationAfterBytes,
    activationWindow,
    chunkSize,
    queueFrames,
    maxReorderFrames,
    maxReorderBytes,
    leg1ReplayBytes,
    leg1ReplayTimeout,
    handshakeTimeout,
  };
}

function sharedSchedulingConfig(line: NonNullable<ReturnType<typeof normalizedLine>>, legs: NonNullable<ReturnType<typeof normalizedLegs>>) {
  const config: Record<string, unknown> = {
    tcp_fast_open: line.tcpFastOpen,
    activation_threshold_mbps: line.activationThresholdMbps,
    activation_window: line.activationWindow,
    chunk_size: line.chunkSize,
    queue_frames: line.queueFrames,
    max_reorder_bytes: line.maxReorderBytes,
    leg1_replay_bytes: line.leg1ReplayBytes,
    leg1_replay_timeout: line.leg1ReplayTimeout,
    handshake_timeout: line.handshakeTimeout,
  };
  if (line.activationAfterBytes !== undefined) config.activation_after_bytes = line.activationAfterBytes;
  const bandwidth = legs.map((leg) => leg.expectedBandwidthMbps);
  if (bandwidth.every((value) => typeof value === "number")) config.bandwidth_mbps = bandwidth;
  return config;
}

/**
 * Compile only the experimental multipath outbound stanza. Child outbounds are
 * intentionally external inputs: ForwardX must not duplicate or reinterpret
 * their credentials here.
 */
export function buildMultipathPocOutbound(lineInput: MultipathPocLine, legInput: MultipathPocLeg[]) {
  const line = normalizedLine(lineInput);
  const legs = normalizedLegs(legInput);
  if (!line || !legs) return null;
  const udpLeg = legs[line.udpLegIndex];
  if (udpLeg.supportsUdp === false) return null;
  return {
    type: "multipath",
    tag: `forwardx-multipath-${line.id}`,
    outbounds: legs.map((leg) => leg.outboundTag),
    preferred: legs[line.preferredLegIndex].outboundTag,
    udp_outbound: udpLeg.outboundTag,
    server: line.server,
    server_port: line.serverPort,
    ...sharedSchedulingConfig(line, legs),
  };
}

/** Compile only the matching server inbound stanza for isolated PoC runtime use. */
export function buildMultipathPocInbound(lineInput: MultipathPocLine, legInput: MultipathPocLeg[]) {
  const line = normalizedLine(lineInput);
  const legs = normalizedLegs(legInput);
  if (!line || !legs) return null;
  return {
    type: "multipath",
    tag: `forwardx-multipath-${line.id}`,
    listen: line.listen,
    listen_port: line.serverPort,
    ...sharedSchedulingConfig(line, legs),
    max_reorder_frames: line.maxReorderFrames,
  };
}
