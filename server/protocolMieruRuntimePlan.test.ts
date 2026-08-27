import assert from "node:assert/strict";
import test from "node:test";
import {
  buildManagedMieruRuntimePlan,
  type ManagedProtocolEndpointRow,
} from "./protocolRuntimePlan";

function managedMieruEndpoint(overrides: Partial<ManagedProtocolEndpointRow> = {}): ManagedProtocolEndpointRow {
  return {
    id: 7,
    protocol: "mieru",
    runtimeMode: "managed",
    publicPort: 27075,
    configJson: {
      username: "legacy-user",
      password: "legacy-password",
      listenPort: 27075,
      transport: "TCP",
      mtu: 1400,
    },
    isEnabled: true,
    ...overrides,
  };
}

test("managed Mieru compiles two assignments into one listener with isolated credentials", () => {
  const plan = buildManagedMieruRuntimePlan([managedMieruEndpoint({
    mieruUsers: [
      { assignmentId: 101, userId: 1, username: "legacy-user", password: "legacy-password" },
      { assignmentId: 102, userId: 2, username: "forwardx-u2", password: "second-password" },
    ],
  })]);

  assert.ok(plan);
  assert.equal(plan?.endpointId, 7);
  assert.equal(plan?.listenPort, 27075);
  assert.equal(plan?.config.portBindings.length, 1);
  assert.deepEqual(plan?.config.portBindings, [{ port: 27075, protocol: "TCP" }]);
  assert.deepEqual(plan?.config.users, [
    { name: "legacy-user", password: "legacy-password" },
    { name: "forwardx-u2", password: "second-password" },
  ]);
});

test("managed Mieru rejects duplicate usernames or passwords across assignments", () => {
  assert.equal(buildManagedMieruRuntimePlan([managedMieruEndpoint({
    mieruUsers: [
      { assignmentId: 101, userId: 1, username: "same-user", password: "password-a" },
      { assignmentId: 102, userId: 2, username: "same-user", password: "password-b" },
    ],
  })]), null);

  assert.equal(buildManagedMieruRuntimePlan([managedMieruEndpoint({
    mieruUsers: [
      { assignmentId: 101, userId: 1, username: "user-a", password: "same-password" },
      { assignmentId: 102, userId: 2, username: "user-b", password: "same-password" },
    ],
  })]), null);
});

test("authoritative empty assignment list compiles no Mieru users instead of falling back to legacy credentials", () => {
  const plan = buildManagedMieruRuntimePlan([managedMieruEndpoint({ mieruUsers: [] })]);
  assert.ok(plan);
  assert.deepEqual(plan?.config.users, []);
});
