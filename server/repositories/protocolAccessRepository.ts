import { randomBytes } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  protocolEndpoints,
  protocolFeedTokens,
  protocolUserAccess,
  users,
  type InsertProtocolEndpoint,
} from "../../drizzle/schema";
import {
  PROTOCOL_ACCESS_PROTOCOLS,
  parseProtocolAccessConfig,
  type ProtocolAccessProtocol,
  type ProtocolFeedEntry,
} from "../../shared/protocolAccess";
import { recordConfigAuditEvent } from "../configAudit";
import { getDb, insertAndGetId, nowDate, withDatabaseTransaction } from "../dbRuntime";

function stringifyConfig(value: unknown) {
  return JSON.stringify(parseProtocolAccessConfig(value));
}

function isProtocol(value: unknown): value is ProtocolAccessProtocol {
  return (PROTOCOL_ACCESS_PROTOCOLS as readonly string[]).includes(String(value || ""));
}

function protocolEndpointAuditSnapshot(row: any) {
  if (!row) return row;
  const { configJson, ...rest } = row;
  return { ...rest, config: parseProtocolAccessConfig(configJson) };
}

export async function getProtocolEndpointById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(protocolEndpoints).where(eq(protocolEndpoints.id, id)).limit(1);
  return rows[0];
}

export async function listProtocolEndpoints() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(protocolEndpoints).orderBy(asc(protocolEndpoints.sortOrder), asc(protocolEndpoints.id));
}

export async function listManagedProtocolEndpointsForHost(hostId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(protocolEndpoints).where(and(
    eq(protocolEndpoints.hostId, hostId),
    eq(protocolEndpoints.runtimeMode, "managed"),
    eq(protocolEndpoints.isEnabled, true),
  )).orderBy(asc(protocolEndpoints.id));
}

export async function createProtocolEndpoint(data: Omit<InsertProtocolEndpoint, "configJson"> & { configJson: unknown }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const payload = { ...data, configJson: stringifyConfig(data.configJson) } as any;
  const id = await insertAndGetId("protocol_endpoints", payload);
  const created = await getProtocolEndpointById(id);
  await recordConfigAuditEvent({
    resourceType: "protocol_endpoint",
    resourceId: id,
    hostId: Number(created?.hostId || 0) || null,
    action: "create",
    after: protocolEndpointAuditSnapshot(created),
  });
  return created;
}

export async function updateProtocolEndpoint(
  id: number,
  data: Partial<Omit<InsertProtocolEndpoint, "configJson">> & { configJson?: unknown },
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const before = await getProtocolEndpointById(id);
  if (!before) throw new Error("协议接入端点不存在");
  const payload: Record<string, unknown> = { ...data, updatedAt: nowDate() };
  if (data.configJson !== undefined) payload.configJson = stringifyConfig(data.configJson);
  await db.update(protocolEndpoints).set(payload as any).where(eq(protocolEndpoints.id, id));
  const updated = await getProtocolEndpointById(id);
  await recordConfigAuditEvent({
    resourceType: "protocol_endpoint",
    resourceId: id,
    hostId: Number(updated?.hostId || before.hostId || 0) || null,
    action: "update",
    before: protocolEndpointAuditSnapshot(before),
    after: protocolEndpointAuditSnapshot(updated),
  });
  return updated;
}

export async function deleteProtocolEndpoint(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const before = await getProtocolEndpointById(id);
  if (!before) return false;
  await withDatabaseTransaction(async () => {
    const tx = await getDb();
    if (!tx) throw new Error("Database not available");
    await tx.delete(protocolUserAccess).where(eq(protocolUserAccess.endpointId, id));
    await tx.delete(protocolEndpoints).where(eq(protocolEndpoints.id, id));
  });
  await recordConfigAuditEvent({
    resourceType: "protocol_endpoint",
    resourceId: id,
    hostId: Number(before.hostId || 0) || null,
    action: "delete",
    before: protocolEndpointAuditSnapshot(before),
  });
  return true;
}

export async function listProtocolEndpointAssignments(endpointId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    access: protocolUserAccess,
    user: {
      id: users.id,
      username: users.username,
      name: users.name,
      accountEnabled: users.accountEnabled,
      expiresAt: users.expiresAt,
    },
  }).from(protocolUserAccess)
    .innerJoin(users, eq(protocolUserAccess.userId, users.id))
    .where(eq(protocolUserAccess.endpointId, endpointId))
    .orderBy(asc(users.username), asc(protocolUserAccess.id));
}

