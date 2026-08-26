import assert from "node:assert/strict";
import test from "node:test";
import type { ManagedProtocolEndpointRow } from "./protocolRuntimePlan";
import { buildManagedXrayRuntimePlan } from "./protocolXrayPlan";

const LEGACY = "550e8400-e29b-41d4-a716-446655440000";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const PRIVATE_KEY = "private-key-12345678901234567890123456789012";

function endpoint(users: ManagedProtocolEndpointRow["vlessUsers"]): ManagedProtocolEndpointRow {
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
      realityPrivateKey: PRIVATE_KEY,
      realityPublicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      shortId: "0011223344556677",
      clientFingerprint: "chrome",
      udp: true,
    },
  };
}

function realityInbound(plan: ReturnType<typeof buildManagedXrayRuntimePlan>) {
  return (plan?.config.inbounds as any[])?.find((item) => item?.protocol === "vless");
}

test("Xray Reality compiles multiple ForwardX assignments into one listener", () => {
  const plan = buildManagedXrayRuntimePlan([endpoint([
    { assignmentId: 5, userId: 2, uuid: USER_A },
    { assignmentId: 6, userId: 3, uuid: USER_B },
  ])]);
  assert.ok(plan);
  assert.deepEqual(plan.users, [
    { assignmentId: 5, userId: 2, email: "forwardx-assignment-5-user-2", uuid: USER_A },
    { assignmentId: 6, userId: 3, email: "forwardx-assignment-6-user-3", uuid: USER_B },
  ]);
  const inbound = realityInbound(plan);
  assert.ok(inbound);
  assert.equal(inbound.port, 32676);
  assert.deepEqual(inbound.settings.users, [
    { id: USER_A, level: 0, email: "forwardx-assignment-5-user-2", flow: "xtls-rprx-vision" },
    { id: USER_B, level: 0, email: "forwardx-assignment-6-user-3", flow: "xtls-rprx-vision" },
  ]);
  assert.equal(JSON.stringify(plan).includes(LEGACY), false);
});

test("Xray Reality preserves cross-client compatibility and current REALITY field names", () => {
  const plan = buildManagedXrayRuntimePlan([endpoint([
    { assignmentId: 5, userId: 2, uuid: USER_A },
  ])]);
  assert.ok(plan);
  const inbound = realityInbound(plan);
  assert.ok(inbound);
  assert.equal(inbound.streamSettings.method, "raw");
  assert.equal(inbound.streamSettings.security, "reality");
  assert.deepEqual(inbound.streamSettings.realitySettings, {
    show: false,
    target: "www.cloudflare.com:443",
    xver: 0,
    serverNames: ["www.cloudflare.com"],
    privateKey: PRIVATE_KEY,
    minClientVer: "0",
    maxClientVer: "",
    maxTimeDiff: 0,
    shortIds: ["0011223344556677"],
  });
  assert.equal((plan.config.policy as any).levels["0"].statsUserUplink, true);
  assert.equal((plan.config.policy as any).levels["0"].statsUserDownlink, true);
});

test("Xray Reality with no enabled assignments uses a deterministic private parking UUID", () => {
  const first = buildManagedXrayRuntimePlan([endpoint([])]);
  const second = buildManagedXrayRuntimePlan([endpoint([])]);
  assert.ok(first);
  assert.ok(second);
  const firstUsers = realityInbound(first).settings.users;
  const secondUsers = realityInbound(second).settings.users;
  assert.equal(firstUsers.length, 1);
  assert.equal(firstUsers[0].email, "forwardx-parking-22");
  assert.equal(firstUsers[0].id, secondUsers[0].id);
  assert.notEqual(firstUsers[0].id, LEGACY);
  assert.notEqual(firstUsers[0].id, USER_A);
  assert.deepEqual(first.users, []);
});

test("Xray Reality rejects duplicate UUIDs instead of compiling ambiguous accounting identities", () => {
  const plan = buildManagedXrayRuntimePlan([endpoint([
    { assignmentId: 5, userId: 2, uuid: USER_A },
    { assignmentId: 6, userId: 3, uuid: USER_A },
  ])]);
  assert.equal(plan, null);
});
