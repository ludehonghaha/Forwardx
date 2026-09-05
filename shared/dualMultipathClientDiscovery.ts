import { z } from "zod";
import {
  dualClientTargetRefSchema,
  dualClientTargetRefsEqual,
  dualPortSchema,
  type DualClientTargetRef,
} from "./dualMultipath";

const snapshotIdSchema = z.string().trim().min(1).max(128);
const proxyRefSchema = z.string().trim().min(1).max(255);

export const dualMihomoCandidateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("concrete-proxy"),
    ref: proxyRefSchema,
    protocol: z.enum(["mieru", "other"]),
    transportScope: z.enum(["private-only", "public-capable"]),
    fallback: z.enum(["none", "direct", "public"]),
  }).strict(),
  z.object({
    kind: z.literal("proxy-group"),
    ref: proxyRefSchema,
    groupType: z.enum(["select", "url-test", "fallback", "load-balance"]),
  }).strict(),
  z.object({
    kind: z.literal("builtin"),
    ref: z.enum(["DIRECT", "REJECT"]),
  }).strict(),
  z.object({
    kind: z.literal("listener"),
    ref: proxyRefSchema,
    listenerType: z.enum(["mixed", "socks"]),
  }).strict(),
]);

export const dualClientDiscoverySnapshotSchema = z.object({
  snapshotId: snapshotIdSchema,
  clientTargetRef: dualClientTargetRefSchema,
  scope: z.literal("dual-client-read-only"),
  observedAt: z.string().datetime({ offset: true }),
  occupiedTcpPorts: z.array(dualPortSchema).max(65535),
  mihomo: z.object({
    candidates: z.array(dualMihomoCandidateSchema).max(4096),
  }).strict(),
}).strict().superRefine((snapshot, ctx) => {
  if (new Set(snapshot.occupiedTcpPorts).size !== snapshot.occupiedTcpPorts.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["occupiedTcpPorts"], message: "occupied TCP ports 不能重复" });
  }
  const refs = snapshot.mihomo.candidates.map((candidate) => candidate.ref);
  if (new Set(refs).size !== refs.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mihomo", "candidates"], message: "Mihomo candidate ref 不能重复" });
  }
});

export const dualClientSnapshotFreshnessContextSchema = z.object({
  referenceTime: z.string().datetime({ offset: true }),
  maxAgeMs: z.number().int().safe().nonnegative(),
}).strict();

export type DualMihomoCandidate = z.output<typeof dualMihomoCandidateSchema>;
export type DualClientDiscoverySnapshot = z.output<typeof dualClientDiscoverySnapshotSchema>;
export type DualClientSnapshotFreshnessContext = z.output<typeof dualClientSnapshotFreshnessContextSchema>;

export function evaluateDualClientSnapshot(
  snapshotInput: unknown,
  freshnessInput: unknown,
) {
  const snapshot = dualClientDiscoverySnapshotSchema.parse(snapshotInput);
  const freshness = dualClientSnapshotFreshnessContextSchema.parse(freshnessInput);
  const observedAtMs = new Date(snapshot.observedAt).getTime();
  const referenceTimeMs = new Date(freshness.referenceTime).getTime();
  const ageMs = referenceTimeMs - observedAtMs;
  const status = ageMs < 0
    ? "future" as const
    : ageMs > freshness.maxAgeMs
      ? "stale" as const
      : "current" as const;
  return {
    status,
    ageMs,
    maxAgeMs: freshness.maxAgeMs,
    observedAt: snapshot.observedAt,
    referenceTime: freshness.referenceTime,
  };
}

export function assertDualClientSnapshotTarget(
  clientTarget: { status: "unresolved" } | { status: "bound"; ref: DualClientTargetRef },
  snapshotRef: DualClientTargetRef,
) {
  if (clientTarget.status !== "bound") {
    throw new Error("Dual client target 未绑定，不能消费 client discovery snapshot");
  }
  if (!dualClientTargetRefsEqual(clientTarget.ref, snapshotRef)) {
    throw new Error("Dual client snapshot 与当前绑定的客户端不一致");
  }
  return clientTarget.ref;
}

export function assertFreshDualClientSnapshot(
  snapshot: DualClientDiscoverySnapshot,
  freshnessInput: unknown,
) {
  const freshness = evaluateDualClientSnapshot(snapshot, freshnessInput);
  if (freshness.status === "stale") {
    throw new Error("Dual client discovery snapshot 已过期，不能产生 trusted evidence");
  }
  if (freshness.status === "future") {
    throw new Error("Dual client discovery snapshot 时间晚于 referenceTime，不能产生 trusted evidence");
  }
  return freshness;
}
