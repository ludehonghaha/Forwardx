import { randomUUID } from "node:crypto";
import {
  parseProtocolAccessConfig,
  protocolConfigText,
  type ProtocolAccessConfig,
} from "../shared/protocolAccess";
import { isVlessUuid } from "../shared/vlessCredentials";

export type ManagedVlessCredentialRow = {
  id: number;
  credentialJson: unknown;
};

export type ManagedVlessCredentialBackfill = {
  id: number;
  credential: ProtocolAccessConfig;
  changed: boolean;
};

type UuidFactory = () => string;

function nextUniqueUuid(used: Set<string>, createUuid: UuidFactory) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const candidate = String(createUuid() || "").trim();
    if (isVlessUuid(candidate) && !used.has(candidate)) return candidate;
  }
  throw new Error("无法生成唯一的 VLESS 用户 UUID");
}

/**
 * Produces stable per-assignment VLESS credentials. Existing valid UUIDs are
 * never rotated by enable/disable updates; caller-provided UUIDs cannot replace
 * a server-owned assignment identity.
 */
export function managedVlessCredentialForWrite(
  existingValue: unknown,
  incomingValue: unknown,
  usedUuids: Iterable<string> = [],
  createUuid: UuidFactory = randomUUID,
) {
  const existing = parseProtocolAccessConfig(existingValue);
  const incoming = parseProtocolAccessConfig(incomingValue);
  const existingUuid = protocolConfigText(existing, "uuid");
  const used = new Set(Array.from(usedUuids).map((value) => String(value || "").trim()).filter(isVlessUuid));
  const uuid = isVlessUuid(existingUuid)
    ? existingUuid
    : nextUniqueUuid(used, createUuid);
  return { ...existing, ...incoming, uuid } as ProtocolAccessConfig;
}

/**
 * Legacy backfill is deterministic with respect to existing rows:
 * - every already-valid unique UUID is preserved;
 * - at most one legacy row inherits the old endpoint UUID so an existing
 *   single-user node keeps working after upgrade;
 * - all remaining missing/duplicate rows receive fresh unique UUIDs.
 */
export function planManagedVlessCredentialBackfill(
  endpointUuidValue: unknown,
  rows: ManagedVlessCredentialRow[],
  createUuid: UuidFactory = randomUUID,
): ManagedVlessCredentialBackfill[] {
  const sorted = [...rows].sort((left, right) => Number(left.id) - Number(right.id));
  const reserved = new Set<string>();
  const keeperIds = new Set<number>();

  for (const row of sorted) {
    const credential = parseProtocolAccessConfig(row.credentialJson);
    const uuid = protocolConfigText(credential, "uuid");
    if (!isVlessUuid(uuid) || reserved.has(uuid)) continue;
    reserved.add(uuid);
    keeperIds.add(Number(row.id));
  }

  const endpointUuid = String(endpointUuidValue || "").trim();
  let legacyUuidAvailable = isVlessUuid(endpointUuid) && !reserved.has(endpointUuid);

  return sorted.map((row) => {
    const credential = parseProtocolAccessConfig(row.credentialJson);
    if (keeperIds.has(Number(row.id))) {
      return { id: Number(row.id), credential, changed: false };
    }

    let uuid = "";
    if (legacyUuidAvailable) {
      uuid = endpointUuid;
      legacyUuidAvailable = false;
    } else {
      uuid = nextUniqueUuid(reserved, createUuid);
    }
    reserved.add(uuid);
    return {
      id: Number(row.id),
      credential: { ...credential, uuid },
      changed: true,
    };
  });
}
