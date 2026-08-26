import type { ManagedProtocolEndpointRow } from "./protocolRuntimePlan";
import { buildManagedMihomoRuntimePlan } from "./protocolRuntimePlan";
import { buildManagedXrayRuntimePlan } from "./protocolXrayPlan";

/**
 * Runtime ownership for Agent-managed entry protocols.
 *
 * Keep protocolRuntimePlan.ts backward-compatible while P0-2B migrates
 * VLESS+Reality to Xray. Callers that opt into this splitter get exactly one
 * owner for every managed endpoint:
 *
 * - SS              -> GOST (compiled separately)
 * - Mieru           -> mita (compiled separately)
 * - VLESS + Reality -> Xray
 * - Snell / HY2     -> Mihomo
 */
export function buildManagedEntryRuntimePlans(rows: ManagedProtocolEndpointRow[]) {
  const xrayRows = rows.filter((row) => row?.protocol === "vless_reality");
  const mihomoRows = rows.filter((row) => row?.protocol !== "vless_reality");
  return {
    xray: buildManagedXrayRuntimePlan(xrayRows),
    mihomo: buildManagedMihomoRuntimePlan(mihomoRows),
  };
}