export async function setProtocolUserAccess(input: {
  endpointId: number;
  userId: number;
  credential: unknown;
  isEnabled?: boolean;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [endpointRows, userRows, existingRows] = await Promise.all([
    db.select({ id: protocolEndpoints.id }).from(protocolEndpoints).where(eq(protocolEndpoints.id, input.endpointId)).limit(1),
    db.select({ id: users.id }).from(users).where(eq(users.id, input.userId)).limit(1),
    db.select().from(protocolUserAccess).where(and(
      eq(protocolUserAccess.endpointId, input.endpointId),
      eq(protocolUserAccess.userId, input.userId),
    )).limit(1),
  ]);
  if (!endpointRows[0]) throw new Error("协议接入端点不存在");
  if (!userRows[0]) throw new Error("用户不存在");
  const payload = {
    credentialJson: stringifyConfig(input.credential),
    isEnabled: input.isEnabled ?? true,
    updatedAt: nowDate(),
  };
  if (existingRows[0]) {
    await db.update(protocolUserAccess).set(payload as any).where(eq(protocolUserAccess.id, existingRows[0].id));
    return existingRows[0].id;
  }
  return insertAndGetId("protocol_user_access", {
    endpointId: input.endpointId,
    userId: input.userId,
    credentialJson: payload.credentialJson,
    isEnabled: payload.isEnabled,
    createdAt: nowDate(),
    updatedAt: nowDate(),
  });
}

export async function removeProtocolUserAccess(endpointId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(protocolUserAccess).where(and(
    eq(protocolUserAccess.endpointId, endpointId),
    eq(protocolUserAccess.userId, userId),
  ));
}

async function protocolFeedTokenRowForUser(userId: number) {
  const db = await getDb();
  if (!db) return undefined;
  const rows = await db.select().from(protocolFeedTokens).where(eq(protocolFeedTokens.userId, userId)).limit(1);
  return rows[0];
}

function newFeedToken() {
  return randomBytes(32).toString("hex");
}

export async function ensureProtocolFeedToken(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const userRows = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!userRows[0]) throw new Error("用户不存在");
  const existing = await protocolFeedTokenRowForUser(userId);
  if (existing) return existing;
  try {
    const id = await insertAndGetId("protocol_feed_tokens", {
      userId,
      token: newFeedToken(),
      isEnabled: true,
      createdAt: nowDate(),
      updatedAt: nowDate(),
    });
    const rows = await db.select().from(protocolFeedTokens).where(eq(protocolFeedTokens.id, id)).limit(1);
    return rows[0];
  } catch (error) {
    const raced = await protocolFeedTokenRowForUser(userId);
    if (raced) return raced;
    throw error;
  }
}

export async function rotateProtocolFeedToken(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await ensureProtocolFeedToken(userId);
  await db.update(protocolFeedTokens).set({
    token: newFeedToken(),
    isEnabled: true,
    updatedAt: nowDate(),
  } as any).where(eq(protocolFeedTokens.userId, userId));
  return protocolFeedTokenRowForUser(userId);
}

export async function getProtocolFeedByToken(tokenValue: string) {
  const db = await getDb();
  if (!db) return undefined;
  const token = String(tokenValue || "").trim();
  if (!/^[a-f0-9]{64}$/i.test(token)) return undefined;
  const tokenRows = await db.select({
    feed: protocolFeedTokens,
    user: {
      id: users.id,
      accountEnabled: users.accountEnabled,
      trafficLimit: users.trafficLimit,
      trafficUsed: users.trafficUsed,
      expiresAt: users.expiresAt,
    },
  }).from(protocolFeedTokens)
    .innerJoin(users, eq(protocolFeedTokens.userId, users.id))
    .where(and(eq(protocolFeedTokens.token, token), eq(protocolFeedTokens.isEnabled, true)))
    .limit(1);
  const tokenRow = tokenRows[0];
  if (!tokenRow || !tokenRow.user.accountEnabled) return undefined;
  if (tokenRow.user.expiresAt && new Date(tokenRow.user.expiresAt).getTime() <= Date.now()) return undefined;

  const rows = await db.select({
    assignmentId: protocolUserAccess.id,
    endpointId: protocolEndpoints.id,
    name: protocolEndpoints.name,
    protocol: protocolEndpoints.protocol,
    publicHost: protocolEndpoints.publicHost,
    publicPort: protocolEndpoints.publicPort,
    endpointConfig: protocolEndpoints.configJson,
    credential: protocolUserAccess.credentialJson,
  }).from(protocolUserAccess)
    .innerJoin(protocolEndpoints, eq(protocolUserAccess.endpointId, protocolEndpoints.id))
    .where(and(
      eq(protocolUserAccess.userId, tokenRow.user.id),
      eq(protocolUserAccess.isEnabled, true),
      eq(protocolEndpoints.isEnabled, true),
    ))
    .orderBy(asc(protocolEndpoints.sortOrder), asc(protocolEndpoints.id));

  const entries: ProtocolFeedEntry[] = rows.flatMap((row: any) => {
    if (!isProtocol(row.protocol)) return [];
    return [{
      assignmentId: Number(row.assignmentId),
      endpointId: Number(row.endpointId),
      name: String(row.name || ""),
      protocol: row.protocol,
      publicHost: String(row.publicHost || ""),
      publicPort: Number(row.publicPort || 0),
      endpointConfig: parseProtocolAccessConfig(row.endpointConfig),
      credential: parseProtocolAccessConfig(row.credential),
    }];
  });

  await db.update(protocolFeedTokens).set({ lastUsedAt: nowDate() } as any)
    .where(eq(protocolFeedTokens.id, tokenRow.feed.id)).catch(() => undefined);
  return { token: tokenRow.feed, user: tokenRow.user, entries };
}
