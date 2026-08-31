import assert from "node:assert/strict";
import test from "node:test";
import { defaultDualMultipathInfrastructure } from "./dualMultipathControlPlane";
import {
  DUAL_CLIENT_LOOPBACK_AUTO_PORT_RANGE,
  planDualClientLoopbackPorts,
  type DualPortAvailabilitySnapshot,
} from "./dualMultipathPortPlanner";

const infrastructure = defaultDualMultipathInfrastructure();
const draft = {
  version: 4 as const,
  state: "draft" as const,
  name: "NoBrand Dual",
  ...infrastructure,
  line: { ...infrastructure.line, activationThresholdMbps: 120, activationWindow: "1s" },
  legs: [
    { ...infrastructure.legs[0], expectedBandwidthMbps: 200 },
    { ...infrastructure.legs[1], expectedBandwidthMbps: 1000 },
  ] as const,
};

const snapshot: DualPortAvailabilitySnapshot = {
  snapshotId: "ports-openwrt-001",
  targetId: "openwrt-openclash-current",
  scope: "client-loopback-tcp",
  observedAt: "2026-08-31T00:00:00.000Z",
  occupiedTcpPorts: [23180, 23182, 39000],
};

test("selects two different deterministic ports and never selects occupied ports", () => {
  const first = planDualClientLoopbackPorts(draft, snapshot);
  const second = planDualClientLoopbackPorts(draft, snapshot);
  assert.deepEqual(first, second);
  assert.deepEqual(first.diagnostics.selected, { dualIngressPort: 23181, mihomoDedicatedListenerPort: 23183 });
  assert.notEqual(first.diagnostics.selected.dualIngressPort, first.diagnostics.selected.mihomoDedicatedListenerPort);
  assert.equal(snapshot.occupiedTcpPorts.includes(first.diagnostics.selected.dualIngressPort), false);
  assert.equal(snapshot.occupiedTcpPorts.includes(first.diagnostics.selected.mihomoDedicatedListenerPort), false);
});

test("keeps valid planned ports stable when the same snapshot is applied again", () => {
  const first = planDualClientLoopbackPorts(draft, snapshot);
  const second = planDualClientLoopbackPorts(first.draft, snapshot);
  assert.deepEqual(second.diagnostics.selected, first.diagnostics.selected);
  assert.deepEqual(second.draft, first.draft);
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
  }), /没有足够的空闲 TCP 端口/);
});

test("does not modify target discovery, proxy discovery, HY2 or secret references", () => {
  const draftBefore = structuredClone(draft);
  const snapshotBefore = structuredClone(snapshot);
  const result = planDualClientLoopbackPorts(draft, snapshot);
  assert.deepEqual(draft, draftBefore);
  assert.deepEqual(snapshot, snapshotBefore);
  assert.deepEqual(result.draft.targetDiscovery, draft.targetDiscovery);
  if (result.draft.privateCarrierBridge.type !== "mihomo-dedicated-listener") throw new Error("expected Mihomo bridge");
  assert.deepEqual(result.draft.privateCarrierBridge.target.discovery, draft.privateCarrierBridge.target.discovery);
  assert.deepEqual(result.draft.directCarrier, draft.directCarrier);
  assert.deepEqual(result.draft.serverRuntime, draft.serverRuntime);
  assert.equal(result.draft.directCarrier.authSecretRef, "dual.hy2.auth");
  assert.equal(result.draft.serverRuntime.directCarrierRuntime.tlsPrivateKeySecretRef, "dual.hy2.tls.private-key");
});

test("returns facts-only diagnostics without persistence or system mutation capability", () => {
  const result = planDualClientLoopbackPorts(draft, snapshot);
  assert.deepEqual(result.safety, {
    factsOnly: true,
    externalCall: false,
    socketProbe: false,
    persistenceWrite: false,
    systemMutation: false,
  });
  assert.equal(result.diagnostics.snapshotId, snapshot.snapshotId);
  assert.equal(result.diagnostics.targetId, snapshot.targetId);
  assert.equal(result.diagnostics.deterministic, true);
});

test("rejects malformed or duplicated availability facts", () => {
  assert.throws(() => planDualClientLoopbackPorts(draft, { ...snapshot, occupiedTcpPorts: [23180, 23180] }), /不能重复/);
  assert.throws(() => planDualClientLoopbackPorts(draft, { ...snapshot, scope: "server-public" }), /Invalid literal value/);
});
