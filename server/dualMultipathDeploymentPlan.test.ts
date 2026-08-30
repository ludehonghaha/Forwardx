import assert from "node:assert/strict";
import test from "node:test";
import { buildDualMultipathDeploymentPlan } from "./dualMultipathDeploymentPlan";

const validDraft = {
  version: 2 as const,
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
  carriers: {
    private: { type: "local-socks5" as const, host: "127.0.0.1" as const, port: 1080 },
    direct: {
      type: "hysteria2" as const,
      server: "dual.example.invalid",
      serverPort: 443,
      tls: { serverName: "dual.example.invalid" },
      authSecretRef: "dual.hy2.auth",
    },
  },
  clientSidecar: { type: "local-socks-sidecar" as const, listen: "127.0.0.1" as const, listenPort: 10808 },
};

test("builds a deterministic fail-closed dry-run deployment plan", () => {
  const first = buildDualMultipathDeploymentPlan(validDraft);
  const second = buildDualMultipathDeploymentPlan(validDraft);

  assert.deepEqual(first, second);
  assert.equal(first.version, 3);
  assert.equal(first.mode, "dry-run");
  assert.equal(first.readyToDeploy, false);
  assert.equal(first.listener.listen, "127.0.0.1");
  assert.equal(first.listener.port, 39000);
  assert.equal(first.listener.tcpFastOpen, true);
  assert.equal(first.listener.exposureVerified, false);
  assert.equal(first.listener.safeDefault, "loopback");
  assert.equal(first.topology.private, "dedicated");
  assert.equal(first.topology.direct, "hy2-public");
  assert.equal(first.fragments.serverPreview.multipathConfig.inbounds[0].tcp_fast_open, true);
  assert.equal(first.fragments.clientConfig.outbounds.length, 3);
});

test("keeps secret resolution, server runtime, target binding, checksums, validation and rollback as blockers", () => {
  const plan = buildDualMultipathDeploymentPlan(validDraft);
  const text = plan.blockers.join("\n");

  assert.match(text, /secret resolver/);
  assert.match(text, /Mieru.*SOCKS5/);
  assert.match(text, /Hysteria2/);
  assert.match(text, /目标主机/);
  assert.match(text, /不提供认证或加密/);
  assert.match(text, /1c36787d956d750f2ee58d73710d8006a11ccf2c/);
  assert.match(text, /sing-box check/);
  assert.match(text, /回滚/);
  assert.equal(plan.intendedArtifacts.every((artifact) => artifact.destination === null), true);
});

test("describes OpenClash as a local SOCKS adapter instead of a native multipath client", () => {
  const plan = buildDualMultipathDeploymentPlan(validDraft);

  assert.deepEqual(plan.clientCompatibility, {
    requiredCore: "singbox-multipath",
    nativeMihomoMultipath: false,
    openClashDirectImport: false,
    recommendedOpenClashAdapter: "local-socks-sidecar",
    explanation: "Dual multipath 是固定 sing-box 分支新增的自定义 outbound；OpenClash/Mihomo 侧应把 sidecar 暴露的本地 SOCKS 当作普通节点，而不是直接解析 multipath outbound。",
  });
  assert.equal(plan.carrierStrategy.privateLeg.localSocksBridgeAllowed, true);
  assert.equal(plan.carrierStrategy.directLeg.authenticatedCarrierRequired, true);
});

test("only exposes a non-runnable upstream-native config validation command", () => {
  const plan = buildDualMultipathDeploymentPlan(validDraft);

  assert.deepEqual(plan.proposedChecks, [{
    id: "sing-box-config-check",
    label: "完整配置生成后执行 sing-box 原生校验",
    command: "sing-box check -c <FULL_CONFIG_PATH>",
    runnable: false,
    reason: "当前配置仍含未解析的 secret placeholder，且尚无已校验 checksum 的 pinned binary 与最终 server runtime config",
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
