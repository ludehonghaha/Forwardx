import assert from "node:assert/strict";
import test from "node:test";
import type { ManagedXrayRuntimePlan } from "./protocolXrayPlan";
import { XRAY_CONFIG_PATH, XRAY_SERVICE_NAME, XRAY_VERSION } from "./protocolXrayRuntime";
import { buildManagedXrayRuntimeSyncAction, XRAY_RUNTIME_FORWARD_TYPE } from "./protocolXrayRuntimeAction";

function runtimePlan(): ManagedXrayRuntimePlan {
  return {
    sockets: [{ endpointId: 22, protocol: "vless_reality", listenPort: 32676, transport: "tcp" }],
    users: [],
    config: {
      log: { loglevel: "warning" },
      stats: {},
      inbounds: [],
      outbounds: [{ tag: "direct", protocol: "freedom" }],
    },
  };
}

test("Xray runtime sync installs, validates, starts and verifies managed Reality", () => {
  const plan = runtimePlan();
  const action = buildManagedXrayRuntimeSyncAction(plan);

  assert.equal(action.statusType, "runtime");
  assert.equal(action.forwardType, XRAY_RUNTIME_FORWARD_TYPE);
  assert.equal(action.forwardType, "xray-runtime-sync");
  assert.equal(action.forceRuntimeSync, true);
  assert.equal(action.protocol, "tcp");
  assert.equal(action.sourcePort, 0);

  assert.equal(action.preCommands.length, 1);
  assert.match(action.preCommands[0], new RegExp(`v${XRAY_VERSION.replaceAll(".", "\\.")}`));
  assert.match(action.preCommands[0], /Xray-linux-64\.zip/);

  assert.equal(action.managedConfigs.length, 1);
  const managed = action.managedConfigs[0];
  assert.equal(managed.path, XRAY_CONFIG_PATH);
  assert.equal(managed.format, "json");
  assert.equal(managed.mode, 0o600);
  assert.equal(managed.serviceName, XRAY_SERVICE_NAME);
  assert.equal(managed.validateCommand, "'/usr/local/bin/forwardx-xray' run -format json -test -c {{path}}");
  assert.deepEqual(JSON.parse(Buffer.from(managed.contentBase64, "base64").toString("utf8")), plan.config);

  const commands = action.commands.join("\n");
  assert.match(commands, /forwardx-xray/);
  assert.match(commands, /systemctl/);
  assert.match(commands, /32676/);
  assert.match(commands, /run -test -c/);
});

test("Xray runtime sync stops and removes stale config when the Agent has no managed Reality", () => {
  const action = buildManagedXrayRuntimeSyncAction(null);

  assert.equal(action.forwardType, "xray-runtime-sync");
  assert.deepEqual(action.preCommands, []);
  assert.deepEqual(action.managedConfigs, []);
  const commands = action.commands.join("\n");
  assert.match(commands, /forwardx-xray/);
  assert.match(commands, /stop/);
  assert.match(commands, new RegExp(XRAY_CONFIG_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(commands, /rm -f/);
  assert.doesNotMatch(commands, /run -test -c/);
  assert.doesNotMatch(commands, /Xray-linux-64\.zip/);
});