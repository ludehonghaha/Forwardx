import { and, eq, inArray } from "drizzle-orm";
import { protocolEndpoints, protocolUserAccess } from "../drizzle/schema";
import {
  isAgentProtocolTrafficStat,
  type AgentProtocolTrafficStat,
} from "../shared/agentDtos";
import { parseProtocolAccessConfig, protocolConfigText } from "../shared/protocolAccess";
import { pushAgentRefresh } from "./agentEvents";
import { getDb, withDatabaseTransaction } from "./dbRuntime";
import { refreshUserForwardEndpoints } from "./routers/helpers";
import { getHostByAgentToken } from "./repositories/hostRepository";
import { claimAgentTrafficReport } from "./repositories/metricsRepository";
import {
  ensureProtocolUserTrafficTable,
  insertProtocolUserTrafficSamples,
} from "./repositories/protocolUserTrafficRepository";
import { addUserTraffic, setUserForwardAccess } from "./repositories/userRepository";

const MAX_PROTOCOL_TRAFFIC_STATS = 4096;
const PROTOCOL_REPORT_PRODUCER_PREFIX = "protocol:";

type ProtocolAssignmentOwnership = {
  assignmentId: number;
  endpointId: number;
  userId: number;
  hostId: number;
};

type ProtocolTrafficPlan = {
  samples: Array<ProtocolAssignmentOwnership & { bytesIn: number; bytesOut: number }>;
  userTotals: Map<number, number>;
  ignoredAssignments: number[];
};

type AgentMieruTrafficStat = {
  username: string;
  bytesIn: number;
  bytesOut: number;
};

export class AgentProtocolTrafficValidationError extends Error {
  readonly statusCode = 400;
}

function safeBytes(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new AgentProtocolTrafficValidationError("协议流量字节数无效");
  }
  return number;
}

export function protocolTrafficProducerId(producerId: unknown) {
  const producer = String(producerId || "legacy").trim() || "legacy";
  return `${PROTOCOL_REPORT_PRODUCER_PREFIX}${producer}`.slice(0, 128);
}

export function normalizeAgentProtocolTrafficStats(value: unknown): AgentProtocolTrafficStat[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new AgentProtocolTrafficValidationError("protocolStats 必须是数组");
  }
  if (value.length > MAX_PROTOCOL_TRAFFIC_STATS) {
    throw new AgentProtocolTrafficValidationError(`protocolStats 超过上限 ${MAX_PROTOCOL_TRAFFIC_STATS}`);
  }

  const merged = new Map<number, AgentProtocolTrafficStat>();
  for (const raw of value) {
    if (!isAgentProtocolTrafficStat(raw)) {
      throw new AgentProtocolTrafficValidationError("protocolStats 包含无效记录");
    }
    const assignmentId = Number(raw.assignmentId);
    const bytesIn = safeBytes(raw.bytesIn);
    const bytesOut = safeBytes(raw.bytesOut);
    const current = merged.get(assignmentId);
    if (current) {
      current.bytesIn = safeBytes(Number(current.bytesIn || 0) + bytesIn);
      current.bytesOut = safeBytes(Number(current.bytesOut || 0) + bytesOut);
    } else {
      merged.set(assignmentId, { assignmentId, bytesIn, bytesOut });
    }
  }

  return Array.from(merged.values())
    .filter((item) => Number(item.bytesIn || 0) > 0 || Number(item.bytesOut || 0) > 0)
    .sort((left, right) => left.assignmentId - right.assignmentId);
}

export function normalizeAgentMieruTrafficStats(value: unknown): AgentMieruTrafficStat[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new AgentProtocolTrafficValidationError("mieruStats 必须是数组");
  }
  if (value.length > MAX_PROTOCOL_TRAFFIC_STATS) {
    throw new AgentProtocolTrafficValidationError(`mieruStats 超过上限 ${MAX_PROTOCOL_TRAFFIC_STATS}`);
  }
  const merged = new Map<string, AgentMieruTrafficStat>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new AgentProtocolTrafficValidationError("mieruStats 包含无效记录");
    }
    const username = String((raw as any).username || "").trim();
    if (!username || username.length > 64) {
      throw new AgentProtocolTrafficValidationError("Mieru username 无效");
    }
    const bytesIn = safeBytes((raw as any).bytesIn);
    const bytesOut = safeBytes((raw as any).bytesOut);
    const current = merged.get(username);
    if (current) {
      current.bytesIn = safeBytes(current.bytesIn + bytesIn);
      current.bytesOut = safeBytes(current.bytesOut + bytesOut);
    } else {
      merged.set(username, { username, bytesIn, bytesOut });
    }
  }
  return Array.from(merged.values())
    .filter((item) => item.bytesIn > 0 || item.bytesOut > 0)
    .sort((left, right) => left.username.localeCompare(right.username));
}

