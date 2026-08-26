import assert from "node:assert/strict";
import test from "node:test";
import "./protocolXrayPlan.test";
import "./protocolManagedRuntimePlans.test";
import "./protocolXrayRuntime.test";
import "./protocolXrayRuntimeAction.test";
import "./repositories/protocolUserTrafficRepository.test";
import "../shared/agentDtos.test";
import type { ProtocolFeedEntry } from "../shared/protocolAccess";
import type { ManagedProtocolEndpointRow } from "./protocolRuntimePlan";
import { buildManagedXrayRuntimePlan } from "./protocolXrayPlan";
import { renderProtocolMihomoSubscription, renderProtocolUriSubscription } from "./protocolSubscription";

const LEGACY = "550e8400-e29b-41d4-a716-446655440000";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

function runtimeEndpoint(users: ManagedProtocolEndpointRow["vlessUsers"]): ManagedProtocolEndpointRow {
  return {
    id: 22,
    protocol: "vless_reality",
    runtimeMode: "managed",
    publicPort: 32676,
    isEnabled: true,
    vlessUsers: users,
    configJson: {
      uuid: LEGACY,
      serverName: "www.cloudflare.com",
      realityDest: "www.cloudflare.com:443",
      realityPrivateKey: "private-key-12345678901234567890123456789012",
      realityPublicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      shortId: "0011223344556677",
      clientFingerprint: "chrome",
      udp: true,
    },
  };
}

function feedEntry(assignmentId: number, uuid: string): ProtocolFeedEntry {
  return {
    assignmentId,
    endpointId: 22,
    name: "66云 Reality",
    protocol: "vless_reality",
    publicHost: "154.36.134.45",
    publicPort: 32676,
    endpointConfig: {
      uuid: LEGACY,
      serverName: "www.cloudflare.com",
      realityDest: "www.cloudflare.com:443",
      realityPublicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      shortId: "0011223344556677",
      clientFingerprint: "chrome",
      udp: true,
    },
    credential: { uuid },
  };
}

function realityUsers(plan: ReturnType<typeof buildManagedXrayRuntimePlan>) {
  const inbound = (plan?.config.inbounds as any[])?.find((item) => item?.protocol === "vless");
  return (inbound?.settings?.users || []) as Array<{ id: string; level: number; email: string; flow: string }>;
}

test("managed Reality runtime uses assignment UUIDs instead of the endpoint UUID", () => {
  const plan = buildManagedXrayRuntimePlan([runtimeEndpoint([
    { assignmentId: 5, userId: 2, uuid: USER_A },
    { assignmentId: 6, userId: 3, uuid: USER_B },
  ])]);
  assert.ok(plan);
  assert.deepEqual(realityUsers(plan), [
    { id: USER_A, level: 0, email: "forwardx-assignment-5-user-2", flow: "xtls-rprx-vision" },
    { id: USER_B, level: 0, email: "forwardx-assignment-6-user-3", flow: "xtls-rprx-vision" },
  ]);
  assert.equal(JSON.stringify(plan).includes(LEGACY), false);
});

test("revoking one Reality assignment removes only that UUID from desired state", () => {
  const plan = buildManagedXrayRuntimePlan([runtimeEndpoint([
    { assignmentId: 6, userId: 3, uuid: USER_B },
  ])]);
  assert.ok(plan);
  assert.deepEqual(realityUsers(plan).map((item) => item.id), [USER_B]);
  assert.equal(JSON.stringify(plan).includes(USER_A), false);
  assert.equal(JSON.stringify(plan).includes(LEGACY), false);
});

test("managed Reality with no enabled assignments uses a private stable parking UUID", () => {
  const first = buildManagedXrayRuntimePlan([runtimeEndpoint([])]);
  const second = buildManagedXrayRuntimePlan([runtimeEndpoint([])]);
  assert.ok(first);
  assert.ok(second);
  const firstUsers = realityUsers(first);
  const secondUsers = realityUsers(second);
  assert.equal(firstUsers.length, 1);
  assert.equal(firstUsers[0]?.email, "forwardx-parking-22");
  assert.notEqual(firstUsers[0]?.id, LEGACY);
  assert.notEqual(firstUsers[0]?.id, USER_A);
  assert.equal(firstUsers[0]?.id, secondUsers[0]?.id);
  assert.equal(JSON.stringify(first).includes(LEGACY), false);
});

test("Reality subscriptions use each assignment UUID", () => {
  const a = feedEntry(5, USER_A);
  const b = feedEntry(6, USER_B);

  const uriA = Buffer.from(renderProtocolUriSubscription([a]).content, "base64").toString("utf8");
  const uriB = Buffer.from(renderProtocolUriSubscription([b]).content, "base64").toString("utf8");
  assert.match(uriA, new RegExp(`^vless://${USER_A}@`));
  assert.match(uriB, new RegExp(`^vless://${USER_B}@`));
  assert.doesNotMatch(uriA, new RegExp(LEGACY));
  assert.doesNotMatch(uriB, new RegExp(LEGACY));

  const mihomoA = renderProtocolMihomoSubscription([a]);
  const mihomoB = renderProtocolMihomoSubscription([b]);
  assert.match(mihomoA.content, new RegExp(`uuid: \\"${USER_A}\\"`));
  assert.match(mihomoB.content, new RegExp(`uuid: \\"${USER_B}\\"`));
});