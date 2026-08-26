import assert from "node:assert/strict";
import test from "node:test";
import {
  PROTOCOL_USER_TRAFFIC_BUCKET_MINUTES,
  aggregateProtocolUserTrafficSamples,
  protocolUserTrafficBucketStart,
} from "./protocolUserTrafficRepository";

const AT = new Date("2026-08-26T08:12:34.000Z");

test("protocol traffic bucket aligns to the shared 30 minute window", () => {
  assert.equal(PROTOCOL_USER_TRAFFIC_BUCKET_MINUTES, 30);
  assert.equal(
    protocolUserTrafficBucketStart(AT),
    Math.floor(new Date("2026-08-26T08:00:00.000Z").getTime() / 1000),
  );
});

test("two Reality users on one endpoint remain separate accounting owners", () => {
  const rows = aggregateProtocolUserTrafficSamples([
    { assignmentId: 5, endpointId: 22, userId: 2, hostId: 7, bytesIn: 100, bytesOut: 900, recordedAt: AT },
    { assignmentId: 6, endpointId: 22, userId: 3, hostId: 7, bytesIn: 200, bytesOut: 1800, recordedAt: AT },
  ]);
  assert.deepEqual(rows.map((row) => ({
    assignmentId: row.assignmentId,
    endpointId: row.endpointId,
    userId: row.userId,
    bytesIn: row.bytesIn,
    bytesOut: row.bytesOut,
  })), [
    { assignmentId: 5, endpointId: 22, userId: 2, bytesIn: 100, bytesOut: 900 },
    { assignmentId: 6, endpointId: 22, userId: 3, bytesIn: 200, bytesOut: 1800 },
  ]);
});

test("repeated samples for one assignment aggregate without changing ownership", () => {
  const rows = aggregateProtocolUserTrafficSamples([
    { assignmentId: 5, endpointId: 22, userId: 2, hostId: 7, bytesIn: 10, bytesOut: 20, recordedAt: AT },
    { assignmentId: 5, endpointId: 22, userId: 2, hostId: 7, bytesIn: 30, bytesOut: 40, recordedAt: AT },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.bytesIn, 40);
  assert.equal(rows[0]?.bytesOut, 60);
  assert.equal(rows[0]?.userId, 2);
});

test("conflicting owner metadata for one assignment is rejected", () => {
  assert.throws(() => aggregateProtocolUserTrafficSamples([
    { assignmentId: 5, endpointId: 22, userId: 2, hostId: 7, bytesOut: 100, recordedAt: AT },
    { assignmentId: 5, endpointId: 22, userId: 3, hostId: 7, bytesOut: 100, recordedAt: AT },
  ]), /协议流量归属冲突/);
});

test("invalid identifiers and zero-byte samples never create accounting rows", () => {
  const rows = aggregateProtocolUserTrafficSamples([
    { assignmentId: 0, endpointId: 22, userId: 2, hostId: 7, bytesOut: 100, recordedAt: AT },
    { assignmentId: 5, endpointId: 22, userId: 2, hostId: 7, bytesIn: 0, bytesOut: 0, recordedAt: AT },
  ]);
  assert.deepEqual(rows, []);
});
