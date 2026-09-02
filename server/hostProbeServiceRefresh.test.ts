import assert from "node:assert/strict";
import test from "node:test";
import {
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
