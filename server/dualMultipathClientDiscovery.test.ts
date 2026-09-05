import assert from "node:assert/strict";
import test from "node:test";
import { dualMultipathDraftSchema } from "../shared/dualMultipath";
import {
  dualClientDiscoverySnapshotSchema,
  evaluateDualClientSnapshot,
  type DualClientDiscoverySnapshot,
} from "../shared/dualMultipathClientDiscovery";
import { defaultDualMultipathInfrastructure } from "./dualMultipathControlPlane";
import { materializeDualClientFacts, resolveDualPureMieruProxy } from "./dualMultipathClientDiscovery";

const clientRef = { kind: "external-openwrt" as const, targetKey: "dual-client:openwrt:discovery-test" };
const infrastructure = defaultDualMultipathInfrastructure();
const legacyMihomoBridge = {
  type: "mihomo-dedicated-listener" as const,
  listener: {
    kind: "socks" as const,
    scope: "dedicated" as const,
    listen: "127.0.0.1" as const,
    portPlanning: { status: "unresolved" as const, strategy: "auto" as const, port: null },
  },
  target: {
    selection: "single-proxy" as const,
    protocol: "mieru" as const,
    discovery: { status: "unresolved" as const, proxyRef: null },
    routing: "fixed-proxy" as const,
    fallback: "none" as const,
    transportScope: "private-only" as const,
  },
};
const draft = {
  version: 5 as const,
  state: "draft" as const,
  name: "NoBrand Dual",
  ...infrastructure,
  privateCarrierBridge: legacyMihomoBridge,
  clientTarget: { status: "bound" as const, ref: clientRef },
  line: { ...infrastructure.line, activationThresholdMbps: 120, activationWindow: "1s" },
  legs: [
    { ...infrastructure.legs[0], expectedBandwidthMbps: 200 },
    { ...infrastructure.legs[1], expectedBandwidthMbps: 1000 },
  ] as const,
};

test("ForwardX-managed Mieru sidecar needs no Mihomo candidate discovery", () => {
  const managedDraft = { ...draft, privateCarrierBridge: infrastructure.privateCarrierBridge };
  const result = materializeDualClientFacts(managedDraft, { ...snapshot, mihomo: { candidates: [] } }, freshness);
  assert.equal(result.status, "materialized-read-only");
  assert.equal(result.diagnostics.pureMieruStatus, "not-required");
  assert.deepEqual(result.diagnostics.blockerCodes, []);
});
const pureMieru = {
  kind: "concrete-proxy" as const,
  ref: "Pure-Mieru-A",
  protocol: "mieru" as const,
  transportScope: "private-only" as const,
  fallback: "none" as const,
};
const snapshot: DualClientDiscoverySnapshot = {
  snapshotId: "client-discovery-001",
  clientTargetRef: clientRef,
  scope: "dual-client-read-only",
  observedAt: "2026-08-31T02:00:00.000Z",
  occupiedTcpPorts: [23180, 23182],
  mihomo: { candidates: [pureMieru] },
};
const freshness = { referenceTime: "2026-08-31T02:01:00.000Z", maxAgeMs: 120_000 };

test("evaluates current and stale snapshots only from explicit time context", () => {
  assert.equal(evaluateDualClientSnapshot(snapshot, freshness).status, "current");
  assert.equal(evaluateDualClientSnapshot(snapshot, {
    referenceTime: "2026-08-31T02:10:00.000Z",
    maxAgeMs: 60_000,
  }).status, "stale");
});

test("rejects Mieru discovery for unresolved or mismatched client targets", () => {
  assert.throws(() => resolveDualPureMieruProxy(
    { ...draft, clientTarget: { status: "unresolved" } }, snapshot, freshness,
  ), /未绑定/);
  assert.throws(() => resolveDualPureMieruProxy(draft, {
    ...snapshot,
    clientTargetRef: { kind: "external-openwrt", targetKey: "dual-client:openwrt:other" },
  }, freshness), /不一致/);
});

