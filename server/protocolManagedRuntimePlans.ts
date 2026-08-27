import type { ManagedProtocolEndpointRow } from "./protocolRuntimePlan";
import { buildManagedMihomoRuntimePlan } from "./protocolRuntimePlan";
import { buildManagedXrayRuntimePlan } from "./protocolXrayPlan";

/**
 * Runtime ownership for Agent-managed entry protocols during the P0-2C Reality
 * migration.
 *
 * Keep the current mainline compilers unchanged and split their inputs here so
 * this helper can be integrated into heartbeat atomically later:
 *
 * - SS              -> GOST (compiled separately)
 * - Mieru           -> mita (compiled separately)
 * - VLESS + Reality -> Xray
 * - Snell / HY2     -> Mihomo
 *
 * The explicit Reality filter is important on v2.3.284: its existing Mihomo
 * compiler still knows how to compile Reality. Calling both compilers with the
 * same rows would otherwise create duplicate listeners on the same port.
 */
export function buildManagedEntryRuntimePlans(rows: ManagedProtocolEndpointRow[]) {
  const source = Array.isArray(rows) ? rows : [];
  const mihomoRows = source.filter((row) => row?.protocol !== "vless_reality");
  return {
    xray: buildManagedXrayRuntimePlan(source),
    mihomo: buildManagedMihomoRuntimePlan(mihomoRows),
  };
}
