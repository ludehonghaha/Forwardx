import assert from "node:assert/strict";
import test from "node:test";
import {
  clearRuleQuotaReservationsForTest,
  managedProtocolBridgeRuleIds,
  reserveRuleCreateQuota,
  ruleQuotaUsageExcludingManagedProtocolBridges,
} from "./ruleQuotaReservations";

test("concurrent rule quota reservations cannot overrun the same user limit", async () => {
  clearRuleQuotaReservationsForTest();
  const input = {
    userId: 7,
    maxRules: 2,
    maxPorts: 0,
    getRuleCount: async () => 1,
    getPortCount: async () => 0,
  };
  const results = await Promise.allSettled([
    reserveRuleCreateQuota(input),
    reserveRuleCreateQuota(input),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["fulfilled", "rejected"]);
  const reservation = results.find((result) => result.status === "fulfilled");
  if (reservation?.status === "fulfilled") await reservation.value.release();
});

test("failed creates release their pending quota for retry", async () => {
  clearRuleQuotaReservationsForTest();
  const input = {
    userId: 8,
    maxRules: 1,
    maxPorts: 1,
    getRuleCount: async () => 0,
    getPortCount: async () => 0,
  };
  const first = await reserveRuleCreateQuota(input);
  await assert.rejects(() => reserveRuleCreateQuota(input), /最大规则数量限制/);
  await first.release();
  const retry = await reserveRuleCreateQuota(input);
  await retry.release();
});

test("managed protocol bridge marker identifies only its linked system rule", () => {
  const ids = managedProtocolBridgeRuleIds([
    {
      forwardRuleId: 41,
      configJson: JSON.stringify({
        _forwardxTrafficBridge: {
          version: 1,
          managed: true,
          ruleId: 41,
          ownerUserId: 9,
          publicPort: 24001,
          listenPort: 25001,
        },
      }),
    },
    {
      forwardRuleId: 42,
      configJson: JSON.stringify({
        _forwardxTrafficBridge: {
          version: 1,
          managed: true,
          ruleId: 999,
        },
      }),
    },
    {
      forwardRuleId: 43,
      configJson: JSON.stringify({ arbitrary: true }),
    },
  ]);
  assert.deepEqual(Array.from(ids), [41]);
});

test("system protocol bridge does not consume ordinary rule or distinct-port quota", () => {
  const usage = ruleQuotaUsageExcludingManagedProtocolBridges([
    { id: 10, sourcePort: 10000, forwardGroupRuleId: null, pendingDelete: false },
    { id: 11, sourcePort: 10000, forwardGroupRuleId: null, pendingDelete: false },
    { id: 12, sourcePort: 20000, forwardGroupRuleId: null, pendingDelete: false },
    { id: 13, sourcePort: 30000, forwardGroupRuleId: 10, pendingDelete: false },
    { id: 14, sourcePort: 40000, forwardGroupRuleId: null, pendingDelete: true },
  ], new Set([11]));
  assert.deepEqual(usage, { rules: 2, ports: 2 });
});
