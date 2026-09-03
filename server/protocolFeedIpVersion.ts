import { eq, inArray } from "drizzle-orm";
import { hosts, protocolEndpoints } from "../drizzle/schema";
import type { ProtocolFeedEntry } from "../shared/protocolAccess";
import { getDb } from "./dbRuntime";

export type ProtocolFeedIpVersion = "4" | "6";

export class ProtocolFeedIpv6UnavailableError extends Error {
  constructor(entry: ProtocolFeedEntry) {
    super(`端点“${entry.name || `#${entry.endpointId}`}”没有可用 IPv6 地址`);
    this.name = "ProtocolFeedIpv6UnavailableError";
  }
}

export function parseProtocolFeedIpVersion(value: unknown): ProtocolFeedIpVersion {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized === "4") return "4";
  if (normalized === "6") return "6";
  throw new Error("ipVersion 必须是 4 或 6");
}

export function selectProtocolFeedAddressFamily(
  entries: ProtocolFeedEntry[],
  ipVersion: ProtocolFeedIpVersion = "4",
  ipv6ByEndpoint: ReadonlyMap<number, string> = new Map(),
): ProtocolFeedEntry[] {
  if (ipVersion === "4") return entries;

  const selected: ProtocolFeedEntry[] = [];
  let firstUnavailable: ProtocolFeedEntry | undefined;
  for (const entry of entries) {
    const ipv6 = String(ipv6ByEndpoint.get(Number(entry.endpointId)) || "").trim();
    if (!ipv6) {
      firstUnavailable ||= entry;
      continue;
    }
    selected.push({ ...entry, publicHost: ipv6 });
  }

  if (selected.length === 0 && firstUnavailable) {
    throw new ProtocolFeedIpv6UnavailableError(firstUnavailable);
  }
  return selected;
}

export async function selectProtocolFeedEntriesForIpVersion(
  entries: ProtocolFeedEntry[],
  ipVersion: ProtocolFeedIpVersion,
): Promise<ProtocolFeedEntry[]> {
  if (ipVersion === "4" || entries.length === 0) return entries;
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const endpointIds = Array.from(new Set(entries.map((entry) => Number(entry.endpointId)).filter((id) => id > 0)));
  if (endpointIds.length === 0) return selectProtocolFeedAddressFamily(entries, ipVersion);

  const rows = await db.select({
    endpointId: protocolEndpoints.id,
    ipv6: hosts.ipv6,
  }).from(protocolEndpoints)
    .leftJoin(hosts, eq(protocolEndpoints.hostId, hosts.id))
    .where(inArray(protocolEndpoints.id, endpointIds));

  const ipv6ByEndpoint = new Map<number, string>();
  for (const row of rows as any[]) {
    const ipv6 = String(row.ipv6 || "").trim();
    if (ipv6) ipv6ByEndpoint.set(Number(row.endpointId), ipv6);
  }
  return selectProtocolFeedAddressFamily(entries, ipVersion, ipv6ByEndpoint);
}
