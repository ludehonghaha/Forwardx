import { billingCalendarParts, billingStartOfCalendarDay } from "@shared/billingTime";
import {
  executeRaw,
  getDatabaseKind,
  getDb,
  queryRaw,
  quoteDbIdentifier,
  withDatabaseTransaction,
} from "./dbRuntime";

const DAILY_HISTORY_TABLE = "user_traffic_daily";
const DAILY_HISTORY_RETENTION_DAYS = 62;
const SOURCE_RECOMPUTE_DAYS = 2;
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const QUERY_REFRESH_THROTTLE_MS = 30 * 1000;

let refreshPromise: Promise<void> | null = null;
let lastRefreshAt = 0;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function epochSeconds(value: Date | number) {
  const ms = value instanceof Date ? value.getTime() : Number(value);
  return Math.floor(ms / 1000);
}

function numeric(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function dayKey(value: Date | number) {
  const parts = billingCalendarParts(value);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

function currentAndPreviousDayStarts(now = new Date()) {
  const today = billingStartOfCalendarDay(now);
  const starts = [today];
  for (let index = 1; index < SOURCE_RECOMPUTE_DAYS; index += 1) {
    starts.unshift(billingStartOfCalendarDay(today.getTime() - index * 24 * 60 * 60 * 1000));
  }
  return starts;
}

function historyDayStarts(days: number, now = new Date()) {
  const count = Math.max(1, Math.min(31, Math.floor(Number(days) || 7)));
  const today = billingStartOfCalendarDay(now);
  const result: Date[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    result.push(billingStartOfCalendarDay(today.getTime() - index * 24 * 60 * 60 * 1000));
  }
  return result;
}

export async function ensureUserTrafficDailyTable() {
  await getDb();
  const kind = getDatabaseKind();
  if (!kind) throw new Error("database is not connected");

  // Keep this compact table independent from the high-frequency Drizzle traffic
  // schema. One row per user/day lets 31-day history survive the 72-hour raw
  // traffic retention without multiplying the existing per-rule bucket volume.
  await executeRaw(`
    CREATE TABLE IF NOT EXISTS ${DAILY_HISTORY_TABLE} (
      user_id INTEGER NOT NULL,
      day_start BIGINT NOT NULL,
      bytes_in BIGINT NOT NULL DEFAULT 0,
      bytes_out BIGINT NOT NULL DEFAULT 0,
      connections BIGINT NOT NULL DEFAULT 0,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (user_id, day_start)
    )
  `);
}

type DailyAggregate = {
  userId: number;
  dayStart: number;
  bytesIn: number;
  bytesOut: number;
  connections: number;
};

async function recomputeRecentDailyRows(now = new Date()) {
  await ensureUserTrafficDailyTable();
  const dayStarts = currentAndPreviousDayStarts(now);
  const firstDayStart = epochSeconds(dayStarts[0]);
  const q = quoteDbIdentifier;
  const buckets = await queryRaw<any>(
    `SELECT ${q("userId")} AS userId, ${q("bucketStart")} AS bucketStart,
            ${q("bytesIn")} AS bytesIn, ${q("bytesOut")} AS bytesOut,
            ${q("connections")} AS connections
       FROM ${q("traffic_stat_buckets")}
      WHERE ${q("bucketStart")} >= ? AND ${q("userId")} > 0`,
    [firstDayStart],
  );

  const aggregates = new Map<string, DailyAggregate>();
  for (const row of buckets) {
    const userId = Math.floor(Number(row?.userId));
    const bucketStartSeconds = Math.floor(Number(row?.bucketStart));
    if (!Number.isInteger(userId) || userId <= 0 || !Number.isFinite(bucketStartSeconds) || bucketStartSeconds <= 0) continue;
    const bucketDayStart = epochSeconds(billingStartOfCalendarDay(bucketStartSeconds * 1000));
    if (bucketDayStart < firstDayStart) continue;
    const key = `${userId}:${bucketDayStart}`;
    const current = aggregates.get(key) || {
      userId,
      dayStart: bucketDayStart,
      bytesIn: 0,
      bytesOut: 0,
      connections: 0,
    };
    current.bytesIn += numeric(row?.bytesIn);
    current.bytesOut += numeric(row?.bytesOut);
    current.connections += numeric(row?.connections);
    aggregates.set(key, current);
  }

  const updatedAt = epochSeconds(now);
  const retentionCutoff = epochSeconds(
    billingStartOfCalendarDay(now.getTime() - DAILY_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000),
  );

  await withDatabaseTransaction(async () => {
    // The previous day is fully covered by the source's 72-hour retention, so it
    // can be replaced exactly. Replacing (rather than incrementing) also makes
    // retries idempotent and automatically follows corrected source buckets.
    await executeRaw(`DELETE FROM ${DAILY_HISTORY_TABLE} WHERE day_start >= ?`, [firstDayStart]);
    for (const row of aggregates.values()) {
      await executeRaw(
        `INSERT INTO ${DAILY_HISTORY_TABLE}
          (user_id, day_start, bytes_in, bytes_out, connections, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [row.userId, row.dayStart, row.bytesIn, row.bytesOut, row.connections, updatedAt],
      );
    }
    await executeRaw(`DELETE FROM ${DAILY_HISTORY_TABLE} WHERE day_start < ?`, [retentionCutoff]);
  });
}

export async function refreshUserTrafficDailyHistory(options: { force?: boolean; now?: Date } = {}) {
  const now = options.now || new Date();
  if (!options.force && Date.now() - lastRefreshAt < QUERY_REFRESH_THROTTLE_MS) return;
  if (refreshPromise) return refreshPromise;
  refreshPromise = recomputeRecentDailyRows(now)
    .then(() => { lastRefreshAt = Date.now(); })
    .finally(() => { refreshPromise = null; });
  return refreshPromise;
}

export function startUserTrafficDailyHistory() {
  if (refreshTimer) return false;
  void refreshUserTrafficDailyHistory({ force: true }).catch((error) => {
    console.warn(`[TrafficHistory] initial refresh failed: ${error instanceof Error ? error.message : String(error)}`);
  });
  refreshTimer = setInterval(() => {
    void refreshUserTrafficDailyHistory({ force: true }).catch((error) => {
      console.warn(`[TrafficHistory] refresh failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, REFRESH_INTERVAL_MS);
  refreshTimer.unref?.();
  return true;
}

export async function getUserTrafficDailyHistory(days = 7, now = new Date()) {
  await refreshUserTrafficDailyHistory({ now });
  await ensureUserTrafficDailyTable();
  const starts = historyDayStarts(days, now);
  const firstStart = epochSeconds(starts[0]);
  const lastStart = epochSeconds(starts[starts.length - 1]);
  const q = quoteDbIdentifier;

  const [users, dailyRows] = await Promise.all([
    queryRaw<any>(
      `SELECT ${q("id")} AS id, ${q("username")} AS username, ${q("name")} AS name,
              ${q("accountEnabled")} AS accountEnabled, ${q("trafficUsed")} AS trafficUsed,
              ${q("trafficLimit")} AS trafficLimit
         FROM ${q("users")}
        WHERE ${q("role")} <> ?
        ORDER BY ${q("id")} ASC`,
      ["admin"],
    ),
    queryRaw<any>(
      `SELECT user_id AS userId, day_start AS dayStart, bytes_in AS bytesIn,
              bytes_out AS bytesOut, connections
         FROM ${DAILY_HISTORY_TABLE}
        WHERE day_start >= ? AND day_start <= ?
        ORDER BY day_start ASC, user_id ASC`,
      [firstStart, lastStart],
    ),
  ]);

  const byUser = new Map<number, Map<number, { bytesIn: number; bytesOut: number; connections: number }>>();
  for (const row of dailyRows) {
    const userId = Math.floor(Number(row?.userId));
    const start = Math.floor(Number(row?.dayStart));
    if (!Number.isInteger(userId) || userId <= 0 || !Number.isFinite(start)) continue;
    if (!byUser.has(userId)) byUser.set(userId, new Map());
    byUser.get(userId)!.set(start, {
      bytesIn: numeric(row?.bytesIn),
      bytesOut: numeric(row?.bytesOut),
      connections: numeric(row?.connections),
    });
  }

  const dateStarts = starts.map(epochSeconds);
  const dateKeys = starts.map(dayKey);
  const rows = users.map((user) => {
    const userId = Number(user.id);
    const daily = dateStarts.map((start, index) => {
      const value = byUser.get(userId)?.get(start) || { bytesIn: 0, bytesOut: 0, connections: 0 };
      return {
        date: dateKeys[index],
        bytesIn: value.bytesIn,
        bytesOut: value.bytesOut,
        total: value.bytesIn + value.bytesOut,
        connections: value.connections,
      };
    });
    const periodTotal = daily.reduce((sum, item) => sum + item.total, 0);
    return {
      userId,
      username: String(user.username || ""),
      name: user.name == null ? null : String(user.name),
      accountEnabled: user.accountEnabled === true || Number(user.accountEnabled) === 1,
      trafficUsed: numeric(user.trafficUsed),
      trafficLimit: numeric(user.trafficLimit),
      today: daily[daily.length - 1]?.total || 0,
      yesterday: daily[daily.length - 2]?.total || 0,
      periodTotal,
      daily,
    };
  });

  return {
    days: dateKeys,
    range: starts.length,
    generatedAt: Date.now(),
    users: rows.sort((a, b) => b.today - a.today || b.periodTotal - a.periodTotal || a.userId - b.userId),
  };
}
