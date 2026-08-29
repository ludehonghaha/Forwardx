import assert from "node:assert/strict";
import test from "node:test";
import type { ManagedProtocolEndpointRow } from "./protocolRuntimePlan";
import { buildManagedEntryRuntimePlans } from "./protocolManagedRuntimePlans";

const REALITY_UUID = "11111111-1111-4111-8111-111111111111";

function realityEndpoint(): ManagedProtocolEndpointRow {
  return {
    id: 1,
    protocol: "vless_reality",
    runtimeMode: "managed",
    publicPort: 11483,
    isEnabled: true,
    vlessUsers: [{ assignmentId: 7, userId: 2, uuid: REALITY_UUID }],
    configJson: {
      serverName: "www.cloudflare.com",
      realityDest: "www.cloudflare.com:443",
      realityPrivateKey: "private-key-12345678901234567890123456789012",
      realityPublicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      shortId: "0011223344556677",
    },
  };
}

function snellEndpoint(): ManagedProtocolEndpointRow {
  return {
    id: 2,
    protocol: "snell",
    runtimeMode: "managed",
    publicPort: 18080,
    isEnabled: true,
    configJson: { password: "snell-test-password", version: 5, udp: true },
  };
}

test("Reality is owned by Xray and is absent from Mihomo", () => {
  const plans = buildManagedEntryRuntimePlans([realityEndpoint()]);
  assert.ok(plans.xray);
  assert.equal(plans.xray?.sockets.length, 1);
  assert.equal(plans.xray?.sockets[0]?.protocol, "vless_reality");
  assert.equal(plans.mihomo, null);
});

test("Snell remains owned by Mihomo and is absent from Xray", () => {
  const plans = buildManagedEntryRuntimePlans([snellEndpoint()]);
  assert.equal(plans.xray, null);
  assert.ok(plans.mihomo);
  assert.equal(plans.mihomo?.sockets.length, 1);
  assert.equal(plans.mihomo?.sockets[0]?.protocol, "snell");
});

test("mixed endpoints compile into separate runtime plans without duplicate ownership", () => {
  const plans = buildManagedEntryRuntimePlans([realityEndpoint(), snellEndpoint()]);
  assert.ok(plans.xray);
  assert.ok(plans.mihomo);
  assert.deepEqual(plans.xray?.sockets.map((item) => item.endpointId), [1]);
  assert.deepEqual(plans.mihomo?.sockets.map((item) => item.endpointId), [2]);
});
