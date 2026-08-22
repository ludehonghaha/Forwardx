import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import {
  isManagedShadowsocksCipher,
  managedProtocolListenPort,
  parseProtocolAccessConfig,
  protocolConfigBool,
  protocolConfigSecret,
  validateProtocolEndpointConfig,
  validateProtocolFeedEntry,
  type ProtocolAccessProtocol,
} from "../../shared/protocolAccess";
import { ensureAdminOrSelf } from "./helpers";
import { reserveSpecificHostPort, type HostPortReservation } from "../portReservations";
import { latestHostProtocolAccessRevision } from "../configAudit";
import { getAgentLocalRuntimeStateSnapshot } from "../agentHeartbeatRoute";
import { projectProtocolEndpointRuntimeStatus } from "../protocolRuntimeStatus";

const protocolSchema = z.enum(["shadowsocks", "shadowsocks_ssh", "mieru"]);
const runtimeModeSchema = z.enum(["external", "managed"]);
const configSchema = z.record(z.unknown());

const endpointCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  protocol: protocolSchema,
  runtimeMode: runtimeModeSchema.default("external"),
  hostId: z.number().int().positive().nullable().optional(),
  forwardRuleId: z.number().int().positive().nullable().optional(),
  publicHost: z.string().trim().min(1).max(253),
  publicPort: z.number().int().min(1).max(65535),
  config: configSchema,
  isEnabled: z.boolean().default(false),
  sortOrder: z.number().int().min(0).default(0),
});

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
}) {
  if (/\s|:\/\//.test(input.publicHost)) {
    throw new Error("publicHost 只能填写域名或 IP，不能包含协议头或空格");
  }
  const errors = validateProtocolEndpointConfig(input.protocol, input.config);
  if (errors.length > 0) throw new Error(errors.join("；"));
  if (input.runtimeMode === "external") {
    return { hostId: null, forwardRuleId: null, reservation: null as HostPortReservation | null };
  }
  if (input.protocol !== "shadowsocks") {
    throw new Error("Agent 托管当前只支持标准 Shadowsocks；SS over SSH 和 Mieru 请使用 external 模式");
  }
  const hostId = Number(input.hostId || 0);
  if (!Number.isInteger(hostId) || hostId <= 0 || !await db.getHostById(hostId)) {
    throw new Error("请选择有效的 ForwardX Agent 主机");
  }
  const cipher = String(input.config.cipher || "").trim();
  if (!isManagedShadowsocksCipher(cipher)) {
    throw new Error("Agent 托管仅支持 chacha20-ietf-poly1305、aes-256-gcm 或 aes-128-gcm");
  }
  if (!protocolConfigSecret(input.config, "password")) {
    throw new Error("Agent 托管端点必须设置共享 SS 密码");
  }
  const listenPort = managedProtocolListenPort(input.config, input.publicPort);
  if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
    throw new Error("Agent 监听端口必须是 1-65535");
  }
  const forwardRuleId = Number(input.forwardRuleId || 0) || null;
  if (!forwardRuleId && listenPort !== input.publicPort) {
    throw new Error("监听端口与公网端口不同时，必须关联现有 ForwardX 转发规则");
  }
  if (forwardRuleId) {
    const rule = await db.getForwardRuleById(forwardRuleId) as any;
    if (!rule || !rule.isEnabled || rule.pendingDelete) throw new Error("关联的 ForwardX 转发规则不存在或未启用");
    if (Number(rule.sourcePort) !== input.publicPort || Number(rule.targetPort) !== listenPort) {
      throw new Error("关联规则的源端口必须等于公网端口，目标端口必须等于 Agent 监听端口");
    }
    const ruleProtocol = String(rule.protocol || "tcp");
    const udp = protocolConfigBool(input.config, "udp", false);
    if ((udp && ruleProtocol !== "both") || (!udp && ruleProtocol !== "tcp" && ruleProtocol !== "both")) {
      throw new Error(udp ? "开启 UDP 时关联规则必须转发 TCP+UDP" : "关联规则必须包含 TCP 转发");
    }
  }
  if (!input.isEnabled) return { hostId, forwardRuleId, reservation: null as HostPortReservation | null };
  const reservation = await reserveSpecificHostPort({
    hostId,
    port: listenPort,
    protocol: protocolConfigBool(input.config, "udp", false) ? "both" : "tcp",
    isUsed: () => db.isPortUsedOnHost(
      hostId,
      listenPort,
      undefined,
      protocolConfigBool(input.config, "udp", false) ? "both" : "tcp",
      undefined,
      true,
      input.id,
    ),
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
      const [host, revision] = await Promise.all([
        db.getHostById(hostId),
        latestHostProtocolAccessRevision(hostId),
      ]);
      return [hostId, { host, revision, snapshot: getAgentLocalRuntimeStateSnapshot(hostId) }] as const;
    }));
    const runtimeByHostId = new Map(hostEntries);
    return endpoints.map((endpoint: any) => {
      const runtime = runtimeByHostId.get(Number(endpoint.hostId || 0));
      return {
        ...endpoint,
        runtimeStatus: projectProtocolEndpointRuntimeStatus({
          endpoint,
          host: runtime?.host,
          hostProtocolRevision: Number(runtime?.revision || 0),
          localState: runtime?.snapshot?.state,
          localStateUpdatedAt: runtime?.snapshot?.updatedAt,
        }),
      };
    });
  }),

  createEndpoint: adminProcedure.input(endpointCreateSchema).mutation(async ({ ctx, input }) => {
    const validated = await validateEndpoint(input);
    try {
      return await db.createProtocolEndpoint({
        name: input.name,
        protocol: input.protocol,
        runtimeMode: input.runtimeMode,
        hostId: validated.hostId,
        forwardRuleId: validated.forwardRuleId,
        publicHost: input.publicHost,
        publicPort: input.publicPort,
        configJson: input.config,
        isEnabled: input.isEnabled,
        sortOrder: input.sortOrder,
        createdByUserId: ctx.user.id,
      } as any);
    } finally {
      validated.reservation?.release();
    }
  }),

  updateEndpoint: adminProcedure.input(endpointCreateSchema.partial().extend({
    id: z.number().int().positive(),
  })).mutation(async ({ input }) => {
    const current = await db.getProtocolEndpointById(input.id);
    if (!current) throw new Error("协议接入端点不存在");
    const protocol = (input.protocol || current.protocol) as ProtocolAccessProtocol;
    const runtimeMode = input.runtimeMode || current.runtimeMode as "external" | "managed";
    const publicHost = input.publicHost || current.publicHost;
    const publicPort = input.publicPort || current.publicPort;
    const config = input.config || parseProtocolAccessConfig(current.configJson);
    const hostId = input.hostId === undefined ? current.hostId : input.hostId;
    const forwardRuleId = input.forwardRuleId === undefined ? current.forwardRuleId : input.forwardRuleId;
    const isEnabled = input.isEnabled === undefined ? current.isEnabled : input.isEnabled;
    if (current.runtimeMode === "managed" && runtimeMode === "managed"
      && Number(current.hostId || 0) !== Number(hostId || 0)) {
      throw new Error("托管端点不能直接迁移主机；请先改为 external，确认旧监听已移除后再启用新主机");
    }
    if (runtimeMode === "managed") {
      const assignments = await db.listProtocolEndpointAssignments(current.id);
      if (assignments.some((item: any) => protocolConfigSecret(parseProtocolAccessConfig(item.access?.credentialJson), "password"))) {
        throw new Error("托管端点只支持共享密码；请先清除已有用户的独立密码");
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
    const { id, config: _config, ...patch } = input;
    try {
      return await db.updateProtocolEndpoint(id, {
        ...patch,
        hostId: validated.hostId,
        forwardRuleId: validated.forwardRuleId,
        ...(input.config ? { configJson: input.config } : {}),
      } as any);
    } finally {
      validated.reservation?.release();
    }
  }),

  deleteEndpoint: adminProcedure.input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => db.deleteProtocolEndpoint(input.id)),

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
    if (endpoint.runtimeMode === "managed" && protocolConfigSecret(input.credential, "password")) {
      throw new Error("Agent 托管端点使用单一共享密码，用户分配不能覆盖运行时密码");
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
    const id = await db.setProtocolUserAccess(input);
    await db.ensureProtocolFeedToken(input.userId);
    return { id };
  }),

  removeAssignment: adminProcedure.input(z.object({
    endpointId: z.number().int().positive(),
    userId: z.number().int().positive(),
  })).mutation(async ({ input }) => {
    await db.removeProtocolUserAccess(input.endpointId, input.userId);
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
