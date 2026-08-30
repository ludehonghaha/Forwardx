import assert from "node:assert/strict";
import test from "node:test";
import { buildDualMultipathDeploymentPlan } from "./dualMultipathDeploymentPlan";

const validDraft = {
  version: 1 as const,
  state: "draft" as const,
  name: "NoBrand Dual",
  line: {
    id: 1,
    server: "10.66.67.1",
    serverPort: 39000,
    activationThresholdMbps: 120,
    activationWindow: "1s",
    tcpFastOpen: true,
  },
  legs: [
    { role: "private" as const, legIndex: 0 as const, outboundTag: "dedicated", expectedBandwidthMbps: 160, supportsUdp: true },
    { role: "direct" as const, legIndex: 1 as const, outboundTag: "hy2-public", expectedBandwidthMbps: 700, supportsUdp: true },
  ] as const,
};

test("builds a deterministic fail-closed dry-run deployment plan", () => {
  const first = buildDualMultipathDeploymentPlan(validDraft);
  const second = buildDualMultipathDeploymentPlan(validDraft);

  assert.deepEqual(first, second);
  assert.equal(first.mode, "dry-run");
  assert.equal(first.readyToDeploy, false);
  assert.equal(first.listener.port, 39000);
  assert.equal(first.listener.tcpFastOpen, true);
  assert.equal(first.listener.exposureVerified, false);
  assert.equal(first.topology.private, "dedicated");
  assert.equal(first.topology.direct, "hy2-public");
  assert.equal(first.fragments.serverInbound.tcp_fast_open, true);
});

test("keeps unresolved child outbounds, target binding, and listener exposure as explicit blockers", () => {
  const plan = buildDualMultipathDeploymentPlan(validDraft);
  const text = plan.blockers.join("\n");

  assert.match(text, /dedicated/);
  assert.match(text, /hy2-public/);
  assert.match(text, /目标主机/);
  assert.match(text, /不提供认证或加密/);
  assert.match(text, /1c36787d956d750f2ee58d73710d8006a11ccf2c/);
  assert.equal(plan.intendedArtifacts.every((artifact) => artifact.destination === null), true);
});

test("only exposes a non-runnable upstream-native config validation command", () => {
  const plan = buildDualMultipathDeploymentPlan(validDraft);

  assert.deepEqual(plan.proposedChecks, [{
    id: "sing-box-config-check",
    label: "完整配置生成后执行 sing-box 原生校验",
    command: "sing-box check -c <FULL_CONFIG_PATH>",
    runnable: false,
    reason: "当前只有 multipath 片段，尚无包含两个子 outbound 的完整配置文件",
  }]);
  const commands = plan.proposedChecks.map((item) => item.command).join("\n");
  assert.doesNotMatch(commands, /\b(systemctl|service|iptables|nft|docker|rm|mv|cp|install|chmod|chown|curl|wget|sudo)\b/i);
});

test("hard-disables every runtime mutation and unsafe listener channel", () => {
  const plan = buildDualMultipathDeploymentPlan(validDraft);
  assert.deepEqual(plan.safety, {
    agentPush: false,
    commandExecution: false,
    runtimeActivation: false,
    systemdWrite: false,
    firewallMutation: false,
    tunnelMutation: false,
    unauthenticatedPublicListenerAllowed: false,
  });
});

test("rejects invalid drafts instead of producing a partial plan", () => {
  assert.throws(
    () => buildDualMultipathDeploymentPlan({
      ...validDraft,
      legs: [validDraft.legs[0], { ...validDraft.legs[1], outboundTag: "dedicated" }],
    }),
    /必须引用不同的 outbound tag/,
  );
});
