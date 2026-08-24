import { hostNetworkQualityStats, type InsertHostNetworkQualityStat } from "../../drizzle/schema";
import { executeRaw, getDb, queryRaw } from "../dbRuntime";
import { bucketExpression, inList, quoteIdentifier } from "../dbCompat";
import { clampPositiveInt, epochSeconds } from "./repositoryUtils";

export type HostNetworkQualityWindow = {
  hostId: number;
  latencyMs: number | null;
  successCount: number;
  lossCount: number;
  packetLossPermille: number;
};

type HostNetworkQualitySeriesPoint = {
  hostId: number;
  latencyMs: number | null;
  successCount: number;
  lossCount: number;
  packetLossPercent: number | null;
  recordedAt: Date;
};

function rowDate(value: unknown) {
  if (value instanceof Date) return value;
  return new Date(Number(value || 0) * 1000);
}

function normalizeCount(value: unknown) {
  const count = Math.floor(Number(value));
  return Number.isFinite(count) && count >= 0 ? count : 0;
}

export function packetLossPermille(successCount: unknown, lossCount: unknown) {
  const success = normalizeCount(successCount);
  const loss = normalizeCount(lossCount);
  const total = success + loss;
  return total > 0 ? Math.round((loss * 1000) / total) : null;
}

export function normalizeHostNetworkQualityWindow(input: {
  hostId: unknown;
  latencyMs?: unknown;
  successCount: unknown;
  lossCount: unknown;
}): HostNetworkQualityWindow | null {
  const hostId = Math.floor(Number(input.hostId));
  const successCount = normalizeCount(input.successCount);
  const lossCount = normalizeCount(input.lossCount);
  const total = successCount + lossCount;
  if (!Number.isInteger(hostId) || hostId <= 0 || total <= 0 || total > 100) return null;
  const rawLatency = Number(input.latencyMs);
  const latencyMs = successCount > 0 && Number.isFinite(rawLatency) && rawLatency > 0
    ? Math.max(1, Math.round(rawLatency))
    : null;
  if (successCount > 0 && latencyMs === null) return null;
  return {
    hostId,
    latencyMs,
    successCount,
    lossCount,
    packetLossPermille: packetLossPermille(successCount, lossCount) || 0,
  };
}

function mapNetworkQualityRow(row: any) {
  const successCount = normalizeCount(row?.successCount);
  const lossCount = normalizeCount(row?.lossCount);
  const storedPermille = Number(row?.packetLossPermille);
  const derivedPermille = packetLossPermille(successCount, lossCount);
  const permille = derivedPermille === null
    ? (Number.isFinite(storedPermille) ? Math.max(0, Math.min(1000, Math.round(storedPermille))) : null)
    : derivedPermille;
  return {
    hostId: Number(row?.hostId || 0),
    latencyMs: row?.latencyMs == null ? null : Math.round(Number(row.latencyMs)),
    successCount,
    lossCount,
    packetLossPercent: permille === null ? null : permille / 10,
    recordedAt: rowDate(row?.recordedAt),
  };
}

/**
 * Jitter is derived from adjacent successful RTT windows instead of adding a
 * second Agent payload/schema field. This keeps the NAT-safe Agent→Panel probe
 * protocol unchanged while still exposing the user-visible RTT variation.
 * A loss/no-data window breaks adjacency, so the next successful point starts a
 * fresh jitter baseline rather than spanning an outage.
 */
export function attachHostNetworkQualityJitter<T extends HostNetworkQualitySeriesPoint>(rows: T[]) {
  let previousLatency: number | null = null;
  return rows.map((row) => {
    const currentLatency = row.latencyMs == null || !Number.isFinite(Number(row.latencyMs))
      ? null
      : Math.max(0, Math.round(Number(row.latencyMs)));
    const jitterMs = currentLatency !== null && previousLatency !== null
      ? Math.abs(currentLatency - previousLatency)
      : null;
    previousLatency = currentLatency;
    return { ...row, jitterMs };
  });
}

export async function insertHostNetworkQualityStat(input: HostNetworkQualityWindow) {
  const db = await getDb();
  if (!db) return;
  await db.insert(hostNetworkQualityStats).values(input as InsertHostNetworkQualityStat);
}

