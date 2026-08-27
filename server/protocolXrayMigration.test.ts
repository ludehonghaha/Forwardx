import assert from "node:assert/strict";
import test from "node:test";
import type { ManagedXrayRuntimePlan } from "./protocolXrayPlan";
import {
  AGENT_XRAY_RUNTIME_VERSION,
  agentSupportsManagedXrayRuntime,
  managedXrayRuntimeNeedsApply,
  shouldDeferXrayForMihomoRealityHandoff,
} from "./protocolXrayMigration";

function plan(port = 24567): ManagedXrayRuntimePlan {
  return {
    sockets: [{ endpointId: 7, protocol: "vless_reality", listenPort: port, transport: "tcp" }],
    users: [],
    config: {},
  };
}

test("managed Xray stays gated to Agent 2.2.196+", () => {
  assert.equal(AGENT_XRAY_RUNTIME_VERSION, "2.2.196");
  assert.equal(agentSupportsManagedXrayRuntime("2.2.195"), false);
  assert.equal(agentSupportsManagedXrayRuntime("2.2.196"), true);
  assert.equal(agentSupportsManagedXrayRuntime("2.3.0"), true);
});

test("defers Xray while the legacy Mihomo Reality TCP listener still owns the port", () => {
  assert.equal(shouldDeferXrayForMihomoRealityHandoff(plan(), {
    listeners: [{ runtime: "mihomo", port: 24567, protocol: "tcp", ready: true }],
  }), true);
});

test("allows Xray after Mihomo releases the Reality port", () => {
  assert.equal(shouldDeferXrayForMihomoRealityHandoff(plan(), {
    listeners: [{ runtime: "mihomo", port: 24567, protocol: "tcp", ready: false }],
  }), false);
  assert.equal(shouldDeferXrayForMihomoRealityHandoff(plan(), {
    listeners: [{ runtime: "mihomo", port: 24568, protocol: "tcp", ready: true }],
  }), false);
  assert.equal(shouldDeferXrayForMihomoRealityHandoff(plan(), {
    listeners: [{ runtime: "xray", port: 24567, protocol: "tcp", ready: true }],
  }), false);
});

test("second phase keeps applying until every desired Xray listener is ready", () => {
  assert.equal(managedXrayRuntimeNeedsApply(plan(), null), true);
  assert.equal(managedXrayRuntimeNeedsApply(plan(), { listeners: [] }), true);
  assert.equal(managedXrayRuntimeNeedsApply(plan(), {
    listeners: [{ runtime: "xray", port: 24567, protocol: "tcp", ready: false }],
  }), true);
  assert.equal(managedXrayRuntimeNeedsApply(plan(), {
    listeners: [{ runtime: "xray", port: 24567, protocol: "tcp", ready: true }],
  }), false);
});
