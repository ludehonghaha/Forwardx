import {
  executeRaw,
  getDatabaseKind,
  getDb,
  nowDate,
  queryRaw,
} from "../dbRuntime";

export const PROTOCOL_USER_TRAFFIC_BUCKET_MINUTES = 30;
export const PROTOCOL_USER_TRAFFIC_RETENTION_HOURS = 72;
const PROTOCOL_USER_TRAFFIC_TABLE = "protocol_user_traffic_buckets";

type ProtocolUserTrafficSample = {
  assignmentId: number;
  endpointId: number;
  userId: number;
  hostId: number;
  bytesIn?: number;
  bytesOut?: number;
  recordedAt?: Date;
};

type ProtocolUserTrafficBucket = {
  bucketStart: number;
  bucketMinutes: number;
  assignmentId: number;
  endpointId: number;
  userId: number;
  hostId: number;
  bytesIn: number;
  bytesOut: number;
};

function positiveInteger(value: unknown) {
  const number = Math.floor(Number(value) || 0);
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function bytes(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(Math.floor(number), Number.MAX_SAFE_INTEGER);
}

function epochSeconds(value: Date | number) {
  const millis = value instanceof Date ? value.getTime() : Number(value);
  return Math.max(0, Math.floor(millis / 1000));
}

export function protocolUserTrafficBucketStart(value: Date | number) {
  const seconds = epochSeconds(value);
  const bucketSeconds = PROTOCOL_USER_TRAFFIC_BUCKET_MINUTES * 60;
  return Math.floor(seconds / bucketSeconds) * bucketSeconds;
}

/**
 * Aggregate by assignment+host, never by endpoint or public forwarding rule.
 * One Reality listener can therefore serve many ForwardX users without the
 * last writer changing ownership of another user's traffic bucket.
 */
export function aggregateProtocolUserTrafficSamples(
  samples: ProtocolUserTrafficSample[],
  fallbackRecordedAt = nowDate(),
): ProtocolUserTrafficBucket[] {
  const result = new Map<string, ProtocolUserTrafficBucket>();
  for (const sample of samples || []) {
    const assignmentId = positiveInteger(sample?.assignmentId);
    const endpointId = positiveInteger(sample?.endpointId);
    const userId = positiveInteger(sample?.userId);
    const hostId = positiveInteger(sample?.hostId);
    if (!assignmentId || !endpointId || !userId || !hostId) continue;
    const bucketStart = protocolUserTrafficBucketStart(sample.recordedAt || fallbackRecordedAt);
    const key = `${bucketStart}:${assignmentId}:${hostId}`;
    const current = result.get(key);
    if (current) {
      // An assignment is immutable with respect to its owning user/endpoint in
      // one accounting epoch. Refuse ambiguous ownership instead of silently
      // moving already-accounted bytes to another user.
      if (current.endpointId !== endpointId || current.userId !== userId) {
        throw new Error(`协议流量归属冲突: assignment=${assignmentId} host=${hostId}`);
      }
      current.bytesIn += bytes(sample.bytesIn);
      current.bytesOut += bytes(sample.bytesOut);
      continue;
    }
    result.set(key, {
      bucketStart,
      bucketMinutes: PROTOCOL_USER_TRAFFIC_BUCKET_MINUTES,
      assignmentId,
      endpointId,
      userId,
      hostId,
      bytesIn: bytes(sample.bytesIn),
      bytesOut: bytes(sample.bytesOut),
    });
  }
  return Array.from(result.values())
    .filter((row) => row.bytesIn > 0 || row.bytesOut > 0)
    .sort((left, right) => left.bucketStart - right.bucketStart
      || left.assignmentId - right.assignmentId
      || left.hostId - right.hostId);
}

export async function ensureProtocolUserTrafficTable() {
  await getDb();
  await executeRaw(`
    CREATE TABLE IF NOT EXISTS ${PROTOCOL_USER_TRAFFIC_TABLE} (
      bucket_start BIGINT NOT NULL,
      bucket_minutes INTEGER NOT NULL,
      assignment_id BIGINT NOT NULL,
      endpoint_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      host_id BIGINT NOT NULL,
      bytes_in BIGINT NOT NULL DEFAULT 0,
      bytes_out BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (bucket_start, bucket_minutes, assignment_id, host_id)
    )
  `);
}

export async function insertProtocolUserTrafficSamples(samples: ProtocolUserTrafficSample[]) {
  const rows = aggregateProtocolUserTrafficSamples(samples);
  if (rows.length === 0) return { buckets: 0, assignments: 0, users: 0 };
  await ensureProtocolUserTrafficTable();
  const kind = getDatabaseKind();
  const nowSec = epochSeconds(nowDate());

  for (const row of rows) {
    const params = [
      row.bucketStart,
      row.bucketMinutes,
      row.assignmentId,
      row.endpointId,
      row.userId,
      row.hostId,
      row.bytesIn,
      row.bytesOut,
      nowSec,
    ];
    if (kind === "mysql") {
      await executeRaw(`
        INSERT INTO ${PROTOCOL_USER_TRAFFIC_TABLE}
          (bucket_start, bucket_minutes, assignment_id, endpoint_id, user_id, host_id, bytes_in, bytes_out, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          endpoint_id = VALUES(endpoint_id),
          user_id = VALUES(user_id),
          bytes_in = bytes_in + VALUES(bytes_in),
          bytes_out = bytes_out + VALUES(bytes_out),
          updated_at = VALUES(updated_at)
      `, params);
    } else {
      const excluded = kind === "postgresql" ? "EXCLUDED" : "excluded";
      await executeRaw(`
        INSERT INTO ${PROTOCOL_USER_TRAFFIC_TABLE}
          (bucket_start, bucket_minutes, assignment_id, endpoint_id, user_id, host_id, bytes_in, bytes_out, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (bucket_start, bucket_minutes, assignment_id, host_id) DO UPDATE SET
          endpoint_id = ${excluded}.endpoint_id,
          user_id = ${excluded}.user_id,
          bytes_in = ${PROTOCOL_USER_TRAFFIC_TABLE}.bytes_in + ${excluded}.bytes_in,
          bytes_out = ${PROTOCOL_USER_TRAFFIC_TABLE}.bytes_out + ${excluded}.bytes_out,
          updated_at = ${excluded}.updated_at
      `, params);
    }
  }

  return {
    buckets: rows.length,
    assignments: new Set(rows.map((row) => row.assignmentId)).size,
    users: new Set(rows.map((row) => row.userId)).size,
  };
}

export async function getProtocolUserTrafficBucketsSince(since: Date) {
  await ensureProtocolUserTrafficTable();
  const start = epochSeconds(since);
  const rows = await queryRaw<any>(`
    SELECT bucket_start AS bucketStart,
           bucket_minutes AS bucketMinutes,
           assignment_id AS assignmentId,
           endpoint_id AS endpointId,
           user_id AS userId,
           host_id AS hostId,
           bytes_in AS bytesIn,
           bytes_out AS bytesOut,
           updated_at AS updatedAt
      FROM ${PROTOCOL_USER_TRAFFIC_TABLE}
     WHERE bucket_start >= ?
     ORDER BY bucket_start ASC, assignment_id ASC, host_id ASC
  `, [start]);
  return rows.map((row) => ({
    bucketStart: Number(row.bucketStart || 0),
    bucketMinutes: Number(row.bucketMinutes || 0),
    assignmentId: Number(row.assignmentId || 0),
    endpointId: Number(row.endpointId || 0),
    userId: Number(row.userId || 0),
    hostId: Number(row.hostId || 0),
    bytesIn: Number(row.bytesIn || 0),
    bytesOut: Number(row.bytesOut || 0),
    updatedAt: Number(row.updatedAt || 0),
  }));
}

export async function cleanOldProtocolUserTrafficBuckets(retainHours = PROTOCOL_USER_TRAFFIC_RETENTION_HOURS) {
  await ensureProtocolUserTrafficTable();
  const hours = Math.max(1, Math.floor(Number(retainHours) || PROTOCOL_USER_TRAFFIC_RETENTION_HOURS));
  const cutoff = Math.floor((Date.now() - hours * 60 * 60 * 1000) / 1000);
  return executeRaw(`DELETE FROM ${PROTOCOL_USER_TRAFFIC_TABLE} WHERE bucket_start < ?`, [cutoff]);
}
