import { boolLiteral, inList, quoteIdentifier } from "../dbCompat";
import { queryRaw } from "../dbRuntime";
import {
  deriveHostProbeJitterMs,
  hostProbeFreshnessState,
  isHostProbeCarrier,
  normalizeHostProbeMetadata,
  type HostProbeCarrier,
} from "../../shared/hostProbeMetadata";

function parseIds(value: unknown) {
  return String(value || "")
    .split(",")
    .map((item) => Math.floor(Number(item.trim())))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function rowDate(value: unknown) {
  if (value instanceof Date) return value;
  const numeric = Number(value || 0);
  if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric * 1000);
  const parsed = new Date(String(value || ""));
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function rowBool(value: unknown) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function serviceAppliesToHost(service: any, hostId: number) {
  const scope = String(service?.hostScope || "all");
  if (scope === "specific") return parseIds(service?.hostIds).includes(hostId);
  if (scope === "exclude") return !parseIds(service?.excludeHostIds).includes(hostId);
  return true;
}

export type ChinaCarrierProbeOverviewItem = {
  serviceId: number;
  carrier: HostProbeCarrier;
  region: string | null;
  serviceName: string;
  method: "ping" | "tcping";
  targetIp: string;
  targetPort: number | null;
  intervalSeconds: number;
  isEnabled: boolean;
  latencyMs: number | null;
  jitterMs: number | null;
  packetLossPercent: number | null;
  successCount: number | null;
  lossCount: number | null;
  recordedAt: Date | null;
  isTimeout: boolean;
  state: "disabled" | "waiting" | "ok" | "timeout" | "stale";
};

export type ChinaCarrierProbeOverviewHost = {
  hostId: number;
  hostName: string;
  isOnline: boolean;
  carriers: Record<HostProbeCarrier, ChinaCarrierProbeOverviewItem[]>;
};

export async function getChinaCarrierProbeOverview(nowMs = Date.now()): Promise<ChinaCarrierProbeOverviewHost[]> {
  const q = quoteIdentifier;
  const services = await queryRaw<any>(
    `SELECT ${q("id")}, ${q("name")}, ${q("method")}, ${q("targetIp")}, ${q("targetPort")},
            ${q("hostScope")}, ${q("hostIds")}, ${q("excludeHostIds")}, ${q("intervalSeconds")},
            ${q("isEnabled")}, ${q("sortOrder")}, ${q("probeKind")}, ${q("carrier")}, ${q("region")}
       FROM ${q("host_probe_services")}
      WHERE ${q("probeKind")} = ?
      ORDER BY ${q("sortOrder")} ASC, ${q("id")} ASC`,
    ["china_carrier"],
  );

  const hosts = await queryRaw<any>(
    `SELECT ${q("id")}, ${q("name")}, ${q("isOnline")}, ${q("sortOrder")}
       FROM ${q("hosts")}
      ORDER BY ${q("sortOrder")} ASC, ${q("id")} ASC`,
  );

  const normalizedServices = services
    .map((service) => {
      let metadata;
      try {
        metadata = normalizeHostProbeMetadata(service);
      } catch {
        return null;
      }
      if (metadata.probeKind !== "china_carrier" || !metadata.carrier) return null;
      return {
        ...service,
        id: Number(service.id),
        method: service.method === "ping" ? "ping" as const : "tcping" as const,
        targetPort: service.targetPort == null ? null : Number(service.targetPort),
        intervalSeconds: Math.max(5, Number(service.intervalSeconds) || 60),
        isEnabled: rowBool(service.isEnabled),
        carrier: metadata.carrier,
        region: metadata.region,
      };
    })
    .filter(Boolean) as any[];

  const serviceIds = normalizedServices.map((service) => Number(service.id)).filter((id) => id > 0);
  const latestByPair = new Map<string, any>();
  const jitterSamplesByPair = new Map<string, Array<{ latencyMs: number; isTimeout: false }>>();

  if (serviceIds.length > 0) {
    const list = inList(serviceIds);
    const latestRows = await queryRaw<any>(
      `SELECT ranked.${q("serviceId")}, ranked.${q("hostId")}, ranked.${q("latencyMs")}, ranked.${q("isTimeout")},
              ranked.${q("successCount")}, ranked.${q("lossCount")}, ranked.${q("packetLossPermille")}, ranked.${q("recordedAt")}
         FROM (
           SELECT s.${q("serviceId")}, s.${q("hostId")}, s.${q("latencyMs")}, s.${q("isTimeout")},
                  s.${q("successCount")}, s.${q("lossCount")}, s.${q("packetLossPermille")}, s.${q("recordedAt")}, s.${q("id")},
                  ROW_NUMBER() OVER (
                    PARTITION BY s.${q("serviceId")}, s.${q("hostId")}
                    ORDER BY s.${q("recordedAt")} DESC, s.${q("id")} DESC
                  ) AS ${q("rn")}
             FROM ${q("host_probe_service_stats")} s
            WHERE s.${q("serviceId")} IN ${list.sql}
         ) ranked
        WHERE ranked.${q("rn")} = 1`,
      list.params,
    );
    for (const row of latestRows) {
      latestByPair.set(`${Number(row.serviceId)}:${Number(row.hostId)}`, row);
    }

    const success = boolLiteral(false);
    const sampleRows = await queryRaw<any>(
      `SELECT ranked.${q("serviceId")}, ranked.${q("hostId")}, ranked.${q("latencyMs")}, ranked.${q("recordedAt")}
         FROM (
           SELECT s.${q("serviceId")}, s.${q("hostId")}, s.${q("latencyMs")}, s.${q("recordedAt")}, s.${q("id")},
                  ROW_NUMBER() OVER (
                    PARTITION BY s.${q("serviceId")}, s.${q("hostId")}
                    ORDER BY s.${q("recordedAt")} DESC, s.${q("id")} DESC
                  ) AS ${q("rn")}
             FROM ${q("host_probe_service_stats")} s
            WHERE s.${q("serviceId")} IN ${list.sql}
              AND s.${q("isTimeout")} = ${success}
              AND s.${q("latencyMs")} IS NOT NULL
         ) ranked
        WHERE ranked.${q("rn")} <= 10
        ORDER BY ranked.${q("serviceId")} ASC, ranked.${q("hostId")} ASC,
                 ranked.${q("recordedAt")} ASC, ranked.${q("id")} ASC`,
      list.params,
    );
    for (const row of sampleRows) {
      const key = `${Number(row.serviceId)}:${Number(row.hostId)}`;
      const samples = jitterSamplesByPair.get(key) || [];
      samples.push({ latencyMs: Number(row.latencyMs), isTimeout: false });
      jitterSamplesByPair.set(key, samples);
    }
  }

  return hosts.map((host) => {
    const hostId = Number(host.id);
    const carriers: ChinaCarrierProbeOverviewHost["carriers"] = { ct: [], cu: [], cm: [] };
    for (const service of normalizedServices) {
      if (!serviceAppliesToHost(service, hostId)) continue;
      const carrier = service.carrier;
      if (!isHostProbeCarrier(carrier)) continue;
      const key = `${Number(service.id)}:${hostId}`;
      const latest = latestByPair.get(key);
      const recordedAt = latest ? rowDate(latest.recordedAt) : null;
      const isTimeout = latest ? rowBool(latest.isTimeout) : false;
      const state = !service.isEnabled
        ? "disabled" as const
        : hostProbeFreshnessState({
          recordedAt,
          intervalSeconds: service.intervalSeconds,
          isTimeout,
        }, nowMs);
      carriers[carrier].push({
        serviceId: Number(service.id),
        carrier,
        region: service.region,
        serviceName: String(service.name || ""),
        method: service.method,
        targetIp: String(service.targetIp || ""),
        targetPort: service.method === "tcping" ? service.targetPort : null,
        intervalSeconds: service.intervalSeconds,
        isEnabled: service.isEnabled,
        latencyMs: isTimeout || latest?.latencyMs == null ? null : Number(latest.latencyMs),
        jitterMs: deriveHostProbeJitterMs(jitterSamplesByPair.get(key) || []),
        packetLossPercent: latest?.packetLossPermille == null ? null : Number(latest.packetLossPermille) / 10,
        successCount: latest?.successCount == null ? null : Number(latest.successCount),
        lossCount: latest?.lossCount == null ? null : Number(latest.lossCount),
        recordedAt,
        isTimeout,
        state,
      });
    }
    return {
      hostId,
      hostName: String(host.name || `#${hostId}`),
      isOnline: rowBool(host.isOnline),
      carriers,
    };
  });
}