test("verifies exactly one pure Mieru proxy with client-bound evidence", () => {
  const first = resolveDualPureMieruProxy(draft, snapshot, freshness);
  const second = resolveDualPureMieruProxy(draft, snapshot, freshness);
  assert.deepEqual(first, second);
  assert.equal(first.status, "verified-read-only");
  if (first.draft.privateCarrierBridge.type !== "mihomo-dedicated-listener") throw new Error("expected Mihomo bridge");
  assert.deepEqual(first.draft.privateCarrierBridge.target.discovery, {
    status: "verified-read-only",
    proxyRef: "Pure-Mieru-A",
    evidence: { snapshotId: snapshot.snapshotId, clientTargetRef: clientRef },
  });
});

test("retains the same verified proxy ref across a newer same-client snapshot", () => {
  const first = resolveDualPureMieruProxy(draft, snapshot, freshness);
  const second = resolveDualPureMieruProxy(first.draft, { ...snapshot, snapshotId: "client-discovery-002" }, freshness);
  assert.equal(second.status, "verified-read-only");
  if (second.draft.privateCarrierBridge.type !== "mihomo-dedicated-listener") throw new Error("expected Mihomo bridge");
  assert.equal(second.draft.privateCarrierBridge.target.discovery.proxyRef, "Pure-Mieru-A");
  if (second.draft.privateCarrierBridge.target.discovery.status !== "verified-read-only") throw new Error("expected verified proxy");
  assert.equal(second.draft.privateCarrierBridge.target.discovery.evidence.snapshotId, "client-discovery-002");
});

test("keeps zero candidates unresolved and multiple candidates ambiguous", () => {
  const zero = resolveDualPureMieruProxy(draft, { ...snapshot, mihomo: { candidates: [] } }, freshness);
  assert.equal(zero.status, "unresolved");
  assert.deepEqual(zero.diagnostics.blockerCodes, ["pure-mieru-unresolved"]);
  const multiple = resolveDualPureMieruProxy(draft, {
    ...snapshot,
    mihomo: { candidates: [pureMieru, { ...pureMieru, ref: "Pure-Mieru-B" }] },
  }, freshness);
  assert.equal(multiple.status, "ambiguous");
  assert.deepEqual(multiple.diagnostics.blockerCodes, ["pure-mieru-ambiguous"]);
});

test("does not accept groups, DIRECT, fallback, public transport, mixed listeners or ingress recursion", () => {
  const candidates = [
    { kind: "proxy-group" as const, ref: "Mieru-Select", groupType: "select" as const },
    { kind: "builtin" as const, ref: "DIRECT" as const },
    { ...pureMieru, ref: "Mieru-Fallback", fallback: "direct" as const },
    { ...pureMieru, ref: "Mieru-Public", transportScope: "public-capable" as const },
    { kind: "listener" as const, ref: "mixed-in", listenerType: "mixed" as const },
    { ...pureMieru, ref: draft.openClashIngressAdapter.tag },
  ];
  const result = resolveDualPureMieruProxy(draft, { ...snapshot, mihomo: { candidates } }, freshness);
  assert.equal(result.status, "unresolved");
  assert.equal(result.diagnostics.rejectedCandidateCount, candidates.length);
});

test("downgrades an old verified proxy when it disappears or stops being pure Mieru", () => {
  const verified = resolveDualPureMieruProxy(draft, snapshot, freshness).draft;
  const disappeared = resolveDualPureMieruProxy(verified, { ...snapshot, snapshotId: "client-discovery-002", mihomo: { candidates: [] } }, freshness);
  assert.equal(disappeared.status, "unresolved");
  if (disappeared.draft.privateCarrierBridge.type !== "mihomo-dedicated-listener") throw new Error("expected Mihomo bridge");
  assert.deepEqual(disappeared.draft.privateCarrierBridge.target.discovery, { status: "unresolved", proxyRef: null });
  const changed = resolveDualPureMieruProxy(verified, {
    ...snapshot,
    snapshotId: "client-discovery-003",
    mihomo: { candidates: [{ ...pureMieru, protocol: "other" }] },
  }, freshness);
  assert.equal(changed.status, "unresolved");
});

