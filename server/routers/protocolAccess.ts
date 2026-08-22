import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import {
  parseProtocolAccessConfig,
  validateProtocolEndpointConfig,
  validateProtocolFeedEntry,
  type ProtocolAccessProtocol,
} from "../../shared/protocolAccess";
import { ensureAdminOrSelf } from "./helpers";

const protocolSchema = z.enum(["shadowsocks", "shadowsocks_ssh"]);
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

function validateExternalEndpoint(input: {
  protocol: ProtocolAccessProtocol;
  runtimeMode: "external" | "managed";
  publicHost: string;
  config: Record<string, unknown>;
}) {
  if (input.runtimeMode !== "external") {
    throw new Error("托管协议运行时尚未开放；当前阶段只允许登记 external 端点");
  }
  if (/\s|:\/\//.test(input.publicHost)) {
    throw new Error("publicHost 只能填写域名或 IP，不能包含协议头或空格");
  }
  const errors = validateProtocolEndpointConfig(input.protocol, input.config);
  if (errors.length > 0) throw new Error(errors.join("；"));
}

export const protocolAccessRouter = router({
  listEndpoints: adminProcedure.query(() => db.listProtocolEndpoints()),

  createEndpoint: adminProcedure.input(endpointCreateSchema).mutation(async ({ ctx, input }) => {
    validateExternalEndpoint(input);
    return db.createProtocolEndpoint({
      name: input.name,
      protocol: input.protocol,
      runtimeMode: input.runtimeMode,
      hostId: null,
      forwardRuleId: null,
      publicHost: input.publicHost,
      publicPort: input.publicPort,
      configJson: input.config,
      isEnabled: input.isEnabled,
      sortOrder: input.sortOrder,
      createdByUserId: ctx.user.id,
    } as any);
  }),

  updateEndpoint: adminProcedure.input(endpointCreateSchema.partial().extend({
    id: z.number().int().positive(),
  })).mutation(async ({ input }) => {
    const current = await db.getProtocolEndpointById(input.id);
    if (!current) throw new Error("协议接入端点不存在");
    const protocol = (input.protocol || current.protocol) as ProtocolAccessProtocol;
    const runtimeMode = input.runtimeMode || current.runtimeMode as "external" | "managed";
    const publicHost = input.publicHost || current.publicHost;
    const config = input.config || parseProtocolAccessConfig(current.configJson);
    validateExternalEndpoint({ protocol, runtimeMode, publicHost, config });
    const { id, config: _config, ...patch } = input;
    return db.updateProtocolEndpoint(id, {
      ...patch,
      hostId: null,
      forwardRuleId: null,
      ...(input.config ? { configJson: input.config } : {}),
    } as any);
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
