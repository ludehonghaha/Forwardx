import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import {
  isManagedShadowsocksCipher,
  managedProtocolListenPort,
  managedProtocolSocketProtocol,
  parseProtocolAccessConfig,
  protocolConfigSecret,
  protocolConfigText,
  validateProtocolEndpointConfig,
  validateProtocolFeedEntry,
  type ProtocolAccessProtocol,
} from "../../shared/protocolAccess";
import { ensureAdminOrSelf } from "./helpers";
import { reserveSpecificHostPort, type HostPortReservation } from "../portReservations";
import { reserveManagedProtocolPort } from "../protocolManagedPort";
import { latestHostProtocolAccessRevision } from "../configAudit";
import { getAgentLocalRuntimeStateSnapshot } from "../agentHeartbeatRoute";
import { projectProtocolEndpointRuntimeStatus } from "../protocolRuntimeStatus";
import {
  protocolTrafficBridgeMarker,
  pushProtocolTrafficBridgeRefresh,
  retireManagedProtocolTrafficBridge,
  syncManagedProtocolTrafficBridge,
  withoutProtocolTrafficBridgeMarker,
} from "../protocolTrafficBridge";

const protocolSchema = z.enum(["shadowsocks", "shadowsocks_ssh", "mieru", "snell", "vless_reality", "hysteria2"]);
const runtimeModeSchema = z.enum(["external", "managed"]);
const configSchema = z.record(z.unknown());

const endpointCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  protocol: protocolSchema,
  runtimeMode: runtimeModeSchema.default("external"),
  hostId: z.number().int().positive().nullable().optional(),
  forwardRuleId: z.number().int().positive().nullable().optional(),
  publicHost: z.string().trim().min(1).max(253),
  publicPort: z.number().int().min(1).max(65535).nullable().optional(),
  autoPort: z.boolean().optional().default(false),
  config: configSchema,
  isEnabled: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
});

function randomProtocolSecret() {
  return randomBytes(24).toString("base64url");
}

function realityKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  const privateJwk = privateKey.export({ format: "jwk" }) as { d?: string; x?: string };
  const publicJwk = publicKey.export({ format: "jwk" }) as { d?: string; x?: string };
  if (!privateJwk.d || !publicJwk.x) throw new Error("Reality X25519 密钥生成失败");
  return { privateKey: privateJwk.d, publicKey: publicJwk.x };
}

function provisionManagedProtocolConfig(
  protocol: ProtocolAccessProtocol,
  runtimeMode: "external" | "managed",
  rawConfig: Record<string, unknown>,
) {
  const config = { ...rawConfig };
  if (runtimeMode !== "managed") return withoutProtocolTrafficBridgeMarker(config);
  if (protocol === "snell") {
    if (!protocolConfigSecret(config, "password")) config.password = randomProtocolSecret();
    if (!Number.isInteger(Number(config.version))) config.version = 5;
    if (typeof config.udp !== "boolean") config.udp = true;
  }
  if (protocol === "vless_reality") {
    if (!protocolConfigText(config, "uuid")) config.uuid = randomUUID();
    if (!protocolConfigText(config, "serverName")) config.serverName = "www.cloudflare.com";
    if (!protocolConfigText(config, "realityDest")) config.realityDest = `${protocolConfigText(config, "serverName")}:443`;
    if (!protocolConfigText(config, "shortId")) config.shortId = randomBytes(8).toString("hex");
    if (!protocolConfigText(config, "clientFingerprint")) config.clientFingerprint = "chrome";
    if (typeof config.udp !== "boolean") config.udp = true;
    if (!protocolConfigSecret(config, "realityPrivateKey") || !protocolConfigText(config, "realityPublicKey")) {
      const keys = realityKeyPair();
      config.realityPrivateKey = keys.privateKey;
      config.realityPublicKey = keys.publicKey;
    }
  }
  if (protocol === "hysteria2") {
    if (!protocolConfigSecret(config, "password")) config.password = randomProtocolSecret();
    if (!protocolConfigText(config, "sni")) config.sni = "www.cloudflare.com";
    if (typeof config.insecure !== "boolean") config.insecure = true;
    if (!protocolConfigText(config, "obfsMode")) config.obfsMode = "salamander";
    if (config.obfsMode === "salamander" && !protocolConfigSecret(config, "obfsPassword")) {
      config.obfsPassword = randomProtocolSecret();
    }
  }
  return config;
}