export function planAgentProtocolTrafficAccounting(
  stats: AgentProtocolTrafficStat[],
  ownershipRows: ProtocolAssignmentOwnership[],
  authenticatedHostId: number,
): ProtocolTrafficPlan {
  const hostId = Math.floor(Number(authenticatedHostId) || 0);
  const ownership = new Map<number, ProtocolAssignmentOwnership>();
  for (const row of ownershipRows || []) {
    const normalized = {
      assignmentId: Math.floor(Number(row.assignmentId) || 0),
      endpointId: Math.floor(Number(row.endpointId) || 0),
      userId: Math.floor(Number(row.userId) || 0),
      hostId: Math.floor(Number(row.hostId) || 0),
    };
    if (
      normalized.assignmentId > 0
      && normalized.endpointId > 0
      && normalized.userId > 0
      && normalized.hostId === hostId
    ) {
      ownership.set(normalized.assignmentId, normalized);
    }
  }

  const samples: ProtocolTrafficPlan["samples"] = [];
  const userTotals = new Map<number, number>();
  const ignoredAssignments: number[] = [];
  for (const stat of stats) {
    const row = ownership.get(Number(stat.assignmentId));
    if (!row) {
      ignoredAssignments.push(Number(stat.assignmentId));
      continue;
    }
    const bytesIn = safeBytes(stat.bytesIn);
    const bytesOut = safeBytes(stat.bytesOut);
    samples.push({ ...row, bytesIn, bytesOut });
    userTotals.set(row.userId, safeBytes((userTotals.get(row.userId) || 0) + bytesIn + bytesOut));
  }

  return { samples, userTotals, ignoredAssignments };
}

async function resolveMieruStatsForHost(hostId: number, stats: AgentMieruTrafficStat[]) {
  if (stats.length === 0) return { stats: [] as AgentProtocolTrafficStat[], ignoredUsernames: [] as string[] };
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select({
    assignmentId: protocolUserAccess.id,
    credentialJson: protocolUserAccess.credentialJson,
  }).from(protocolUserAccess)
    .innerJoin(protocolEndpoints, eq(protocolUserAccess.endpointId, protocolEndpoints.id))
    .where(and(
      eq(protocolEndpoints.hostId, hostId),
      eq(protocolEndpoints.runtimeMode, "managed"),
      eq(protocolEndpoints.protocol, "mieru"),
      eq(protocolEndpoints.isEnabled, true),
    ));

  const assignmentByUsername = new Map<string, number>();
  const ambiguous = new Set<string>();
  for (const row of rows as any[]) {
    const username = protocolConfigText(parseProtocolAccessConfig(row.credentialJson), "username");
    const assignmentId = Math.floor(Number(row.assignmentId) || 0);
    if (!username || assignmentId <= 0) continue;
    const previous = assignmentByUsername.get(username);
    if (previous && previous !== assignmentId) {
      ambiguous.add(username);
      assignmentByUsername.delete(username);
    } else if (!ambiguous.has(username)) {
      assignmentByUsername.set(username, assignmentId);
    }
  }

  const resolved: AgentProtocolTrafficStat[] = [];
  const ignoredUsernames: string[] = [];
  for (const stat of stats) {
    const assignmentId = assignmentByUsername.get(stat.username);
    if (!assignmentId || ambiguous.has(stat.username)) {
      ignoredUsernames.push(stat.username);
      continue;
    }
    resolved.push({ assignmentId, bytesIn: stat.bytesIn, bytesOut: stat.bytesOut });
  }
  return { stats: resolved, ignoredUsernames };
}

async function refreshProtocolHostsForUser(userId: number, reason: string) {
  const db = await getDb();
  if (!db) return;
  const rows = await db.select({ hostId: protocolEndpoints.hostId })
    .from(protocolUserAccess)
    .innerJoin(protocolEndpoints, eq(protocolUserAccess.endpointId, protocolEndpoints.id))
    .where(and(
      eq(protocolUserAccess.userId, userId),
      eq(protocolEndpoints.runtimeMode, "managed"),
    ));
  const hostIds = Array.from(new Set((rows as any[])
    .map((row) => Math.floor(Number(row?.hostId) || 0))
    .filter((id) => id > 0)));
  for (const hostId of hostIds) pushAgentRefresh(hostId, reason, { urgent: true });
}

