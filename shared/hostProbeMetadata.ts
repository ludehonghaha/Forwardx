export const HOST_PROBE_KINDS = ["custom", "china_carrier"] as const;
export type HostProbeKind = typeof HOST_PROBE_KINDS[number];

export const HOST_PROBE_CARRIERS = ["ct", "cu", "cm"] as const;
export type HostProbeCarrier = typeof HOST_PROBE_CARRIERS[number];

export const HOST_PROBE_CARRIER_LABELS: Record<HostProbeCarrier, string> = {
  ct: "电信 CT",
  cu: "联通 CU",
  cm: "移动 CM",
};

export type HostProbeMetadataInput = {
  probeKind?: unknown;
  carrier?: unknown;
  region?: unknown;
};

export type HostProbeMetadata = {
  probeKind: HostProbeKind;
  carrier: HostProbeCarrier | null;
  region: string | null;
};

export type HostProbeJitterSample = {
  latencyMs?: unknown;
  isTimeout?: unknown;
};

export type HostProbeFreshnessState = "waiting" | "ok" | "timeout" | "stale";

export function isHostProbeCarrier(value: unknown): value is HostProbeCarrier {
  return HOST_PROBE_CARRIERS.includes(String(value || "").trim().toLowerCase() as HostProbeCarrier);
}

export function normalizeHostProbeMetadata(input: HostProbeMetadataInput = {}): HostProbeMetadata {
  const probeKind: HostProbeKind = String(input.probeKind || "").trim().toLowerCase() === "china_carrier"
    ? "china_carrier"
    : "custom";
  const region = String(input.region || "").trim();

  if (probeKind === "custom") {
    return {
      probeKind,
      carrier: null,
      region: region || null,
    };
  }

  const carrier = String(input.carrier || "").trim().toLowerCase();
  if (!isHostProbeCarrier(carrier)) {
    throw new Error("三网质量探测必须指定 ct / cu / cm 运营商");
  }

  return {
    probeKind,
    carrier,
    region: region || null,
  };
}

/**
 * Derive a display jitter from consecutive successful probe-window latency samples.
 *
 * This is deliberately a panel-side inter-window variability metric, not packet-level
 * RFC jitter. Timeout rows are ignored for latency deltas; packet loss remains a
 * separate metric from the probe result counters.
 */
export function deriveHostProbeJitterMs(samples: HostProbeJitterSample[], sampleLimit = 10): number | null {
  const limit = Math.max(2, Math.floor(Number(sampleLimit) || 10));
  const successful = (samples || [])
    .filter((sample) => !sample?.isTimeout)
    .map((sample) => Number(sample?.latencyMs))
    .filter((latency) => Number.isFinite(latency) && latency >= 0)
    .slice(-limit);

  if (successful.length < 2) return null;

  let totalDelta = 0;
  for (let index = 1; index < successful.length; index += 1) {
    totalDelta += Math.abs(successful[index] - successful[index - 1]);
  }
  return Math.round(totalDelta / (successful.length - 1));
}

/**
 * A probe is considered stale after three configured intervals, with a three-minute
 * floor so short scheduling jitter does not produce false stale states.
 */
export function hostProbeFreshnessState(input: {
  recordedAt?: unknown;
  intervalSeconds?: unknown;
  isTimeout?: unknown;
}, nowMs = Date.now()): HostProbeFreshnessState {
  if (!input?.recordedAt) return "waiting";
  const recordedMs = input.recordedAt instanceof Date
    ? input.recordedAt.getTime()
    : new Date(input.recordedAt as any).getTime();
  if (!Number.isFinite(recordedMs) || recordedMs <= 0) return "waiting";
  const intervalSeconds = Math.max(5, Math.floor(Number(input.intervalSeconds) || 60));
  const staleAfterMs = Math.max(180_000, intervalSeconds * 3_000);
  if (nowMs - recordedMs > staleAfterMs) return "stale";
  return input.isTimeout ? "timeout" : "ok";
}