async function validateEndpoint(input: {
  id?: number;
  protocol: ProtocolAccessProtocol;
  runtimeMode: "external" | "managed";
  hostId?: number | null;
  forwardRuleId?: number | null;
  publicHost: string;
  publicPort: number;
  config: Record<string, unknown>;
  isEnabled: boolean;
  preReservation?: HostPortReservation | null;
}) {
  if (!Number.isInteger(input.publicPort) || input.publicPort < 1 || input.publicPort > 65535) {
    throw new Error("公网端口必须是 1-65535");
  }
  if (/\s|:\/\//.test(input.publicHost)) {
    throw new Error("publicHost 只能填写域名或 IP，不能包含协议头或空格");
  }
  const errors = validateProtocolEndpointConfig(input.protocol, input.config);
  if (errors.length > 0) throw new Error(errors.join("；"));
  if (input.runtimeMode === "external") {
    return { hostId: null, forwardRuleId: null, reservation: null as HostPortReservation | null };
  }
  if (input.protocol === "shadowsocks_ssh") {
    throw new Error("Agent 托管不支持 SS over SSH");
  }
  const hostId = Number(input.hostId || 0);
  if (!Number.isInteger(hostId) || hostId <= 0 || !await db.getHostById(hostId)) {
    throw new Error("请选择有效的 ForwardX Agent 主机");
  }
  if (input.protocol === "shadowsocks") {
    const cipher = String(input.config.cipher || "").trim();
    if (!isManagedShadowsocksCipher(cipher)) {
      throw new Error("Agent 托管仅支持 chacha20-ietf-poly1305、aes-256-gcm 或 aes-128-gcm");
    }
    if (!protocolConfigSecret(input.config, "password")) throw new Error("Agent 托管端点必须设置共享 SS 密码");
  } else if (input.protocol === "mieru") {
    if (!protocolConfigText(input.config, "username") || !protocolConfigSecret(input.config, "password")) {
      throw new Error("Agent 托管 Mieru 必须设置共享用户名和密码");
    }
    if (input.isEnabled) {
      const duplicate = (await db.listManagedProtocolEndpointsForHost(hostId) as any[])
        .some((endpoint: any) => endpoint.protocol === "mieru" && endpoint.isEnabled !== false && Number(endpoint.id) !== Number(input.id || 0));
      if (duplicate) throw new Error("同一 Agent 主机只能启用一个托管 Mieru 端点");
    }
  } else if (input.protocol === "snell") {
    if (!protocolConfigSecret(input.config, "password")) throw new Error("托管 Snell 必须设置 PSK");
  } else if (input.protocol === "vless_reality") {
    if (!protocolConfigSecret(input.config, "realityPrivateKey")) throw new Error("托管 Reality 缺少服务端私钥");
  } else if (input.protocol === "hysteria2") {
    if (!protocolConfigSecret(input.config, "password")) throw new Error("托管 Hysteria2 必须设置密码");
  }

  const listenPort = managedProtocolListenPort(input.config, input.publicPort);
  if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
    throw new Error("Agent 监听端口必须是 1-65535");
  }
  const serverProtocol = managedProtocolSocketProtocol(input.protocol, input.config);
  const forwardRuleId = Number(input.forwardRuleId || 0) || null;
  if (!forwardRuleId && listenPort !== input.publicPort) {
    throw new Error("监听端口与公网端口不同时，必须关联现有 ForwardX 转发规则");
  }
  if (forwardRuleId) {
    const rule = await db.getForwardRuleById(forwardRuleId) as any;
    const managedBridge = protocolTrafficBridgeMarker(input.config);
    const managedBridgeRule = !!managedBridge && managedBridge.ruleId === forwardRuleId;
    if (!rule || rule.pendingDelete || (!rule.isEnabled && !managedBridgeRule)) {
      throw new Error("关联的 ForwardX 转发规则不存在或未启用");
    }
    if (Number(rule.sourcePort) !== input.publicPort || Number(rule.targetPort) !== listenPort) {
      throw new Error("关联规则的源端口必须等于公网端口，目标端口必须等于 Agent 监听端口");
    }
    const ruleProtocol = String(rule.protocol || "tcp");
    if (serverProtocol === "both" && ruleProtocol !== "both") throw new Error("关联规则必须转发 TCP+UDP");
    if (serverProtocol === "tcp" && ruleProtocol !== "tcp" && ruleProtocol !== "both") throw new Error("关联规则必须包含 TCP 转发");
    if (serverProtocol === "udp" && ruleProtocol !== "udp" && ruleProtocol !== "both") throw new Error("关联规则必须包含 UDP 转发");
  }
  if (input.preReservation) {
    if (input.preReservation.hostId !== hostId || input.preReservation.port !== listenPort || input.preReservation.protocol !== serverProtocol) {
      throw new Error("自动分配端口预约与端点配置不一致");
    }
    return { hostId, forwardRuleId, reservation: input.preReservation };
  }
  if (!input.isEnabled) return { hostId, forwardRuleId, reservation: null as HostPortReservation | null };
  const reservation = await reserveSpecificHostPort({
    hostId,
    port: listenPort,
    protocol: serverProtocol,
    isUsed: () => db.isPortUsedOnHost(hostId, listenPort, undefined, serverProtocol, undefined, true, input.id),
  });
  if (!reservation) throw new Error(`Agent 主机端口 ${listenPort} 已被占用或正在分配`);
  return { hostId, forwardRuleId, reservation };
}

