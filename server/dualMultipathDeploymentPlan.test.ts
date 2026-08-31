import assert from "node:assert/strict";
import test from "node:test";
import { defaultDualMultipathInfrastructure } from "./dualMultipathControlPlane";
import { buildDualMultipathDeploymentPlan } from "./dualMultipathDeploymentPlan";

const infrastructure = defaultDualMultipathInfrastructure();
const clientRef = { kind: "external-openwrt" as const, targetKey: "dual-client:openwrt:plan-test" };
const evidence = { snapshotId: "snapshot-port-only", clientTargetRef: clientRef };
const validDraft = {
  version: 5 as const,
  state: "draft" as const,
  name: "NoBrand Dual",
  ...infrastructure,
  line: { id: 1, server: "127.0.0.1", serverPort: 39000, listen: "127.0.0.1" as const, activationThresholdMbps: 120, activationWindow: "1s", tcpFastOpen: true },
  legs: [
    { role: "private" as const, legIndex: 0 as const, outboundTag: "forwardx-private-mieru", expectedBandwidthMbps: 200, supportsUdp: true },
    { role: "direct" as const, legIndex: 1 as const, outboundTag: "forwardx-direct-hy2", expectedBandwidthMbps: 1000, supportsUdp: true },
  ] as const,
  clientTarget: { status: "bound" as const, ref: clientRef },
};

test("builds a deterministic fail-closed v6 dry-run plan", () => {
  const first = buildDualMultipathDeploymentPlan(validDraft);
  const second = buildDualMultipathDeploymentPlan(validDraft);
  assert.deepEqual(first, second);
  assert.equal(first.version, 6);
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
  assert.match(text, /Dual ingress.*availability snapshot/);
  assert.match(text, /Mihomo dedicated listener.*availability snapshot/);
  assert.match(text, /单一纯 Mieru proxy/);
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
  assert.equal(validDraft.openClashIngressAdapter.portPlanning.strategy, "auto");
  assert.equal(validDraft.openClashIngressAdapter.portPlanning.port, null);
  assert.equal(plan.readyToDeploy, false);
  assert.match(plan.blockers.join("\n"), /availability snapshot/);
});

test("reports proxy discovery and dedicated listener port blockers independently", () => {
  if (validDraft.privateCarrierBridge.type !== "mihomo-dedicated-listener") throw new Error("expected Mihomo bridge");
  const portOnly = buildDualMultipathDeploymentPlan({
    ...validDraft,
    privateCarrierBridge: {
      ...validDraft.privateCarrierBridge,
      listener: {
        ...validDraft.privateCarrierBridge.listener,
        portPlanning: { status: "planned-read-only", strategy: "auto", port: 23181, evidence },
      },
    },
  });
  assert.doesNotMatch(portOnly.blockers.join("\n"), /Mihomo dedicated listener loopback 端口/);
  assert.match(portOnly.blockers.join("\n"), /单一纯 Mieru proxy/);

  const proxyOnly = buildDualMultipathDeploymentPlan({
    ...validDraft,
    privateCarrierBridge: {
      ...validDraft.privateCarrierBridge,
      target: {
        ...validDraft.privateCarrierBridge.target,
        discovery: { status: "verified-read-only", proxyRef: "Pure-Mieru", evidence },
      },
    },
  });
  assert.match(proxyOnly.blockers.join("\n"), /Mihomo dedicated listener loopback 端口/);
  assert.doesNotMatch(proxyOnly.blockers.join("\n"), /单一纯 Mieru proxy/);
  assert.equal(portOnly.readyToDeploy, false);
  assert.equal(proxyOnly.readyToDeploy, false);
});

test("reports client target, missing, stale, mismatch and ambiguous snapshot blockers precisely", () => {
  const unbound = buildDualMultipathDeploymentPlan({ ...validDraft, clientTarget: { status: "unresolved" } });
  assert.match(unbound.blockers.join("\n"), /Client target 未绑定/);
  const missing = buildDualMultipathDeploymentPlan(validDraft);
  assert.match(missing.blockers.join("\n"), /Client discovery snapshot 缺失/);
  const stale = buildDualMultipathDeploymentPlan(validDraft, { blockerCodes: ["client-snapshot-stale"] });
  assert.match(stale.blockers.join("\n"), /snapshot 已过期/);
  const mismatch = buildDualMultipathDeploymentPlan(validDraft, { blockerCodes: ["client-snapshot-mismatch"] });
  assert.match(mismatch.blockers.join("\n"), /target 与当前绑定不一致/);
  const ambiguous = buildDualMultipathDeploymentPlan(validDraft, { blockerCodes: ["pure-mieru-ambiguous"] });
  assert.match(ambiguous.blockers.join("\n"), /存在多个候选/);
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
