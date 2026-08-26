import type { ManagedProtocolEndpointRow } from "./protocolRuntimePlan";
import { buildManagedMihomoRuntimePlan } from "./protocolRuntimePlan";
import { buildManagedXrayRuntimePlan } from "./protocolXrayPlan";

/**
 * Runtime ownership for Agent-managed entry protocols.
 *
 * Each compiler now owns only its native protocol family, so callers may pass
 * the same host endpoint set to both without risking duplicate listeners:
 *
 * - SS              -> GOST (compiled separately)
 * - Mieru           -> mita (compiled separately)
 * - VLESS + Reality -> Xray
 * - Snell / HY2     -> Mihomo
 */
export function buildManagedEntryRuntimePlans(rows: ManagedProtocolEndpointRow[]) {
  return {
    xray: buildManagedXrayRuntimePlan(rows),
    mihomo: buildManagedMihomoRuntimePlan(rows),
  };
}