export async function getLatestHostNetworkQualityStats(hostIds: number[]) {
  const ids = Array.from(new Set(hostIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)));
  if (ids.length === 0) return [];
  const q = quoteIdentifier;
  const list = inList(ids);
  const rows = await queryRaw<any>(
    `SELECT s.${q("hostId")}, s.${q("latencyMs")}, s.${q("successCount")},
            s.${q("lossCount")}, s.${q("packetLossPermille")}, s.${q("recordedAt")}
       FROM ${q("host_network_quality_stats")} s
       INNER JOIN (
         SELECT ${q("hostId")}, MAX(${q("id")}) AS ${q("id")}
           FROM ${q("host_network_quality_stats")}
          WHERE ${q("hostId")} IN ${list.sql}
          GROUP BY ${q("hostId")}
       ) latest ON latest.${q("hostId")} = s.${q("hostId")} AND latest.${q("id")} = s.${q("id")}`,
    list.params,
  );
  return rows.map(mapNetworkQualityRow);
}

export async function getHostNetworkQualitySeries(opts: { hostId: number; hours?: number; limit?: number }) {
  const hostId = Math.floor(Number(opts.hostId));
  if (!Number.isInteger(hostId) || hostId <= 0) return [];
  const requestedHours = Number(opts.hours);
  const hours = Number.isFinite(requestedHours) && requestedHours > 0
    ? Math.max(0.5, Math.min(requestedHours, 24 * 7))
    : 24;
  const limit = clampPositiveInt(opts.limit, 2_000, 20_000);
  const since = new Date(Date.now() - hours * 3600 * 1000);
  const baseBucketSeconds = hours <= 1
    ? 60
    : hours <= 6
      ? 120
      : hours <= 24
        ? 300
        : hours <= 72
          ? 600
          : 1800;
  const durationSeconds = hours * 3600;
  const bucketForLimit = Math.ceil(durationSeconds / Math.max(1, limit - 1));
  const bucketSeconds = Math.max(baseBucketSeconds, Math.max(1, Math.ceil(bucketForLimit / 60) * 60));
  const q = quoteIdentifier;
  const bucketExpr = bucketExpression("s", "recordedAt", bucketSeconds);
  const rows = await queryRaw<any>(
    `SELECT s.${q("hostId")}, ${bucketExpr} AS ${q("bucketStart")},
            SUM(CASE WHEN s.${q("latencyMs")} IS NOT NULL AND s.${q("successCount")} > 0
                     THEN s.${q("latencyMs")} * s.${q("successCount")} ELSE 0 END) AS ${q("weightedLatencyTotal")},
            SUM(s.${q("successCount")}) AS ${q("successCount")},
            SUM(s.${q("lossCount")}) AS ${q("lossCount")}
       FROM ${q("host_network_quality_stats")} s
      WHERE s.${q("hostId")} = ? AND s.${q("recordedAt")} >= ?
      GROUP BY s.${q("hostId")}, ${bucketExpr}
      ORDER BY ${q("bucketStart")} ASC`,
    [hostId, epochSeconds(since)],
  );
  const series: HostNetworkQualitySeriesPoint[] = rows.map((row) => {
    const successCount = normalizeCount(row.successCount);
    const lossCount = normalizeCount(row.lossCount);
    const weightedLatencyTotal = Number(row.weightedLatencyTotal) || 0;
    const permille = packetLossPermille(successCount, lossCount);
    return {
      hostId: Number(row.hostId),
      latencyMs: successCount > 0 ? Math.max(1, Math.round(weightedLatencyTotal / successCount)) : null,
      successCount,
      lossCount,
      packetLossPercent: permille === null ? null : permille / 10,
      recordedAt: rowDate(row.bucketStart),
    };
  });
  return attachHostNetworkQualityJitter(series);
}

export async function cleanOldHostNetworkQualityStats(retainHours = 24 * 7) {
  const cutoff = Math.floor((Date.now() - retainHours * 3600 * 1000) / 1000);
  await executeRaw(
    `DELETE FROM ${quoteIdentifier("host_network_quality_stats")} WHERE ${quoteIdentifier("recordedAt")} < ?`,
    [cutoff],
  );
}
