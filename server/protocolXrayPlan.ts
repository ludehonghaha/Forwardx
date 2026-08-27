import { createHash } from "node:crypto";
import {
  managedProtocolListenPort,
  parseProtocolAccessConfig,
  protocolConfigSecret,
  protocolConfigText,
} from "../shared/protocolAccess";
import { isVlessUuid } from "../shared/vlessCredentials";
import type { ManagedProtocolEndpointRow } from "./protocolRuntimePlan";

export const XRAY_STATS_API_LISTEN = "127.0.0.1:0";
export const XRAY_STATS_API_TAG = "forwardx-api";

export type ManagedXrayRuntimeSocket = {
  endpointId: number;
  protocol: "vless_reality";
  listenPort: number;
  transport: "tcp";
};

export type ManagedXrayRuntimeUser = {
  assignmentId: number;
  userId: number;
  email: string;
  uuid: string;
};

export type ManagedXrayRuntimePlan = {
  sockets: ManagedXrayRuntimeSocket[];
  users: ManagedXrayRuntimeUser[];
  config: Record<string, unknown>;
};

function validPort(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

function parkingRealityUuid(endpointId: number, privateKey: string) {
  const bytes = createHash("sha256")
    .update("forwardx-vless-parking-v1\0", "utf8")
    .update(String(endpointId), "utf8")
    .update("\0", "utf8")
    .update(privateKey, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function assignmentEmail(assignmentId: number, userId: number) {
  return `forwardx-assignment-${assignmentId}-user-${userId}`;
}

function managedRealityInbound(row: ManagedProtocolEndpointRow) {
  const config = parseProtocolAccessConfig(row.configJson);
  const listenPort = managedProtocolListenPort(config, Number(row.publicPort));
  const serverName = protocolConfigText(config, "serverName");
  const target = protocolConfigText(config, "realityDest");
  const privateKey = protocolConfigSecret(config, "realityPrivateKey");
  const shortId = protocolConfigText(config, "shortId");
  if (!validPort(listenPort) || !serverName || !target || !privateKey || !shortId) return null;

  const sourceUsers = Array.isArray(row.vlessUsers)
    ? [...row.vlessUsers].sort((left, right) => Number(left.assignmentId) - Number(right.assignmentId))
    : [];
  const seenUuids = new Set<string>();
  const runtimeUsers: ManagedXrayRuntimeUser[] = [];
  const users: Array<{ id: string; level: 0; email: string; flow: "xtls-rprx-vision" }> = [];

  for (const item of sourceUsers) {
    const assignmentId = Number(item?.assignmentId || 0);
    const userId = Number(item?.userId || 0);
    const uuid = String(item?.uuid || "").trim();
    if (!Number.isInteger(assignmentId) || assignmentId <= 0 || !Number.isInteger(userId) || userId <= 0) return null;
    if (!isVlessUuid(uuid) || seenUuids.has(uuid)) return null;
    seenUuids.add(uuid);
    const email = assignmentEmail(assignmentId, userId);
    runtimeUsers.push({ assignmentId, userId, email, uuid });
    users.push({ id: uuid, level: 0, email, flow: "xtls-rprx-vision" });
  }

  if (users.length === 0) {
    users.push({
      id: parkingRealityUuid(Number(row.id), privateKey),
      level: 0,
      email: `forwardx-parking-${Number(row.id)}`,
      flow: "xtls-rprx-vision",
    });
  }

  return {
    inbound: {
      tag: `fwx-reality-${Number(row.id)}`,
      listen: "0.0.0.0",
      port: listenPort,
      protocol: "vless",
      settings: {
        users,
        decryption: "none",
      },
      streamSettings: {
        network: "raw",
        security: "reality",
        realitySettings: {
          show: false,
          target,
          xver: 0,
          serverNames: [serverName],
          privateKey,
          // Xray changed the REALITY server default to 26.3.27 in 2026.
          // ForwardX subscriptions are intentionally cross-client (Shadowrocket,
          // Mihomo/Clash Meta, Xray), so preserve the previous compatibility
          // boundary instead of silently rejecting non-Xray clients.
          minClientVer: "0",
          maxClientVer: "",
          maxTimeDiff: 0,
          shortIds: [shortId],
        },
      },
    },
    socket: {
      endpointId: Number(row.id),
      protocol: "vless_reality" as const,
      listenPort,
      transport: "tcp" as const,
    },
    users: runtimeUsers,
  };
}

/**
 * Compile managed VLESS+Reality endpoints into one Xray process per Agent host.
 *
 * Each ForwardX assignment becomes one Xray user with a stable email containing
 * the assignment id. P0-2B traffic accounting can therefore query/reset Xray's
 * native per-user counters without attributing a shared listener to one owner.
 * StatsService listens on 127.0.0.1:0 so the kernel chooses a free private API
 * port on every process start; the Agent discovers that loopback socket locally.
 */
export function buildManagedXrayRuntimePlan(rows: ManagedProtocolEndpointRow[]): ManagedXrayRuntimePlan | null {
  const candidates = [...rows]
    .filter((row) => row?.isEnabled && row.runtimeMode === "managed" && row.protocol === "vless_reality")
    .sort((left, right) => Number(left.id) - Number(right.id));
  if (candidates.length === 0) return null;

  const inbounds: Record<string, unknown>[] = [];
  const sockets: ManagedXrayRuntimeSocket[] = [];
  const users: ManagedXrayRuntimeUser[] = [];
  for (const row of candidates) {
    const compiled = managedRealityInbound(row);
    if (!compiled) return null;
    inbounds.push(compiled.inbound);
    sockets.push(compiled.socket);
    users.push(...compiled.users);
  }

  const socketKeys = sockets.map((socket) => `${socket.transport}:${socket.listenPort}`);
  if (new Set(socketKeys).size !== socketKeys.length) return null;
  const assignmentIds = users.map((user) => user.assignmentId);
  if (new Set(assignmentIds).size !== assignmentIds.length) return null;

  return {
    sockets,
    users,
    config: {
      log: { loglevel: "warning" },
      api: {
        tag: XRAY_STATS_API_TAG,
        listen: XRAY_STATS_API_LISTEN,
        services: ["StatsService"],
      },
      policy: {
        levels: {
          "0": {
            statsUserUplink: true,
            statsUserDownlink: true,
          },
        },
      },
      stats: {},
      inbounds,
      outbounds: [{ tag: "direct", protocol: "freedom" }],
      routing: {
        domainStrategy: "AsIs",
        rules: [{
          type: "field",
          inboundTag: inbounds.map((inbound: any) => String(inbound.tag || "")).filter(Boolean),
          outboundTag: "direct",
        }],
      },
    },
  };
}
