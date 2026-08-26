import { and, eq, inArray } from "drizzle-orm";
import { protocolEndpoints, protocolUserAccess } from "../drizzle/schema";
import {
  isAgentProtocolTrafficStat,
  type AgentProtocolTrafficStat,
} from "../shared/agentDtos";
import { getDb, withDatabaseTransaction } from "./dbRuntime";
import { getHostByAgentToken } from "./repositories/hostRepository";
import { claimAgentTrafficReport } from "./repositories/metricsRepository";
import {
  ensureProtocolUserTrafficTable,
  insertProtocolUserTrafficSamples,
} from "./repositories/protocolUserTrafficRepository";
import { addUserTraffic } from "./repositories/userRepository";

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
      const nextIn = safeBytes(Number(current.bytesIn || 0) + bytesIn);
      const nextOut = safeBytes(Number(current.bytesOut || 0) + bytesOut);
      current.bytesIn = nextIn;
      current.bytesOut = nextOut;
    } else {
      merged.set(assignmentId, { assignmentId, bytesIn, bytesOut });
    }
  }

  return Array.from(merged.values())
    .filter((item) => Number(item.bytesIn || 0) > 0 || Number(item.bytesOut || 0) > 0)
    .sort((left, right) => left.assignmentId - right.assignmentId);
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

export async function accountAgentProtocolTrafficReport(input: {
  token: string;
  body: any;
}) {
  const stats = normalizeAgentProtocolTrafficStats(input.body?.protocolStats);
  if (stats.length === 0) {
    return { accounted: false, duplicate: false, assignments: 0, users: 0, ignoredAssignments: [] as number[] };
  }

  const reportId = String(input.body?.reportId || "").trim();
  if (!reportId) {
    throw new AgentProtocolTrafficValidationError("protocolStats 上报必须包含 reportId");
  }
  const host = await getHostByAgentToken(String(input.token || ""));
  if (!host) {
    // Let the normal Agent route return the canonical authentication response.
    return { accounted: false, duplicate: false, assignments: 0, users: 0, ignoredAssignments: [] as number[] };
  }

  // Lazy DDL must stay outside the accounting transaction. MySQL DDL performs
  // an implicit commit even for CREATE TABLE IF NOT EXISTS.
  await ensureProtocolUserTrafficTable();

  const producerId = protocolTrafficProducerId(input.body?.reportProducerId);
  const hostId = Number(host.id);
  return withDatabaseTransaction(async () => {
    const claimed = await claimAgentTrafficReport(hostId, reportId, producerId);
    if (!claimed) {
      return { accounted: false, duplicate: true, assignments: 0, users: 0, ignoredAssignments: [] as number[] };
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
      if (totalBytes > 0) await addUserTraffic(userId, totalBytes);
    }

    return {
      accounted: plan.samples.length > 0,
      duplicate: false,
      assignments: plan.samples.length,
      users: plan.userTotals.size,
      ignoredAssignments: plan.ignoredAssignments,
    };
  });
}
