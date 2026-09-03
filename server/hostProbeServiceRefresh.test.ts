import assert from "node:assert/strict";
import test from "node:test";
import {
  hostProbeMeasurementIdentityChanged,
  hostProbeRefreshHostIds,
  hostProbeServiceAppliesToHost,
} from "./repositories/hostProbeServiceRepository";

test("probe service refresh follows specific and exclude scopes", () => {
  const hostIds = [1, 2, 3, 4, 5];

  assert.deepEqual(hostProbeRefreshHostIds([
    {
      isEnabled: true,
      hostScope: "specific",
      hostIds: [2, 4],
      excludeHostIds: [],
    },
  ], hostIds), [2, 4]);

  assert.deepEqual(hostProbeRefreshHostIds([
    {
      isEnabled: true,
      hostScope: "exclude",
      hostIds: [],
      excludeHostIds: [2, 5],
    },
  ], hostIds), [1, 3, 4]);
});

test("probe service update refreshes the union of old and new host scopes", () => {
  const previous = {
    isEnabled: true,
    hostScope: "specific",
    hostIds: [2],
    excludeHostIds: [],
  };
  const next = {
    isEnabled: true,
    hostScope: "specific",
    hostIds: [3, 4],
    excludeHostIds: [],
  };

  assert.deepEqual(hostProbeRefreshHostIds([previous, next], [1, 2, 3, 4]), [2, 3, 4]);
});

test("disabled probe services do not wake unrelated Agents", () => {
  const disabled = {
    isEnabled: false,
    hostScope: "all",
    hostIds: [],
    excludeHostIds: [],
  };

  assert.equal(hostProbeServiceAppliesToHost(disabled, 1), false);
  assert.deepEqual(hostProbeRefreshHostIds([disabled], [1, 2, 3]), []);
});

test("probe history resets only when the measurement identity changes", () => {
  const base = {
    name: "上海联通 CU",
    method: "tcping",
    targetIp: "210.22.84.3",
    targetPort: 53,
    intervalSeconds: 60,
    hostScope: "specific",
    hostIds: [1, 2],
    isEnabled: true,
  };

  assert.equal(hostProbeMeasurementIdentityChanged(base, { ...base, name: "CU" }), false);
  assert.equal(hostProbeMeasurementIdentityChanged(base, { ...base, intervalSeconds: 120 }), false);
  assert.equal(hostProbeMeasurementIdentityChanged(base, { ...base, hostIds: [2, 3] }), false);
  assert.equal(hostProbeMeasurementIdentityChanged(base, { ...base, isEnabled: false }), false);

  assert.equal(hostProbeMeasurementIdentityChanged(base, { ...base, method: "ping", targetPort: null }), true);
  assert.equal(hostProbeMeasurementIdentityChanged(base, { ...base, targetIp: "210.22.84.4" }), true);
  assert.equal(hostProbeMeasurementIdentityChanged(base, { ...base, targetPort: 443 }), true);
});

test("Ping identity ignores an irrelevant target port and normalizes target text", () => {
  const previous = {
    method: "ping",
    targetIp: " Example.COM ",
    targetPort: null,
  };
  const next = {
    method: "ping",
    targetIp: "example.com",
    targetPort: 443,
  };

  assert.equal(hostProbeMeasurementIdentityChanged(previous, next), false);
});
