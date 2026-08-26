import assert from "node:assert/strict";
import test from "node:test";
import { isAgentProtocolTrafficStat } from "./agentDtos";

test("protocol traffic DTO accepts assignment-only ownership with byte deltas", () => {
  assert.equal(isAgentProtocolTrafficStat({ assignmentId: 5, bytesIn: 10, bytesOut: 20 }), true);
  assert.equal(isAgentProtocolTrafficStat({ assignmentId: 5, bytesOut: 0 }), true);
});

test("protocol traffic DTO rejects Agent-supplied ownership and malformed counters only through shape validation", () => {
  assert.equal(isAgentProtocolTrafficStat({ assignmentId: 0, bytesOut: 1 }), false);
  assert.equal(isAgentProtocolTrafficStat({ assignmentId: 5 }), false);
  assert.equal(isAgentProtocolTrafficStat({ assignmentId: 5, bytesOut: -1 }), false);
  assert.equal(isAgentProtocolTrafficStat({ assignmentId: 5, bytesOut: 1.5 }), false);
  assert.equal(isAgentProtocolTrafficStat({ assignmentId: 5, bytesOut: Number.MAX_SAFE_INTEGER + 1 }), false);
});
