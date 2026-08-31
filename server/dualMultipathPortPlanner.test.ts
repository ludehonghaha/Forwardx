import assert from "node:assert/strict";
import test from "node:test";
import { defaultDualMultipathInfrastructure } from "./dualMultipathControlPlane";
import {
  DUAL_CLIENT_LOOPBACK_AUTO_PORT_RANGE,
  planDualClientLoopbackPorts,
  type DualPortAvailabilitySnapshot,
} from "./dualMultipathPortPlanner";

const clientRef = { kind: "external-openwrt" as const, targetKey: "dual-client:openwrt:ports-test" };
const infrastructure = defaultDualMultipathInfrastructure();
const draft = {
  version: 5 as const,
  state: "draft" as const,
  name: "NoBrand Dual",
  ...infrastructure,
  clientTarget: { status: "bound" as const, ref: clientRef },
  line: { ...infrastructure.line, activationThresholdMbps: 120, activationWindow: "1s" },
  legs: [
    { ...infrastructure.legs[0], expectedBandwidthMbps: 200 },
    { ...infrastructure.legs[1], expectedBandwidthMbps: 1000 },
  ] as const,
};

const snapshot: DualPortAvailabilitySnapshot = {
  snapshotId: "ports-openwrt-001",
  clientTargetRef: clientRef,
  scope: "dual-client-read-only",
  observedAt: "2026-08-31T00:00:00.000Z",
  occupiedTcpPorts: [23180, 23182, 39000],
  mihomo: { candidates: [] },
};
const freshness = { referenceTime: "2026-08-31T00:01:00.000Z", maxAgeMs: 120_000 };

test("selects two different deterministic ports and never selects occupied ports", () => {
  const first = planDualClientLoopbackPorts(draft, snapshot, freshness);
  const second = planDualClientLoopbackPorts(draft, snapshot, freshness);
  assert.deepEqual(first, second);
  assert.deepEqual(first.diagnostics.selected, { dualIngressPort: 23181, mihomoDedicatedListenerPort: 23183 });
  assert.notEqual(first.diagnostics.selected.dualIngressPort, first.diagnostics.selected.mihomoDedicatedListenerPort);
  assert.equal(snapshot.occupiedTcpPorts.includes(first.diagnostics.selected.dualIngressPort), false);
  assert.equal(snapshot.occupiedTcpPorts.includes(first.diagnostics.selected.mihomoDedicatedListenerPort), false);
});

test("keeps valid planned ports stable for the same client when facts are still safe", () => {
  const first = planDualClientLoopbackPorts(draft, snapshot, freshness);
  const second = planDualClientLoopbackPorts(first.draft, { ...snapshot, snapshotId: "ports-openwrt-002" }, freshness);
  assert.deepEqual(second.diagnostics.selected, first.diagnostics.selected);
  assert.equal(second.draft.openClashIngressAdapter.portPlanning.status, "planned-read-only");
  if (second.draft.openClashIngressAdapter.portPlanning.status !== "planned-read-only") throw new Error("expected planning evidence");
  assert.equal(second.draft.openClashIngressAdapter.portPlanning.evidence.snapshotId, "ports-openwrt-002");
  assert.deepEqual(second.draft.openClashIngressAdapter.portPlanning.evidence.clientTargetRef, clientRef);
});

test("fails closed when the candidate range has fewer than two available ports", () => {
  const occupiedTcpPorts = Array.from(
    { length: DUAL_CLIENT_LOOPBACK_AUTO_PORT_RANGE.end - DUAL_CLIENT_LOOPBACK_AUTO_PORT_RANGE.start },
    (_, index) => DUAL_CLIENT_LOOPBACK_AUTO_PORT_RANGE.start + index,
  );
  assert.throws(() => planDualClientLoopbackPorts(draft, {
    ...snapshot,
    snapshotId: "ports-exhausted",
    occupiedTcpPorts,
  }, freshness), /没有足够的空闲 TCP 端口/);
});

test("rejects unresolved, external-key mismatch and ForwardX hostId mismatch", () => {
  assert.throws(() => planDualClientLoopbackPorts({ ...draft, clientTarget: { status: "unresolved" } }, snapshot, freshness), /未绑定/);
  assert.throws(() => planDualClientLoopbackPorts(draft, {
    ...snapshot,
    clientTargetRef: { kind: "external-openwrt", targetKey: "dual-client:openwrt:other" },
  }, freshness), /不一致/);
  const hostDraft = { ...draft, clientTarget: { status: "bound" as const, ref: { kind: "forwardx-host" as const, hostId: 7 } } };
  assert.throws(() => planDualClientLoopbackPorts(hostDraft, {
    ...snapshot,
    clientTargetRef: { kind: "forwardx-host", hostId: 8 },
  }, freshness), /不一致/);
});

test("rejects stale snapshots without producing new planning evidence", () => {
  assert.throws(() => planDualClientLoopbackPorts(draft, snapshot, {
    referenceTime: "2026-08-31T00:10:00.000Z",
    maxAgeMs: 60_000,
  }), /已过期/);
});

test("does not modify server discovery, proxy discovery, HY2 or secret references", () => {
  const draftBefore = structuredClone(draft);
  const snapshotBefore = structuredClone(snapshot);
  const result = planDualClientLoopbackPorts(draft, snapshot, freshness);
  assert.deepEqual(draft, draftBefore);
  assert.deepEqual(snapshot, snapshotBefore);
  assert.deepEqual(result.draft.serverTargetDiscovery, draft.serverTargetDiscovery);
  if (result.draft.privateCarrierBridge.type !== "mihomo-dedicated-listener") throw new Error("expected Mihomo bridge");
  assert.deepEqual(result.draft.privateCarrierBridge.target.discovery, draft.privateCarrierBridge.target.discovery);
  assert.deepEqual(result.draft.directCarrier, draft.directCarrier);
  assert.deepEqual(result.draft.serverRuntime, draft.serverRuntime);
  assert.equal(result.draft.directCarrier.authSecretRef, "dual.hy2.auth");
  assert.equal(result.draft.serverRuntime.directCarrierRuntime.tlsPrivateKeySecretRef, "dual.hy2.tls.private-key");
});

test("returns facts-only diagnostics without persistence or system mutation capability", () => {
  const result = planDualClientLoopbackPorts(draft, snapshot, freshness);
  assert.deepEqual(result.safety, {
    factsOnly: true,
    externalCall: false,
    socketProbe: false,
    persistenceWrite: false,
    systemMutation: false,
  });
  assert.equal(result.diagnostics.snapshotId, snapshot.snapshotId);
  assert.deepEqual(result.diagnostics.clientTargetRef, snapshot.clientTargetRef);
  assert.equal(result.diagnostics.freshness.status, "current");
  assert.equal(result.diagnostics.deterministic, true);
});

test("rejects malformed, duplicated or secret-bearing availability facts", () => {
  assert.throws(() => planDualClientLoopbackPorts(draft, { ...snapshot, occupiedTcpPorts: [23180, 23180] }, freshness), /不能重复/);
  assert.throws(() => planDualClientLoopbackPorts(draft, { ...snapshot, scope: "server-public" }, freshness), /Invalid literal value/);
  assert.throws(() => planDualClientLoopbackPorts(draft, { ...snapshot, token: "must-not-be-accepted" }, freshness), /unrecognized key/i);
});
