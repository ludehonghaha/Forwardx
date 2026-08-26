import assert from "node:assert/strict";
import test from "node:test";
import { planManagedMieruCredentialBackfill } from "./protocolMieruCredentials";

const endpointConfig = { username: "legacy-user", password: "legacy-password" };

test("managed Mieru keeps the first legacy credential and creates unique later credentials", () => {
  const generated = ["generated-a", "generated-b"];
  const planned = planManagedMieruCredentialBackfill(endpointConfig, [
    { id: 10, userId: 7, credentialJson: {} },
    { id: 11, userId: 8, credentialJson: {} },
  ], () => generated.shift() || "fallback");

  assert.deepEqual(planned.map((item) => ({
    id: item.id,
    userId: item.userId,
    username: item.credential.username,
    password: item.credential.password,
    changed: item.changed,
  })), [
    { id: 10, userId: 7, username: "legacy-user", password: "legacy-password", changed: true },
    { id: 11, userId: 8, username: "forwardx-8-11", password: "generated-a", changed: true },
  ]);
});

test("managed Mieru preserves already unique assignment credentials", () => {
  const planned = planManagedMieruCredentialBackfill(endpointConfig, [
    { id: 10, userId: 7, credentialJson: { username: "alice", password: "alice-secret", label: "keep" } },
    { id: 11, userId: 8, credentialJson: { username: "bob", password: "bob-secret" } },
  ], () => "unused");

  assert.equal(planned[0]?.changed, false);
  assert.equal(planned[1]?.changed, false);
  assert.equal(planned[0]?.credential.label, "keep");
});

test("managed Mieru replaces duplicate usernames and passwords instead of sharing accounting identity", () => {
  const generated = ["replacement-secret"];
  const planned = planManagedMieruCredentialBackfill(endpointConfig, [
    { id: 10, userId: 7, credentialJson: { username: "same", password: "same-secret" } },
    { id: 11, userId: 8, credentialJson: { username: "same", password: "same-secret" } },
  ], () => generated.shift() || "fallback");

  assert.equal(planned[0]?.credential.username, "same");
  assert.equal(planned[0]?.credential.password, "same-secret");
  assert.equal(planned[1]?.credential.username, "forwardx-8-11");
  assert.equal(planned[1]?.credential.password, "replacement-secret");
  assert.equal(planned[1]?.changed, true);
});
