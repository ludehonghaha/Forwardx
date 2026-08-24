import { quoteIdentifier } from "./dbCompat";
import { queryRaw } from "./dbRuntime";
import { withKeyedTaskLock } from "./keyedTaskLock";
import { parseProtocolAccessConfig } from "../shared/protocolAccess";

type PendingQuota = {
  rules: number;
  ports: number;
};

type QuotaRuleRow = {
  id: unknown;
  sourcePort: unknown;
  forwardGroupRuleId: unknown;
  pendingDelete: unknown;
};

type ProtocolBridgeEndpointRow = {
  forwardRuleId: unknown;
  configJson: unknown;
};

export type RuleQuotaReservation = {
  release: () => Promise<void>;
};

const pendingByUser = new Map<number, PendingQuota>();
const PROTOCOL_TRAFFIC_BRIDGE_CONFIG_KEY = "_forwardxTrafficBridge";

function positiveInteger(value: unknown) {
  const number = Math.floor(Number(value));
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function databaseBoolean(value: unknown) {
  return value === true || value === 1 || value === "1" || String(value).trim().toLowerCase() === "true";
}

export function managedProtocolBridgeRuleIds(rows: ProtocolBridgeEndpointRow[]) {
  const ids = new Set<number>();
  for (const row of rows || []) {
    const linkedRuleId = positiveInteger(row.forwardRuleId);
    if (!linkedRuleId) continue;
    const config = parseProtocolAccessConfig(row.configJson);
    const marker = config[PROTOCOL_TRAFFIC_BRIDGE_CONFIG_KEY];
    if (!marker || typeof marker !== "object" || Array.isArray(marker)) continue;
    const value = marker as Record<string, unknown>;
    if (value.managed !== true || Number(value.version) !== 1) continue;
    const markerRuleId = positiveInteger(value.ruleId);
    if (markerRuleId !== linkedRuleId) continue;
    ids.add(linkedRuleId);
  }
  return ids;
}

export function ruleQuotaUsageExcludingManagedProtocolBridges(
  rows: QuotaRuleRow[],
  bridgeRuleIds: Set<number>,
) {
  const visibleRootRules = (rows || []).filter((row) => (
    !databaseBoolean(row.pendingDelete)
    && (row.forwardGroupRuleId === null || row.forwardGroupRuleId === undefined)
    && !bridgeRuleIds.has(positiveInteger(row.id))
  ));
  const ports = new Set(visibleRootRules
    .map((row) => positiveInteger(row.sourcePort))
    .filter((port) => port > 0));
  return { rules: visibleRootRules.length, ports: ports.size };
}

async function readEffectiveRuleQuotaUsage(userId: number) {
  const q = quoteIdentifier;
  const [ruleRows, endpointRows] = await Promise.all([
    queryRaw<QuotaRuleRow>(
      `SELECT ${q("id")} AS ${q("id")},
              ${q("sourcePort")} AS ${q("sourcePort")},
              ${q("forwardGroupRuleId")} AS ${q("forwardGroupRuleId")},
              ${q("pendingDelete")} AS ${q("pendingDelete")}
         FROM ${q("forward_rules")}
        WHERE ${q("userId")} = ?`,
      [userId],
    ),
    queryRaw<ProtocolBridgeEndpointRow>(
      `SELECT e.${q("forwardRuleId")} AS ${q("forwardRuleId")},
              e.${q("configJson")} AS ${q("configJson")}
         FROM ${q("protocol_endpoints")} e
         INNER JOIN ${q("forward_rules")} r
           ON r.${q("id")} = e.${q("forwardRuleId")}
        WHERE e.${q("runtimeMode")} = ?
          AND r.${q("userId")} = ?`,
      ["managed", userId],
    ),
  ]);
  return ruleQuotaUsageExcludingManagedProtocolBridges(
    ruleRows,
    managedProtocolBridgeRuleIds(endpointRows),
  );
}

export async function reserveRuleCreateQuota(input: {
  userId: number;
  maxRules: number;
  maxPorts: number;
  getRuleCount: () => Promise<number>;
  getPortCount: () => Promise<number>;
}): Promise<RuleQuotaReservation> {
  const userId = Number(input.userId);
  const maxRules = Math.max(0, Number(input.maxRules) || 0);
  const maxPorts = Math.max(0, Number(input.maxPorts) || 0);
  if (maxRules === 0 && maxPorts === 0) return { release: async () => undefined };

  return withKeyedTaskLock(`rule-create-quota:${userId}`, async () => {
    const pending = pendingByUser.get(userId) || { rules: 0, ports: 0 };
    const effectiveUsage = await readEffectiveRuleQuotaUsage(userId).catch(() => null);
    const [ruleCount, portCount] = await Promise.all([
      maxRules > 0
        ? effectiveUsage ? Promise.resolve(effectiveUsage.rules) : input.getRuleCount()
        : Promise.resolve(0),
      maxPorts > 0
        ? effectiveUsage ? Promise.resolve(effectiveUsage.ports) : input.getPortCount()
        : Promise.resolve(0),
    ]);
    if (maxRules > 0 && Number(ruleCount) + pending.rules >= maxRules) {
      throw new Error(`您已达到最大规则数量限制（${maxRules} 条）`);
    }
    if (maxPorts > 0 && Number(portCount) + pending.ports >= maxPorts) {
      throw new Error(`您已达到最大端口数量限制（${maxPorts} 个）`);
    }

    pendingByUser.set(userId, {
      rules: pending.rules + (maxRules > 0 ? 1 : 0),
      ports: pending.ports + (maxPorts > 0 ? 1 : 0),
    });
    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        await withKeyedTaskLock(`rule-create-quota:${userId}`, async () => {
          const current = pendingByUser.get(userId);
          if (!current) return;
          const next = {
            rules: Math.max(0, current.rules - (maxRules > 0 ? 1 : 0)),
            ports: Math.max(0, current.ports - (maxPorts > 0 ? 1 : 0)),
          };
          if (next.rules === 0 && next.ports === 0) pendingByUser.delete(userId);
          else pendingByUser.set(userId, next);
        });
      },
    };
  });
}

export function clearRuleQuotaReservationsForTest() {
  pendingByUser.clear();
}
