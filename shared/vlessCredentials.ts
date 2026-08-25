import {
  protocolConfigText,
  type ProtocolFeedEntry,
} from "./protocolAccess";

export function isVlessUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

/**
 * Assignment credentials are authoritative for VLESS users. The endpoint UUID
 * remains a compatibility fallback for legacy/external feeds until their
 * assignment row has been backfilled.
 */
export function effectiveVlessUuid(entry: ProtocolFeedEntry) {
  return protocolConfigText(entry.credential, "uuid")
    || protocolConfigText(entry.endpointConfig, "uuid");
}
