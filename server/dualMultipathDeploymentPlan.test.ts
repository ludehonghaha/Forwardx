import assert from "node:assert/strict";
import test from "node:test";
import { defaultDualMultipathInfrastructure } from "./dualMultipathControlPlane";
import { buildDualMultipathDeploymentPlan } from "./dualMultipathDeploymentPlan";

const infrastructure = defaultDualMultipathInfrastructure();
const validDraft = {
  version: 3 as const,
  state: "draft" as const,
  name: "NoBrand Dual",
  ...infrastructure,
  line: { id: 1, server: "127.0.0.1", serverPort: 39000, listen: "127.0.0.1" as const, activationThresholdMbps: 120, activationWindow: "1s", tcpFastOpen: true },
  legs: [
    { role: "private" as const, legIndex: 0 as const, outboundTag: "forwardx-private-mieru", expectedBandwidthMbps: 200, supportsUdp: true },
    { role: "direct" as const, legIndex: 1 as const, outboundTag: "forwardx-direct-hy2", expectedBandwidthMbps: 1000, supportsUdp: true },
  ] as const,
};

test("builds a deterministic fail-closed v4 dry-run plan", () => {
  const first = buildDualMultipathDeploymentPlan(validDraft);
  const second = buildDualMultipathDeploymentPlan(validDraft);
  assert.deepEqual(first, second);
  assert.equal(first.version, 4);
  assert.equal(first.mode, "dry-run");
  assert.equal(first.readyToDeploy, false);
  assert.equal(first.listener.listen, "127.0.0.1");
  assert.equal(first.listener.port, 39000);
  assert.equal(first.fragments.mihomoPrivateListener?.listeners[0].listen, "127.0.0.1");
  assert.equal(first.fragments.clientConfig.outbounds.length, 3);
});

test("keeps unresolved private and HY2 runtimes as explicit blockers", () => {
  const plan = buildDualMultipathDeploymentPlan(validDraft);
  const text = plan.blockers.join("\n");
  assert.match(text, /secret resolver/);
  assert.match(text, /端口占用检查与自动规划/);
  assert.match(text, /private carrier bridge/);
  assert.match(text, /Hysteria2 端口/);
  assert.match(text, /Mihomo dedicated listener/);
  assert.match(text, /with_quic/);
  assert.match(text, /不提供认证或加密/);
  assert.match(text, /sing-box check/);
  assert.match(text, /回滚/);
  assert.equal(plan.intendedArtifacts.every((artifact) => artifact.destination === null), true);
});

test("never treats unresolved auto client ports as deploy-ready", () => {
  const plan = buildDualMultipathDeploymentPlan(validDraft);
  assert.equal(validDraft.openClashIngressAdapter.portStrategy, "auto");
  assert.equal(validDraft.openClashIngressAdapter.port, null);
  assert.equal(plan.readyToDeploy, false);
  assert.match(plan.blockers.join("\n"), /端口占用检查与自动规划/);
});

test("models OpenClash ingress, dedicated Mihomo bridge and native HY2 in one ForwardX plan", () => {
  const plan = buildDualMultipathDeploymentPlan(validDraft);
  assert.equal(plan.clientCompatibility.recommendedOpenClashAdapter, "local-socks-sidecar");
  assert.equal(plan.carrierStrategy.privateLeg.preferredBridge, "mihomo-dedicated-listener");
  assert.equal(plan.carrierStrategy.directLeg.nativeHysteria2InPinnedArtifact, true);
  assert.equal(plan.carrierStrategy.directLeg.requiredBuildTag, "with_quic");
  assert.equal(plan.carrierStrategy.directLeg.separateHysteriaBinaryRequired, false);
  assert.equal(plan.carrierStrategy.directLeg.bindInterface, "eth0");
  assert.equal(plan.carrierStrategy.directLeg.runtimeStatus, "unresolved");
});

test("only exposes a non-runnable native config check", () => {
  const plan = buildDualMultipathDeploymentPlan(validDraft);
  assert.equal(plan.proposedChecks[0].command, "sing-box check -c <FULL_CONFIG_PATH>");
  assert.equal(plan.proposedChecks[0].runnable, false);
  assert.doesNotMatch(plan.proposedChecks[0].command, /\b(systemctl|iptables|nft|install|curl|wget|sudo)\b/i);
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

test("rejects invalid drafts instead of producing partial plans", () => {
  assert.throws(() => buildDualMultipathDeploymentPlan({
    ...validDraft,
    line: { ...validDraft.line, listen: "0.0.0.0" },
  }), /回环监听/);
});