async function refreshPausedUser(userId: number, reason: string) {
  await refreshUserForwardEndpoints(userId, reason, { urgent: true });
  await refreshProtocolHostsForUser(userId, reason);
}

export async function accountAgentProtocolTrafficReport(input: {
  token: string;
  body: any;
}) {
  const directStats = normalizeAgentProtocolTrafficStats(input.body?.protocolStats);
  const mieruStats = normalizeAgentMieruTrafficStats(input.body?.mieruStats);
  if (directStats.length === 0 && mieruStats.length === 0) {
    return {
      accounted: false,
      duplicate: false,
      assignments: 0,
      users: 0,
      ignoredAssignments: [] as number[],
      ignoredMieruUsers: [] as string[],
    };
  }

  const reportId = String(input.body?.reportId || "").trim();
  if (!reportId) {
    throw new AgentProtocolTrafficValidationError("协议流量上报必须包含 reportId");
  }
  const host = await getHostByAgentToken(String(input.token || ""));
  if (!host) {
    // Let the normal Agent route return the canonical authentication response.
    return {
      accounted: false,
      duplicate: false,
      assignments: 0,
      users: 0,
      ignoredAssignments: [] as number[],
      ignoredMieruUsers: [] as string[],
    };
  }

  const hostId = Number(host.id);
  const resolvedMieru = await resolveMieruStatsForHost(hostId, mieruStats);
  const stats = normalizeAgentProtocolTrafficStats([...directStats, ...resolvedMieru.stats]);
  if (stats.length === 0) {
    return {
      accounted: false,
      duplicate: false,
      assignments: 0,
      users: 0,
      ignoredAssignments: [] as number[],
      ignoredMieruUsers: resolvedMieru.ignoredUsernames,
    };
  }

  // Lazy DDL must stay outside the accounting transaction. MySQL DDL performs
  // an implicit commit even for CREATE TABLE IF NOT EXISTS.
  await ensureProtocolUserTrafficTable();

  const producerId = protocolTrafficProducerId(input.body?.reportProducerId);
  const pausedUsers: Array<{ userId: number; reason: string }> = [];
  const result = await withDatabaseTransaction(async () => {
    const claimed = await claimAgentTrafficReport(hostId, reportId, producerId);
    if (!claimed) {
      return {
        accounted: false,
        duplicate: true,
        assignments: 0,
        users: 0,
        ignoredAssignments: [] as number[],
        ignoredMieruUsers: [] as string[],
      };
    }

    const db = await getDb();
    if (!db) throw new Error("Database not available");
    const assignmentIds = stats.map((item) => Number(item.assignmentId));
    const ownershipRows = assignmentIds.length > 0
      ? await db.select({
          assignmentId: protocolUserAccess.id,
          endpointId: protocolUserAccess.endpointId,
          userId: protocolUserAccess.userId,
          hostId: protocolEndpoints.hostId,
        }).from(protocolUserAccess)
          .innerJoin(protocolEndpoints, eq(protocolUserAccess.endpointId, protocolEndpoints.id))
          .where(and(
            inArray(protocolUserAccess.id, assignmentIds),
            eq(protocolEndpoints.hostId, hostId),
          ))
      : [];

    const plan = planAgentProtocolTrafficAccounting(stats, ownershipRows as ProtocolAssignmentOwnership[], hostId);
    await insertProtocolUserTrafficSamples(plan.samples, { ensureTable: false });
    for (const [userId, totalBytes] of Array.from(plan.userTotals.entries()).sort((a, b) => a[0] - b[0])) {
      if (totalBytes <= 0) continue;
      const user = await addUserTraffic(userId, totalBytes);
      if (!user) continue;
      let pauseReason = "";
      if (Number(user.trafficLimit || 0) > 0 && Number(user.trafficUsed || 0) >= Number(user.trafficLimit || 0)) {
        await setUserForwardAccess(user.id, false, "traffic_limit");
        pauseReason = "protocol-traffic-limit-exceeded";
      }
      if (user.expiresAt && new Date(user.expiresAt) <= new Date()) {
        await setUserForwardAccess(user.id, false, "expired");
        pauseReason = "protocol-user-expired";
      }
      if (pauseReason) pausedUsers.push({ userId: Number(user.id), reason: pauseReason });
    }

    return {
      accounted: plan.samples.length > 0,
      duplicate: false,
      assignments: plan.samples.length,
      users: plan.userTotals.size,
      ignoredAssignments: plan.ignoredAssignments,
      ignoredMieruUsers: resolvedMieru.ignoredUsernames,
    };
  });

  for (const paused of pausedUsers) {
    await refreshPausedUser(paused.userId, paused.reason);
  }
  return result;
}