test("stale snapshots and client changes cannot create or retain trusted evidence", () => {
  assert.throws(() => resolveDualPureMieruProxy(draft, snapshot, {
    referenceTime: "2026-08-31T02:10:00.000Z",
    maxAgeMs: 60_000,
  }), /已过期/);
  const materialized = materializeDualClientFacts(draft, snapshot, freshness);
  assert.equal(materialized.status, "materialized-read-only");
  assert.throws(() => dualMultipathDraftSchema.parse({
    ...materialized.draft,
    clientTarget: {
      status: "bound",
      ref: { kind: "external-openwrt", targetKey: "dual-client:openwrt:replacement" },
    },
  }), /evidence 必须绑定当前 Dual client target/);
});

test("combined materializer uses one snapshot contract and preserves server/HY2/secrets", () => {
  const draftBefore = structuredClone(draft);
  const snapshotBefore = structuredClone(snapshot);
  const result = materializeDualClientFacts(draft, snapshot, freshness);
  assert.equal(result.status, "materialized-read-only");
  assert.equal(result.diagnostics.snapshotStatus, "current");
  assert.equal(result.diagnostics.portPlanningStatus, "planned-read-only");
  assert.equal(result.diagnostics.pureMieruStatus, "verified-read-only");
  assert.deepEqual(result.diagnostics.blockerCodes, []);
  assert.deepEqual(result.draft.serverTargetDiscovery, draft.serverTargetDiscovery);
  assert.deepEqual(result.draft.directCarrier, draft.directCarrier);
  assert.deepEqual(result.draft.serverRuntime, draft.serverRuntime);
  assert.equal(result.draft.directCarrier.authSecretRef, "dual.hy2.auth");
  assert.equal(result.draft.serverRuntime.directCarrierRuntime.tlsPrivateKeySecretRef, "dual.hy2.tls.private-key");
  assert.deepEqual(draft, draftBefore);
  assert.deepEqual(snapshot, snapshotBefore);
  assert.equal(result.safety.persistenceWrite, false);
  assert.equal(result.safety.systemMutation, false);
});

test("combined materializer reports stale, mismatch and ambiguous blockers precisely", () => {
  const stale = materializeDualClientFacts(draft, snapshot, {
    referenceTime: "2026-08-31T02:10:00.000Z",
    maxAgeMs: 60_000,
  });
  assert.deepEqual(stale.diagnostics.blockerCodes, ["client-snapshot-stale"]);
  const mismatch = materializeDualClientFacts(draft, {
    ...snapshot,
    clientTargetRef: { kind: "external-openwrt", targetKey: "dual-client:openwrt:other" },
  }, freshness);
  assert.deepEqual(mismatch.diagnostics.blockerCodes, ["client-snapshot-mismatch"]);
  const ambiguous = materializeDualClientFacts(draft, {
    ...snapshot,
    mihomo: { candidates: [pureMieru, { ...pureMieru, ref: "Pure-Mieru-B" }] },
  }, freshness);
  assert.deepEqual(ambiguous.diagnostics.blockerCodes, ["pure-mieru-ambiguous"]);
});

test("snapshot contract rejects secret-bearing or duplicated candidate facts", () => {
  assert.throws(() => dualClientDiscoverySnapshotSchema.parse({ ...snapshot, password: "not-allowed" }), /unrecognized key/i);
  assert.throws(() => dualClientDiscoverySnapshotSchema.parse({
    ...snapshot,
    mihomo: { candidates: [{ ...pureMieru, password: "not-allowed" }] },
  }), /unrecognized key/i);
  assert.throws(() => dualClientDiscoverySnapshotSchema.parse({
    ...snapshot,
    mihomo: { candidates: [pureMieru, pureMieru] },
  }), /不能重复/);
});

test("external client keys require a stable namespace and cannot be raw IP identities", () => {
  assert.throws(() => dualMultipathDraftSchema.parse({
    ...draft,
    clientTarget: { status: "bound", ref: { kind: "external-openwrt", targetKey: "dual-client:192.168.1.4" } },
  }), /不能使用 IP/);
});
