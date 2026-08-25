import assert from "node:assert/strict";
import test from "node:test";
import {
  managedVlessCredentialForWrite,
  planManagedVlessCredentialBackfill,
} from "./protocolVlessCredentials";

const LEGACY = "550e8400-e29b-41d4-a716-446655440000";
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

function sequence(...values: string[]) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] || USER_B;
}

test("legacy managed VLESS assignments are backfilled to distinct stable UUIDs", () => {
  const first = planManagedVlessCredentialBackfill(LEGACY, [
    { id: 1, credentialJson: {} },
    { id: 2, credentialJson: {} },
  ], sequence(USER_A, USER_B));

  assert.equal(first[0]?.credential.uuid, LEGACY);
  assert.equal(first[1]?.credential.uuid, USER_A);
  assert.notEqual(first[0]?.credential.uuid, first[1]?.credential.uuid);
  assert.deepEqual(first.map((item) => item.changed), [true, true]);

  const second = planManagedVlessCredentialBackfill(LEGACY, first.map((item) => ({
    id: item.id,
    credentialJson: item.credential,
  })), sequence(USER_B));
  assert.deepEqual(second.map((item) => item.changed), [false, false]);
  assert.deepEqual(second.map((item) => item.credential.uuid), [LEGACY, USER_A]);
});

test("duplicate legacy UUIDs are healed without rotating the first valid assignment", () => {
  const plan = planManagedVlessCredentialBackfill(LEGACY, [
    { id: 1, credentialJson: { uuid: USER_A } },
    { id: 2, credentialJson: { uuid: USER_A } },
  ], sequence(USER_B));
  assert.equal(plan[0]?.credential.uuid, USER_A);
  assert.equal(plan[0]?.changed, false);
  assert.equal(plan[1]?.credential.uuid, LEGACY);
  assert.equal(plan[1]?.changed, true);
});

test("disable and re-enable style writes preserve an assignment UUID", () => {
  const created = managedVlessCredentialForWrite({}, {}, [], sequence(USER_A));
  const disabled = managedVlessCredentialForWrite(created, {}, [], sequence(USER_B));
  const reenabled = managedVlessCredentialForWrite(disabled, { uuid: USER_B }, [], sequence(USER_B));
  assert.equal(created.uuid, USER_A);
  assert.equal(disabled.uuid, USER_A);
  assert.equal(reenabled.uuid, USER_A);
});
