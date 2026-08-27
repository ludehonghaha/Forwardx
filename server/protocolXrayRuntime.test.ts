import assert from "node:assert/strict";
import test from "node:test";
import type { ManagedXrayRuntimePlan } from "./protocolXrayPlan";
import {
  XRAY_BIN,
  XRAY_CONFIG_PATH,
  XRAY_SERVICE_NAME,
  XRAY_VERSION,
  ensureXrayBinaryCmd,
  verifyXrayRuntimeCmd,
  xrayServiceUnit,
} from "./protocolXrayRuntime";

function plan(): ManagedXrayRuntimePlan {
  return {
    sockets: [{ endpointId: 22, protocol: "vless_reality", listenPort: 14285, transport: "tcp" }],
    users: [{
      assignmentId: 5,
      userId: 2,
      email: "forwardx-assignment-5-user-2",
      uuid: "11111111-1111-4111-8111-111111111111",
    }],
    config: {},
  };
}

test("Xray installer pins the expected release and primary Linux assets", () => {
  const command = ensureXrayBinaryCmd();
  assert.equal(XRAY_VERSION, "26.3.27");
  assert.match(command, /Xray-linux-64\.zip/);
  assert.match(command, /Xray-linux-arm64-v8a\.zip/);
  assert.match(command, /XTLS\/Xray-core\/releases\/download\/v26\.3\.27/);
  assert.match(command, new RegExp(XRAY_BIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("Xray service runs the pinned ForwardX binary with the managed config", () => {
  const unit = xrayServiceUnit();
  assert.match(unit, new RegExp(`Description=ForwardX managed Xray Reality`));
  assert.match(unit, new RegExp(`ExecStart=${XRAY_BIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} run -c ${XRAY_CONFIG_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(unit, new RegExp(XRAY_SERVICE_NAME));
});

test("Xray verification tests config and waits for every planned listener", () => {
  const command = verifyXrayRuntimeCmd(plan());
  assert.match(command, /run -test -c/);
  assert.match(command, /14285/);
  assert.match(command, /systemctl is-active/);
  assert.match(command, /ForwardX Xray runtime did not become ready/);
});

test("Xray verification is a no-op when no Reality plan exists", () => {
  assert.equal(verifyXrayRuntimeCmd(null), "true");
});
