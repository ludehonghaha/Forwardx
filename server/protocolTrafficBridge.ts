import * as db from "./db";
import { pushAgentRefresh } from "./agentEvents";
import { getForwardProtocolSettings } from "./forwardProtocolSettings";
import { reserveManagedProtocolPort } from "./protocolManagedPort";
import { reserveSpecificHostPort, type HostPortReservation } from "./portReservations";
import {
  managedProtocolListenPort,
  managedProtocolSocketProtocol,
  parseProtocolAccessConfig,
  type ProtocolAccessConfig,
  type ProtocolAccessProtocol,
} from "../shared/protocolAccess";
import type { ForwardRuleProtocol, ForwardType } from "../shared/forwardTypes";

export const PROTOCOL_TRAFFIC_BRIDGE_CONFIG_KEY = "_forwardxTrafficBridge";
const PROTOCOL_TRAFFIC_BRIDGE_VERSION = 1;
const PROCESS_BRIDGE_FORWARD_TYPES = new Set<ForwardType>(["gost", "realm", "socat", "nginx"]);

export type ProtocolTrafficBridgeMarker = {
  version: 1;
  managed: true;
  ruleId: number;
  ownerUserId: number;
  publicPort: number;
  listenPort: number;
};

function positiveInteger(value: unknown) {
  const number = Math.floor(Number(value));
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function dbEnabled(value: unknown) {
  return value !== false && value !== 0 && value !== "0";
}

function userCanReceiveProtocolTraffic(user: any) {
  if (!user || !dbEnabled(user.accountEnabled)) return false;
  const expiresAt = user.expiresAt ? new Date(user.expiresAt).getTime() : 0;
  if (expiresAt > 0 && expiresAt <= Date.now()) return false;
  const trafficLimit = Math.max(0, Number(user.trafficLimit) || 0);
  const trafficUsed = Math.max(0, Number(user.trafficUsed) || 0);
  if (trafficLimit > 0 && trafficUsed >= trafficLimit) return false;
  return true;
}

export function protocolTrafficBridgeMarker(configValue: unknown): ProtocolTrafficBridgeMarker | null {
  const config = parseProtocolAccessConfig(configValue);
  const raw = config[PROTOCOL_TRAFFIC_BRIDGE_CONFIG_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const ruleId = positiveInteger(value.ruleId);
  const ownerUserId = positiveInteger(value.ownerUserId);
  const publicPort = positiveInteger(value.publicPort);
  const listenPort = positiveInteger(value.listenPort);
  if (Number(value.version) !== PROTOCOL_TRAFFIC_BRIDGE_VERSION || value.managed !== true) return null;
  if (!ruleId || !ownerUserId || publicPort > 65535 || listenPort > 65535) return null;
  return {
    version: PROTOCOL_TRAFFIC_BRIDGE_VERSION,
    managed: true,
    ruleId,
    ownerUserId,
    publicPort,
    listenPort,
  };
}

export function withoutProtocolTrafficBridgeMarker(configValue: unknown) {
  const config = { ...parseProtocolAccessConfig(configValue) };
  delete config[PROTOCOL_TRAFFIC_BRIDGE_CONFIG_KEY];
  return config;
}

export function managedProtocolTrafficOwnerUserId(assignments: any[]) {
  const userIds = Array.from(new Set((assignments || [])
    .filter((item: any) => dbEnabled(item?.access?.isEnabled))
    .map((item: any) => positiveInteger(item?.access?.userId ?? item?.user?.id))
    .filter((userId: number) => userId > 0)));
  if (userIds.length > 1) {
    throw new Error("Agent 托管协议使用共享运行时凭据，无法把同一监听端口的流量准确拆分给多个用户；请为每个用户创建独立托管端点");
  }
  return userIds[0] || 0;
}

export function selectProtocolTrafficBridgeForwardType(
  settings: Partial<Record<string, unknown>> | null | undefined,
): ForwardType | null {
  // The bridge target is loopback. Prefer process-based forwarders that can
  // connect to 127.0.0.1 directly; do not fall back to NAT backends whose
  // loopback forwarding depends on host route_localnet/sysctl state.
  const candidates: ForwardType[] = ["gost", "realm", "socat", "nginx"];
  for (const candidate of candidates) {
    if (settings?.[candidate] !== false) return candidate;
  }
  return null;
}

export function managedProtocolTrafficBridgeMatches(input: {
  endpoint: any;
  ownerUserId: number;
  marker: ProtocolTrafficBridgeMarker | null;
  linkedRule: any;
}) {
  const marker = input.marker;
  const rule = input.linkedRule;
  if (!marker || !rule || rule.pendingDelete) return false;
  const config = parseProtocolAccessConfig(input.endpoint?.configJson);
  const protocol = input.endpoint?.protocol as ProtocolAccessProtocol;
  const publicPort = positiveInteger(input.endpoint?.publicPort);
  const listenPort = managedProtocolListenPort(config, publicPort);
  const serverProtocol = managedProtocolSocketProtocol(protocol, config);
  return marker.ruleId === positiveInteger(rule.id)
    && marker.ruleId === positiveInteger(input.endpoint?.forwardRuleId)
    && marker.ownerUserId === input.ownerUserId
    && marker.publicPort === publicPort
    && marker.listenPort === listenPort
    && positiveInteger(rule.userId) === input.ownerUserId
    && positiveInteger(rule.hostId) === positiveInteger(input.endpoint?.hostId)
    && Number(rule.sourcePort) === publicPort
    && String(rule.targetIp || "") === "127.0.0.1"
    && Number(rule.targetPort) === listenPort
    && String(rule.protocol || "") === serverProtocol
    && PROCESS_BRIDGE_FORWARD_TYPES.has(String(rule.forwardType || "") as ForwardType)
    && positiveInteger(rule.tunnelId) === 0
    && positiveInteger(rule.forwardGroupId) === 0
    && !dbEnabled(rule.isForwardGroupTemplate);
}

function bridgeRuleName(endpoint: any) {
  const name = String(endpoint?.name || "协议端点").trim() || "协议端点";
  return `协议流量 · ${name}（系统）`.slice(0, 128);
}

function bridgeMarker(input: {
  ruleId: number;
  ownerUserId: number;
  publicPort: number;
  listenPort: number;
}): ProtocolTrafficBridgeMarker {
  return {
    version: PROTOCOL_TRAFFIC_BRIDGE_VERSION,
    managed: true,
    ruleId: input.ruleId,
    ownerUserId: input.ownerUserId,
    publicPort: input.publicPort,
    listenPort: input.listenPort,
  };
}

async function reserveBridgePublicPort(input: {
  endpoint: any;
  protocol: ForwardRuleProtocol;
  excludeRuleId?: number;
}) {
  const hostId = positiveInteger(input.endpoint?.hostId);
  const publicPort = positiveInteger(input.endpoint?.publicPort);
  if (!hostId || !publicPort || publicPort > 65535) return null;
  return reserveSpecificHostPort({
    hostId,
    port: publicPort,
    protocol: input.protocol,
    isUsed: (port) => db.isPortUsedOnHost(
      hostId,
      port,
      input.excludeRuleId || undefined,
      input.protocol,
      undefined,
      true,
      positiveInteger(input.endpoint?.id) || undefined,
    ),
  });
}

async function reserveBridgeListenPort(input: {
  endpoint: any;
  protocol: ForwardRuleProtocol;
  excludedPorts?: Iterable<number>;
}) {
  const hostId = positiveInteger(input.endpoint?.hostId);
  if (!hostId) return null;
  return reserveManagedProtocolPort({
    hostId,
    protocol: input.protocol,
    excludedPorts: input.excludedPorts,
    findAvailablePort: (excludedPorts) => db.findAvailablePort(
      hostId,
      undefined,
      undefined,
      input.protocol,
      excludedPorts,
      [],
      [],
    ),
    isPortUsed: (port) => db.isPortUsedOnHost(
      hostId,
      port,
      undefined,
      input.protocol,
      undefined,
      true,
      positiveInteger(input.endpoint?.id) || undefined,
    ),
  });
}

async function reserveConfiguredBridgeListenPort(input: {
  endpoint: any;
  protocol: ForwardRuleProtocol;
  port: number;
}) {
  const hostId = positiveInteger(input.endpoint?.hostId);
  if (!hostId || !input.port || input.port > 65535) return null;
  return reserveSpecificHostPort({
    hostId,
    port: input.port,
    protocol: input.protocol,
    isUsed: (port) => db.isPortUsedOnHost(
      hostId,
      port,
      undefined,
      input.protocol,
      undefined,
      true,
      positiveInteger(input.endpoint?.id) || undefined,
    ),
  });
}

async function createBridgeRule(input: {
  endpoint: any;
  ownerUserId: number;
  listenPort: number;
  protocol: ForwardRuleProtocol;
}) {
  const settings = await getForwardProtocolSettings();
  const forwardType = selectProtocolTrafficBridgeForwardType(settings);
  if (!forwardType) {
    throw new Error("没有可用的 GOST、Realm、Socat 或 Nginx 本机转发方式，无法为托管协议建立用户流量计量桥接");
  }
  return db.createForwardRule({
    hostId: positiveInteger(input.endpoint.hostId),
    name: bridgeRuleName(input.endpoint),
    forwardType,
    protocol: input.protocol,
    gostMode: "direct",
    tunnelId: null,
    tunnelExitPort: null,
    forwardGroupId: null,
    forwardGroupRuleId: null,
    forwardGroupMemberId: null,
    isForwardGroupTemplate: false,
    sourcePort: positiveInteger(input.endpoint.publicPort),
    targetIp: "127.0.0.1",
    targetPort: input.listenPort,
    telegramErrorNotifyEnabled: false,
    blockHttp: false,
    blockSocks: false,
    blockTls: false,
    isEnabled: true,
    isRunning: false,
    pendingDelete: false,
    userId: input.ownerUserId,
  } as any);
}

async function disableOwnedBridgeRule(ruleId: number) {
  const rule = await db.getForwardRuleById(ruleId) as any;
  if (!rule || rule.pendingDelete || !rule.isEnabled) return false;
  await db.updateForwardRule(ruleId, {
    isEnabled: false,
    isRunning: false,
    disabledByUser: false,
    disabledByTunnel: false,
    disabledByGroup: false,
  } as any);
  return true;
}

async function enableOwnedBridgeRule(ruleId: number, ownerUserId: number) {
  const rule = await db.getForwardRuleById(ruleId) as any;
  if (!rule || rule.pendingDelete) return false;
  if (positiveInteger(rule.userId) !== ownerUserId) return false;
  if (rule.isEnabled) return true;
  await db.updateForwardRule(ruleId, {
    isEnabled: true,
    isRunning: false,
    disabledByUser: false,
    disabledByTunnel: false,
    disabledByGroup: false,
  } as any);
  return true;
}

async function createOrReplaceOwnedBridge(endpoint: any, ownerUserId: number, marker: ProtocolTrafficBridgeMarker | null) {
  const config = { ...parseProtocolAccessConfig(endpoint.configJson) } as ProtocolAccessConfig;
  const protocol = endpoint.protocol as ProtocolAccessProtocol;
  const serverProtocol = managedProtocolSocketProtocol(protocol, config);
  const publicPort = positiveInteger(endpoint.publicPort);
  let listenPort = managedProtocolListenPort(config, publicPort);
  const oldRuleId = marker?.ruleId || 0;
  let publicReservation: HostPortReservation | null = null;
  let listenReservation: HostPortReservation | null = null;
  try {
    publicReservation = await reserveBridgePublicPort({ endpoint, protocol: serverProtocol, excludeRuleId: oldRuleId || undefined });
    if (!publicReservation) throw new Error(`公网端口 ${publicPort} 已被其他规则占用，无法建立协议流量计量桥接`);

    if (listenPort === publicPort) {
      listenReservation = await reserveBridgeListenPort({
        endpoint,
        protocol: serverProtocol,
        excludedPorts: [publicPort],
      });
      if (!listenReservation) throw new Error("Agent 主机没有可用的内部监听端口，无法建立协议流量计量桥接");
      listenPort = listenReservation.port;
    } else {
      listenReservation = await reserveConfiguredBridgeListenPort({
        endpoint,
        protocol: serverProtocol,
        port: listenPort,
      });
      if (!listenReservation) {
        throw new Error(`Agent 内部监听端口 ${listenPort} 已被其他规则占用，无法建立协议流量计量桥接`);
      }
    }

    if (oldRuleId > 0) {
      const oldRule = await db.getForwardRuleById(oldRuleId) as any;
      if (oldRule && !oldRule.pendingDelete) {
        await db.markForwardRulePendingDelete(oldRuleId);
      }
    }

    const ruleId = await createBridgeRule({
      endpoint,
      ownerUserId,
      listenPort,
      protocol: serverProtocol,
    });
    config.listenPort = listenPort;
    config[PROTOCOL_TRAFFIC_BRIDGE_CONFIG_KEY] = bridgeMarker({
      ruleId,
      ownerUserId,
      publicPort,
      listenPort,
    });
    const updated = await db.updateProtocolEndpoint(positiveInteger(endpoint.id), {
      forwardRuleId: ruleId,
      configJson: config,
    } as any);
    return { endpoint: updated || { ...endpoint, forwardRuleId: ruleId, configJson: JSON.stringify(config) }, changed: true };
  } finally {
    listenReservation?.release();
    publicReservation?.release();
  }
}

export async function syncManagedProtocolTrafficBridge(endpointId: number) {
  return db.withDatabaseTransaction(async () => {
    const endpoint = await db.getProtocolEndpointById(endpointId) as any;
    if (!endpoint || endpoint.runtimeMode !== "managed") return { changed: false, hostId: 0 };
    const hostId = positiveInteger(endpoint.hostId);
    const assignments = await db.listProtocolEndpointAssignments(endpointId) as any[];
    const ownerUserId = managedProtocolTrafficOwnerUserId(assignments);
    const config = parseProtocolAccessConfig(endpoint.configJson);
    const marker = protocolTrafficBridgeMarker(config);
    const owner = ownerUserId > 0 ? await db.getUserById(ownerUserId) as any : null;

    if (!endpoint.isEnabled || ownerUserId <= 0 || !userCanReceiveProtocolTraffic(owner)) {
      const changed = marker?.ruleId ? await disableOwnedBridgeRule(marker.ruleId) : false;
      return { changed, hostId };
    }

    if (endpoint.forwardRuleId) {
      const linkedRule = await db.getForwardRuleById(Number(endpoint.forwardRuleId)) as any;
      if (marker) {
        if (managedProtocolTrafficBridgeMatches({ endpoint, ownerUserId, marker, linkedRule })) {
          const wasEnabled = !!linkedRule?.isEnabled;
          const enabled = await enableOwnedBridgeRule(marker.ruleId, ownerUserId);
          if (!enabled) {
            const replacement = await createOrReplaceOwnedBridge(endpoint, ownerUserId, marker);
            return { changed: replacement.changed, hostId };
          }
          return { changed: !wasEnabled, hostId };
        }
        const replacement = await createOrReplaceOwnedBridge(endpoint, ownerUserId, marker);
        return { changed: replacement.changed, hostId };
      }
      if (!linkedRule || linkedRule.pendingDelete) {
        throw new Error("关联的 ForwardX 转发规则不存在或已删除，无法确认协议流量归属");
      }
      if (positiveInteger(linkedRule.userId) !== ownerUserId) {
        throw new Error("托管协议的关联 ForwardX 规则必须归属于该协议唯一启用用户，否则流量会记错用户");
      }
      return { changed: false, hostId };
    }

    const created = await createOrReplaceOwnedBridge(endpoint, ownerUserId, marker);
    return { changed: created.changed, hostId };
  });
}

export async function reconcileManagedProtocolTrafficBridges() {
  const endpoints = (await db.listProtocolEndpoints() as any[])
    .filter((endpoint: any) => endpoint.runtimeMode === "managed");
  const refreshHostIds = new Set<number>();
  const failures: Array<{ endpointId: number; message: string }> = [];
  let changed = 0;
  for (const endpoint of endpoints) {
    try {
      const result = await syncManagedProtocolTrafficBridge(positiveInteger(endpoint.id));
      if (result.changed) {
        changed += 1;
        if (result.hostId > 0) refreshHostIds.add(result.hostId);
      }
    } catch (error) {
      failures.push({
        endpointId: positiveInteger(endpoint.id),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  for (const hostId of refreshHostIds) {
    pushProtocolTrafficBridgeRefresh(hostId, "protocol-traffic-bridge-reconcile");
  }
  return { scanned: endpoints.length, changed, failures };
}

export async function retireManagedProtocolTrafficBridge(endpoint: any) {
  const marker = protocolTrafficBridgeMarker(endpoint?.configJson);
  const hostId = positiveInteger(endpoint?.hostId);
  if (!marker) return { changed: false, hostId };
  const rule = await db.getForwardRuleById(marker.ruleId) as any;
  if (rule && !rule.pendingDelete) {
    await db.markForwardRulePendingDelete(marker.ruleId);
  }
  return { changed: !!rule && !rule.pendingDelete, hostId };
}

export function pushProtocolTrafficBridgeRefresh(hostId: number, reason: string) {
  if (hostId > 0) pushAgentRefresh(hostId, reason);
}