export const protocolAccessRouter = router({
  listEndpoints: adminProcedure.query(async () => {
    const endpoints = await db.listProtocolEndpoints();
    const hostIds = Array.from(new Set<number>(endpoints
      .filter((endpoint: any) => endpoint.runtimeMode === "managed")
      .map((endpoint: any) => Number(endpoint.hostId || 0))
      .filter((hostId: number) => hostId > 0)));
    const hostEntries = await Promise.all(hostIds.map(async (hostId) => {
      const [host, hostRevision] = await Promise.all([
        db.getHostById(hostId),
        latestHostProtocolAccessRevision(hostId),
      ]);
      return [hostId, { host, hostRevision, snapshot: getAgentLocalRuntimeStateSnapshot(hostId) }] as const;
    }));
    const runtimeByHostId = new Map(hostEntries);
    return endpoints.map((endpoint: any) => {
      const runtime = runtimeByHostId.get(Number(endpoint.hostId || 0));
      return {
        ...endpoint,
        runtimeStatus: projectProtocolEndpointRuntimeStatus({
          endpoint,
          host: runtime?.host,
          hostProtocolRevision: Number(runtime?.hostRevision || 0),
          localState: runtime?.snapshot?.state,
          localStateUpdatedAt: runtime?.snapshot?.updatedAt,
        }),
      };
    });
  }),

  createEndpoint: adminProcedure.input(endpointCreateSchema).mutation(async ({ ctx, input }) => {
    const config = provisionManagedProtocolConfig(input.protocol, input.runtimeMode, input.config);
    let publicPort = Number(input.publicPort || 0);
    let reservation: HostPortReservation | null = null;
    try {
      if (input.autoPort) {
        if (input.runtimeMode !== "managed") throw new Error("自动分配端口仅支持 Agent 托管端点");
        if (input.forwardRuleId) throw new Error("关联现有 ForwardX 规则时不能自动分配端口");
        const hostId = Number(input.hostId || 0);
        if (!Number.isInteger(hostId) || hostId <= 0 || !await db.getHostById(hostId)) {
          throw new Error("请选择有效的 ForwardX Agent 主机");
        }
        const serverProtocol = managedProtocolSocketProtocol(input.protocol, config);
        const runtimeState = getAgentLocalRuntimeStateSnapshot(hostId)?.state;
        const runtimePorts = (runtimeState?.listeners || [])
          .filter((listener) => listener.ready)
          .map((listener) => Number(listener.port || 0))
          .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
        reservation = await reserveManagedProtocolPort({
          hostId,
          protocol: serverProtocol,
          excludedPorts: runtimePorts,
          findAvailablePort: (excludedPorts) => db.findAvailablePort(
            hostId,
            undefined,
            undefined,
            serverProtocol,
            excludedPorts,
            [],
            [],
          ),
          isPortUsed: (port) => db.isPortUsedOnHost(
            hostId,
            port,
            undefined,
            serverProtocol,
            undefined,
            true,
          ),
        });
        if (!reservation) throw new Error("该 Agent 主机端口区间内已无可用端口");
        publicPort = reservation.port;
        config.listenPort = reservation.port;
      }
      if (!publicPort) throw new Error("请填写公网端口，或开启自动分配端口");
      const validated = await validateEndpoint({ ...input, publicPort, config, preReservation: reservation });
      reservation = validated.reservation;
      return await db.createProtocolEndpoint({
        name: input.name,
        protocol: input.protocol,
        runtimeMode: input.runtimeMode,
        hostId: validated.hostId,
        forwardRuleId: validated.forwardRuleId,
        publicHost: input.publicHost,
        publicPort,
        configJson: config,
        isEnabled: input.isEnabled,
        sortOrder: input.sortOrder,
        createdByUserId: ctx.user.id,
      } as any);
    } finally {
      reservation?.release();
    }
  }),

  updateEndpoint: adminProcedure.input(endpointCreateSchema.partial().extend({
    id: z.number().int().positive(),
  })).mutation(async ({ input }) => {
    const current = await db.getProtocolEndpointById(input.id);
    if (!current) throw new Error("协议接入端点不存在");
    if (input.autoPort) throw new Error("自动分配端口仅用于新建托管端点；编辑时请保留现有端口或手动修改");
    const protocol = (input.protocol || current.protocol) as ProtocolAccessProtocol;
    const runtimeMode = input.runtimeMode || current.runtimeMode as "external" | "managed";
    const publicHost = input.publicHost || current.publicHost;
    const publicPort = input.publicPort || current.publicPort;
    const rawConfig = input.config || parseProtocolAccessConfig(current.configJson);
    const config = provisionManagedProtocolConfig(protocol, runtimeMode, rawConfig);
    const hostId = input.hostId === undefined ? current.hostId : input.hostId;
    const forwardRuleId = runtimeMode === "external"
      ? null
      : input.forwardRuleId === undefined ? current.forwardRuleId : input.forwardRuleId;
    const isEnabled = input.isEnabled === undefined ? current.isEnabled : input.isEnabled;
    if (current.runtimeMode === "managed" && runtimeMode === "managed"
      && Number(current.hostId || 0) !== Number(hostId || 0)) {
      throw new Error("托管端点不能直接迁移主机；请先改为 external，确认旧监听已移除后再启用新主机");
    }
    if (runtimeMode === "managed") {
      const assignments = await db.listProtocolEndpointAssignments(current.id);
      if (assignments.some((item: any) => {
        const credential = parseProtocolAccessConfig(item.access?.credentialJson);
        return protocolConfigSecret(credential, "password") || protocolConfigText(credential, "username");
      })) {
        throw new Error("托管端点只支持共享凭据；请先清除已有用户的独立用户名或密码");
      }
    }
    const validated = await validateEndpoint({
      id: current.id,
      protocol,
      runtimeMode,
      hostId,
      forwardRuleId,
      publicHost,
      publicPort,
      config,
      isEnabled,
    });
    const { id, config: _config, autoPort: _autoPort, ...patch } = input;
    let refreshHostId = 0;
    try {
      const updated = await db.withDatabaseTransaction(async () => {
        if (current.runtimeMode === "managed" && runtimeMode === "external") {
          const retired = await retireManagedProtocolTrafficBridge(current);
          refreshHostId = retired.hostId;
        }
        await db.updateProtocolEndpoint(id, {
          ...patch,
          hostId: validated.hostId,
          forwardRuleId: validated.forwardRuleId,
          configJson: config,
        } as any);
        if (runtimeMode === "managed") {
          const synced = await syncManagedProtocolTrafficBridge(id);
          if (synced.changed) refreshHostId = synced.hostId;
        }
        return db.getProtocolEndpointById(id);
      });
      if (refreshHostId > 0) pushProtocolTrafficBridgeRefresh(refreshHostId, "protocol-traffic-bridge-endpoint-updated");
      return updated;
    } finally {
      validated.reservation?.release();
    }
  }),

  deleteEndpoint: adminProcedure.input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const endpoint = await db.getProtocolEndpointById(input.id);
      if (!endpoint) return false;
      let refreshHostId = 0;
      const deleted = await db.withDatabaseTransaction(async () => {
        const retired = await retireManagedProtocolTrafficBridge(endpoint);
        if (retired.changed) refreshHostId = retired.hostId;
        return db.deleteProtocolEndpoint(input.id);
      });
      if (refreshHostId > 0) pushProtocolTrafficBridgeRefresh(refreshHostId, "protocol-traffic-bridge-endpoint-deleted");
      return deleted;
    }),

  listAssignments: adminProcedure.input(z.object({ endpointId: z.number().int().positive() }))
    .query(({ input }) => db.listProtocolEndpointAssignments(input.endpointId)),

  setAssignment: adminProcedure.input(z.object({
    endpointId: z.number().int().positive(),
    userId: z.number().int().positive(),
    credential: configSchema.default({}),
    isEnabled: z.boolean().default(true),
  })).mutation(async ({ input }) => {
    const endpoint = await db.getProtocolEndpointById(input.endpointId);
    if (!endpoint) throw new Error("协议接入端点不存在");
    if (endpoint.runtimeMode === "managed" && (
      protocolConfigSecret(input.credential, "password") || protocolConfigText(input.credential, "username")
    )) {
      throw new Error("Agent 托管端点使用单一共享凭据，用户分配不能覆盖运行时用户名或密码");
    }
    const errors = validateProtocolFeedEntry({
      assignmentId: 1,
      endpointId: endpoint.id,
      name: endpoint.name,
      protocol: endpoint.protocol as ProtocolAccessProtocol,
      publicHost: endpoint.publicHost,
      publicPort: endpoint.publicPort,
      endpointConfig: parseProtocolAccessConfig(endpoint.configJson),
      credential: input.credential,
    });
    if (errors.length > 0) throw new Error(errors.join("；"));
    let refreshHostId = 0;
    const id = await db.withDatabaseTransaction(async () => {
      const assignmentId = await db.setProtocolUserAccess(input);
      await db.ensureProtocolFeedToken(input.userId);
      const synced = await syncManagedProtocolTrafficBridge(input.endpointId);
      if (synced.changed) refreshHostId = synced.hostId;
      return assignmentId;
    });
    if (refreshHostId > 0) pushProtocolTrafficBridgeRefresh(refreshHostId, "protocol-traffic-bridge-assignment-updated");
    return { id };
  }),

  removeAssignment: adminProcedure.input(z.object({
    endpointId: z.number().int().positive(),
    userId: z.number().int().positive(),
  })).mutation(async ({ input }) => {
    let refreshHostId = 0;
    await db.withDatabaseTransaction(async () => {
      await db.removeProtocolUserAccess(input.endpointId, input.userId);
      const synced = await syncManagedProtocolTrafficBridge(input.endpointId);
      if (synced.changed) refreshHostId = synced.hostId;
    });
    if (refreshHostId > 0) pushProtocolTrafficBridgeRefresh(refreshHostId, "protocol-traffic-bridge-assignment-removed");
    return { success: true };
  }),

  feedForUser: protectedProcedure.input(z.object({ userId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      ensureAdminOrSelf(ctx, input.userId);
      const token = await db.ensureProtocolFeedToken(input.userId);
      return {
        token: token.token,
        enabled: token.isEnabled,
        uriPath: `/api/v1/access-feed/${token.token}`,
        mihomoPath: `/api/v1/access-feed/${token.token}/mihomo`,
      };
    }),

  rotateFeedToken: protectedProcedure.input(z.object({ userId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      ensureAdminOrSelf(ctx, input.userId);
      const token = await db.rotateProtocolFeedToken(input.userId);
      if (!token) throw new Error("订阅 Token 轮换失败");
      return {
        token: token.token,
        uriPath: `/api/v1/access-feed/${token.token}`,
        mihomoPath: `/api/v1/access-feed/${token.token}/mihomo`,
      };
    }),
});