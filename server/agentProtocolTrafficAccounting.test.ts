import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentProtocolTrafficValidationError,
  normalizeAgentProtocolTrafficStats,
  planAgentProtocolTrafficAccounting,
  protocolTrafficProducerId,
} from "./agentProtocolTrafficAccounting";

test("protocol traffic producer uses an independent idempotency namespace", () => {
  assert.equal(protocolTrafficProducerId("agent-boot-1"), "protocol:agent-boot-1");
  assert.equal(protocolTrafficProducerId(""), "protocol:legacy");
});

test("protocol stats merge repeated assignment deltas before accounting", () => {
  assert.deepEqual(normalizeAgentProtocolTrafficStats([
    { assignmentId: 5, bytesIn: 10, bytesOut: 20 },
    { assignmentId: 5, bytesIn: 30, bytesOut: 40 },
    { assignmentId: 6, bytesIn: 0, bytesOut: 0 },
  ]), [
    { assignmentId: 5, bytesIn: 40, bytesOut: 60 },
  ]);
});

test("malformed protocol stats reject the whole report instead of silently billing partial data", () => {
  assert.throws(() => normalizeAgentProtocolTrafficStats([
    { assignmentId: 5, bytesOut: 100 },
    { assignmentId: 0, bytesOut: 200 },
  ]), AgentProtocolTrafficValidationError);
});

test("accounting plan trusts panel ownership and ignores foreign assignments", () => {
  const stats = normalizeAgentProtocolTrafficStats([
    { assignmentId: 5, bytesIn: 100, bytesOut: 900 },
    { assignmentId: 6, bytesIn: 200, bytesOut: 1800 },
    { assignmentId: 99, bytesOut: 5000 },
  ]);
  const plan = planAgentProtocolTrafficAccounting(stats, [
    { assignmentId: 5, endpointId: 22, userId: 2, hostId: 7 },
    { assignmentId: 6, endpointId: 22, userId: 2, hostId: 7 },
    { assignmentId: 99, endpointId: 33, userId: 9, hostId: 8 },
  ], 7);

  assert.deepEqual(plan.samples, [
    { assignmentId: 5, endpointId: 22, userId: 2, hostId: 7, bytesIn: 100, bytesOut: 900 },
    { assignmentId: 6, endpointId: 22, userId: 2, hostId: 7, bytesIn: 200, bytesOut: 1800 },
  ]);
  assert.deepEqual(Array.from(plan.userTotals.entries()), [[2, 3000]]);
  assert.deepEqual(plan.ignoredAssignments, [99]);
});
