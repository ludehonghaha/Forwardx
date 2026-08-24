import { and, eq, inArray } from "drizzle-orm";
import { ACCOUNT_DISABLED_ERR_MSG, COOKIE_NAME, NOT_ADMIN_ERR_MSG, SESSION_REPLACED_ERR_MSG, UNAUTHED_ERR_MSG } from '../../shared/const';
import { parseProtocolAccessConfig } from "../../shared/protocolAccess";
import { forwardRules, protocolEndpoints } from "../../drizzle/schema";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { getSessionCookieOptions } from "./cookies";
import { runWithConfigAuditContext } from "../configAudit";
import { getDb } from "../dbRuntime";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const publicProcedure = t.procedure;

const PROTOCOL_TRAFFIC_BRIDGE_CONFIG_KEY = "_forwardxTrafficBridge";
const USER_MUTABLE_RULE_PATHS = new Set([
  "rules.update",
  "rules.delete",
  "rules.deleteBatch",
  "rules.toggle",
  "rules.resetTraffic",
]);

function positiveRuleIds(values: unknown[]) {
  return Array.from(new Set(values
    .map((value) => Math.floor(Number(value)))
    .filter((value) => Number.isInteger(value) && value > 0)));
}

function ruleIdsFromMutationInput(path: string, input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const value = input as Record<string, unknown>;
  if (path === "rules.deleteBatch") {
    return positiveRuleIds(Array.isArray(value.ids) ? value.ids : []);
  }
  if (path === "rules.resetTraffic") {
    if (String(value.scope || "") === "rule") return positiveRuleIds([value.ruleId]);
    return positiveRuleIds(Array.isArray(value.ruleIds) ? value.ruleIds : []);
  }
  return positiveRuleIds([value.id]);
}

function isResetAllVisibleTraffic(path: string, input: unknown, ruleIds: number[]) {
  if (path !== "rules.resetTraffic" || ruleIds.length > 0) return false;
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  return String((input as Record<string, unknown>).scope || "") === "all";
}

function endpointOwnsManagedTrafficBridgeRule(endpoint: { forwardRuleId: unknown; configJson: unknown }, ruleIds?: Set<number>) {
  const linkedRuleId = Math.floor(Number(endpoint.forwardRuleId));
  if (!Number.isInteger(linkedRuleId) || linkedRuleId <= 0) return false;
  if (ruleIds && !ruleIds.has(linkedRuleId)) return false;
  const config = parseProtocolAccessConfig(endpoint.configJson);
  const raw = config[PROTOCOL_TRAFFIC_BRIDGE_CONFIG_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const marker = raw as Record<string, unknown>;
  return marker.managed === true
    && Number(marker.version) === 1
    && Math.floor(Number(marker.ruleId)) === linkedRuleId;
}

async function assertUserRuleMutationAllowed(path: string, input: unknown, userId: number) {
  if (!USER_MUTABLE_RULE_PATHS.has(path)) return;
  const ruleIds = ruleIdsFromMutationInput(path, input);
  const resetAll = isResetAllVisibleTraffic(path, input, ruleIds);
  if (ruleIds.length === 0 && !resetAll) return;
  const db = await getDb();
  if (!db) return;
  const conditions: any[] = [
    eq(protocolEndpoints.runtimeMode, "managed"),
    eq(forwardRules.userId, userId),
  ];
  if (!resetAll) conditions.push(inArray(protocolEndpoints.forwardRuleId, ruleIds));
  const rows = await db.select({
    forwardRuleId: protocolEndpoints.forwardRuleId,
    configJson: protocolEndpoints.configJson,
  }).from(protocolEndpoints)
    .innerJoin(forwardRules, eq(forwardRules.id, protocolEndpoints.forwardRuleId))
    .where(and(...conditions));
  const requested = resetAll ? undefined : new Set(ruleIds);
  if (!rows.some((row: any) => endpointOwnsManagedTrafficBridgeRule(row, requested))) return;
  throw new TRPCError({
    code: "FORBIDDEN",
    message: path === "rules.resetTraffic"
      ? "系统托管协议流量属于用户计费账本，不能从规则流量重置中清除"
      : "这是系统托管协议流量桥接规则，请在协议接入中管理",
  });
}

const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ctx.authFailureReason === "session_replaced"
        ? SESSION_REPLACED_ERR_MSG
        : ctx.authFailureReason === "account_disabled" ? ACCOUNT_DISABLED_ERR_MSG : UNAUTHED_ERR_MSG,
    });
  }
  if ((ctx.user as any).accountEnabled === false) {
    ctx.res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(ctx.req), maxAge: -1 });
    throw new TRPCError({ code: "UNAUTHORIZED", message: ACCOUNT_DISABLED_ERR_MSG });
  }
  if (ctx.user.role !== "admin" && USER_MUTABLE_RULE_PATHS.has(opts.path)) {
    await assertUserRuleMutationAllowed(opts.path, await opts.getRawInput(), Number(ctx.user.id));
  }

  return runWithConfigAuditContext({
    actorUserId: Number(ctx.user.id),
    actorName: String(ctx.user.username || ctx.user.name || ""),
    source: "panel:trpc",
    requestId: String(ctx.req.headers["x-request-id"] || "") || undefined,
    requestPath: opts.path,
  }, () => next({ ctx: { ...ctx, user: ctx.user } }));
});

export const protectedProcedure = t.procedure.use(requireUser);

export const adminProcedure = t.procedure.use(
  t.middleware(async opts => {
    const { ctx, next } = opts;

    if (!ctx.user) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: ctx.authFailureReason === "session_replaced"
          ? SESSION_REPLACED_ERR_MSG
          : ctx.authFailureReason === "account_disabled" ? ACCOUNT_DISABLED_ERR_MSG : UNAUTHED_ERR_MSG,
      });
    }
    if ((ctx.user as any).accountEnabled === false) {
      ctx.res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(ctx.req), maxAge: -1 });
      throw new TRPCError({ code: "UNAUTHORIZED", message: ACCOUNT_DISABLED_ERR_MSG });
    }
    if (ctx.user.role !== 'admin') {
      throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }

    return runWithConfigAuditContext({
      actorUserId: Number(ctx.user.id),
      actorName: String(ctx.user.username || ctx.user.name || ""),
      source: "panel:trpc",
      requestId: String(ctx.req.headers["x-request-id"] || "") || undefined,
      requestPath: opts.path,
    }, () => next({ ctx: { ...ctx, user: ctx.user } }));
  }),
);
