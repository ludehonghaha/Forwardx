import assert from "node:assert/strict";
import test from "node:test";
import {
  DUAL_MULTIPATH_DRAFT_SETTING_KEY,
  LEGACY_DUAL_MULTIPATH_DRAFT_SETTING_KEY,
  LEGACY_DUAL_MULTIPATH_V2_DRAFT_SETTING_KEY,
  LEGACY_DUAL_MULTIPATH_V3_DRAFT_SETTING_KEY,
  LEGACY_DUAL_MULTIPATH_V4_DRAFT_SETTING_KEY,
  compileDualMultipathPreview,
  defaultDualMultipathInfrastructure,
  loadDualMultipathDraft,
  parseDualMultipathDraft,
  saveDualMultipathDraft,
  type DualMultipathSettingsStore,
} from "./dualMultipathControlPlane";
import { createDefaultDualMultipathInfrastructure, type DualServerTargetDiscoverySnapshot } from "../shared/dualMultipath";

const infrastructure = defaultDualMultipathInfrastructure();
const clientRef = { kind: "external-openwrt" as const, targetKey: "dual-client:openwrt:test-main" };
const evidence = { snapshotId: "snapshot-draft", clientTargetRef: clientRef };
const legacyMihomoBridge = {
  type: "mihomo-dedicated-listener" as const,
  listener: {
    kind: "socks" as const,
    scope: "dedicated" as const,
    listen: "127.0.0.1" as const,
    portPlanning: { status: "planned-read-only" as const, strategy: "auto" as const, port: 24081, evidence },
  },
  target: {
    selection: "single-proxy" as const,
    protocol: "mieru" as const,
    discovery: { status: "verified-read-only" as const, proxyRef: "NoBrand-Private-Mieru", evidence },
    routing: "fixed-proxy" as const,
    fallback: "none" as const,
    transportScope: "private-only" as const,
  },
};
const draftInput = {
  version: 5 as const,
  state: "draft" as const,
  name: "NoBrand Dual",
  ...infrastructure,
  line: { id: 1, server: "127.0.0.1", serverPort: 39000, listen: "127.0.0.1" as const, activationThresholdMbps: 120 },
  legs: [
    { role: "private" as const, legIndex: 0 as const, outboundTag: "forwardx-private-mieru", expectedBandwidthMbps: 200, supportsUdp: true },
    { role: "direct" as const, legIndex: 1 as const, outboundTag: "forwardx-direct-hy2", expectedBandwidthMbps: 1000, supportsUdp: true },
  ] as const,
  clientTarget: { status: "bound" as const, ref: clientRef },
  openClashIngressAdapter: {
    ...infrastructure.openClashIngressAdapter,
    portPlanning: { status: "planned-read-only" as const, strategy: "auto" as const, port: 24080, evidence },
  },
  privateCarrierBridge: {
    ...legacyMihomoBridge,
  },
  directCarrier: {
    ...infrastructure.directCarrier,
    status: "resolved" as const,
    serverPort: 443,
    tls: { serverName: "dual.example.invalid" },
  },
};

function memoryStore() {
  const values = new Map<string, string | null>();
  const calls: Array<{ method: string; key: string; value?: string | null }> = [];
  const store: DualMultipathSettingsStore = {
    async getSetting(key) { calls.push({ method: "getSetting", key }); return values.get(key) ?? null; },
    async setSetting(key, value) { calls.push({ method: "setSetting", key, value }); values.set(key, value); },
  };
  return { store, calls, values };
}

test("accepts the v5 one-panel Dual model with separate server and client targets", () => {
  const parsed = parseDualMultipathDraft(draftInput);
  assert.equal(parsed.version, 5);
  assert.equal(parsed.serverTargetDiscovery.targetId, "nobrand-dual-current");
  assert.deepEqual(parsed.clientTarget, { status: "bound", ref: clientRef });
  assert.equal(parsed.openClashIngressAdapter.type, "local-socks-sidecar");
  assert.equal(parsed.privateCarrierBridge.type, "mihomo-dedicated-listener");
  assert.equal(parsed.line.listen, "127.0.0.1");
  assert.equal(parsed.line.serverPort, 39000);
});

test("does not accept a server discovery object as a client target reference", () => {
  assert.throws(() => parseDualMultipathDraft({
    ...draftInput,
    clientTarget: { status: "bound", ref: draftInput.serverTargetDiscovery },
  }), /配置无效/);
});

test("does not default or emit the rejected 127.0.0.1:1080 private endpoint", () => {
  const defaults = defaultDualMultipathInfrastructure();
  const serialized = JSON.stringify(defaults);
  assert.doesNotMatch(serialized, /1080/);
  assert.equal(defaults.privateCarrierBridge.type, "forwardx-managed-mieru-sidecar");
  assert.equal(defaults.privateCarrierBridge.runtime.clashMiDependency, false);
  assert.equal(defaults.privateCarrierBridge.carrier.endpointSource, "verified-client-visible-discovery");
  assert.equal(defaults.privateCarrierBridge.carrier.usernameSecretRef, "dual.mieru.username");
  assert.equal(defaults.privateCarrierBridge.listener.portPlanning.strategy, "auto");
  assert.equal(defaults.privateCarrierBridge.listener.portPlanning.port, null);
  assert.equal(defaults.openClashIngressAdapter.portPlanning.port, null);
  assert.doesNotMatch(serialized, /20808|20809/);
});

test("upgrades the c2d066b managed Mieru source markers without inventing a client endpoint", () => {
  const defaults = defaultDualMultipathInfrastructure();
  const parsed = parseDualMultipathDraft({
    version: 5,
    state: "draft",
    name: "c2d066b compatibility",
    ...defaults,
    privateCarrierBridge: {
      ...defaults.privateCarrierBridge,
      carrier: {
        protocol: "mieru",
        transport: "TCP",
        serverSource: "discovered-private-side",
        portSource: "existing-mita-listener",
        usernameSecretRef: "dual.mieru.username",
        passwordSecretRef: "dual.mieru.password",
      },
    },
  });
  assert.equal(parsed.privateCarrierBridge.type, "forwardx-managed-mieru-sidecar");
  if (parsed.privateCarrierBridge.type !== "forwardx-managed-mieru-sidecar") throw new Error("expected managed bridge");
  assert.equal(parsed.privateCarrierBridge.carrier.endpointSource, "verified-client-visible-discovery");
  assert.equal("serverSource" in parsed.privateCarrierBridge.carrier, false);
  assert.doesNotMatch(JSON.stringify(parsed.privateCarrierBridge.carrier), /172\.16\.4\.114|211\.136\.162\.188/);
});

test("allows a planned Mihomo listener port while pure Mieru proxy discovery is unresolved", () => {
  const parsed = parseDualMultipathDraft({
    ...draftInput,
    privateCarrierBridge: {
      ...draftInput.privateCarrierBridge,
      listener: {
        ...draftInput.privateCarrierBridge.listener,
        portPlanning: {
          status: "planned-read-only", strategy: "auto", port: 24081,
          evidence: { snapshotId: "snapshot-port-only", clientTargetRef: clientRef },
        },
      },
      target: {
        ...draftInput.privateCarrierBridge.target,
        discovery: { status: "unresolved", proxyRef: null },
      },
    },
  });
  const preview = compileDualMultipathPreview(parsed);
  assert.equal(preview.clientPortPlanning.mihomoPrivateListener?.status, "planned-read-only");
  assert.ok(preview.privateProxyDiscovery);
  assert.equal(preview.privateProxyDiscovery.status, "unresolved");
  assert.equal(preview.privateCarrierBridge.ready, false);
});

test("allows verified pure Mieru proxy discovery while its listener port is unresolved", () => {
  const parsed = parseDualMultipathDraft({
    ...draftInput,
    privateCarrierBridge: {
      ...draftInput.privateCarrierBridge,
      listener: {
        ...draftInput.privateCarrierBridge.listener,
        portPlanning: { status: "unresolved", strategy: "auto", port: null },
      },
    },
  });
  const preview = compileDualMultipathPreview(parsed);
  assert.equal(preview.clientPortPlanning.mihomoPrivateListener?.status, "unresolved");
  assert.ok(preview.privateProxyDiscovery);
  assert.equal(preview.privateProxyDiscovery.status, "verified-read-only");
  assert.equal(preview.privateCarrierBridge.ready, false);
});

test("keeps an undiscovered external SOCKS5 endpoint unresolved", () => {
  const parsed = parseDualMultipathDraft({
    ...draftInput,
    privateCarrierBridge: {
      type: "external-local-socks5",
      endpointDiscovery: { status: "unresolved", endpoint: null },
    },
  });
  assert.equal(parsed.privateCarrierBridge.type, "external-local-socks5");
  if (parsed.privateCarrierBridge.type !== "external-local-socks5") throw new Error("expected external bridge");
  assert.equal(parsed.privateCarrierBridge.endpointDiscovery.status, "unresolved");
  const preview = compileDualMultipathPreview(parsed);
  assert.equal(preview.privateCarrierBridge.ready, false);
  assert.equal(preview.privateProxyDiscovery, null);
  assert.equal(preview.externalPrivateEndpointDiscovery?.status, "unresolved");
  assert.match(JSON.stringify(preview.clientConfig), /unresolved:external-local-socks5/);
});

test("rejects generic mixed listeners and public private-bridge listeners", () => {
  assert.throws(() => parseDualMultipathDraft({
    ...draftInput,
    privateCarrierBridge: {
      ...draftInput.privateCarrierBridge,
      listener: { ...draftInput.privateCarrierBridge.listener, kind: "mixed" },
    },
  }), /配置无效/);
  assert.throws(() => parseDualMultipathDraft({
    ...draftInput,
    privateCarrierBridge: {
      ...draftInput.privateCarrierBridge,
      listener: { ...draftInput.privateCarrierBridge.listener, listen: "0.0.0.0" },
    },
  }), /配置无效/);
});

test("rejects ingress recursion and private-listener port conflicts", () => {
  assert.throws(() => parseDualMultipathDraft({
    ...draftInput,
    privateCarrierBridge: {
      ...draftInput.privateCarrierBridge,
      target: {
        ...draftInput.privateCarrierBridge.target,
        discovery: { status: "verified-read-only", proxyRef: draftInput.openClashIngressAdapter.tag, evidence },
      },
    },
  }), /递归回 ForwardX Dual ingress/);
  assert.throws(() => parseDualMultipathDraft({
    ...draftInput,
    privateCarrierBridge: {
      ...draftInput.privateCarrierBridge,
      listener: {
        ...draftInput.privateCarrierBridge.listener,
        portPlanning: draftInput.openClashIngressAdapter.portPlanning,
      },
    },
  }), /不能使用同一端口/);
});

test("rejects private targets with proxy-group, DIRECT or public fallback semantics", () => {
  const invalidTargets = [
    { ...draftInput.privateCarrierBridge.target, selection: "proxy-group" },
    { ...draftInput.privateCarrierBridge.target, fallback: "DIRECT" },
    { ...draftInput.privateCarrierBridge.target, transportScope: "public-allowed" },
  ];
  for (const target of invalidTargets) {
    assert.throws(() => parseDualMultipathDraft({ ...draftInput, privateCarrierBridge: { ...draftInput.privateCarrierBridge, target } }), /Dual multipath 配置无效/);
  }
});

test("rejects a public server multipath listener", () => {
  assert.throws(() => parseDualMultipathDraft({ ...draftInput, line: { ...draftInput.line, listen: "0.0.0.0" } }), /回环监听/);
});

test("rejects a server runtime listener that drifts from the line loopback target", () => {
  assert.throws(() => parseDualMultipathDraft({
    ...draftInput,
    serverRuntime: { ...draftInput.serverRuntime, multipathListener: { listen: "127.0.0.1", port: 39001 } },
  }), /必须与 line 的 loopback target 一致/);
});

test("accepts only dual.* secret references without echoing rejected values", () => {
  const raw = "REAL-HY2-SUPER-SECRET";
  let message = "";
  try {
    parseDualMultipathDraft({ ...draftInput, directCarrier: { ...draftInput.directCarrier, authSecretRef: raw } });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.match(message, /dual\.\*/);
  assert.equal(message.includes(raw), false);
});

test("compiles deterministic redacted Mihomo, client and server previews", () => {
  const first = compileDualMultipathPreview(draftInput);
  const second = compileDualMultipathPreview(draftInput);
  assert.deepEqual(first, second);
  assert.equal(first.privateCarrierBridge.ready, true);
  assert.equal(first.privateCarrierBridge.readiness, "ready");
  assert.equal(first.mihomoPrivateListener?.listeners[0].proxy, "NoBrand-Private-Mieru");
  assert.equal(first.mihomoPrivateListener?.listeners[0].listen, "127.0.0.1");
  assert.equal(first.mihomoPrivateListener?.isolation.genericMixedListenerAllowed, false);
  assert.deepEqual(first.clientConfig.outbounds.map((item) => item.tag), ["forwardx-private-mieru", "forwardx-direct-hy2", "forwardx-multipath-1"]);
  assert.equal(first.serverPreview.multipathConfig.inbounds[0].listen, "127.0.0.1");
  assert.equal(first.serverPreview.authenticatedCarrierRuntime.direct.bind.interface, "eth0");
  assert.equal(first.serverPreview.authenticatedCarrierRuntime.direct.bind.source_address, "87.86.22.221");
  if (first.serverPreview.verifiedTopology.status !== "verified-read-only") throw new Error("expected verified topology");
  assert.equal(first.serverPreview.verifiedTopology.existingPrivateCarrier.listener.port, 11464);
  assert.equal(first.serverPreview.authenticatedCarrierRuntime.direct.separateHysteriaBinaryRequired, false);
  const serialized = JSON.stringify(first);
  assert.match(serialized, /<secret:dual\.hy2\.auth>/);
  assert.match(serialized, /<secret:dual\.hy2\.tls\.private-key>/);
  assert.equal(first.upstream.nativeHysteria2, true);
  assert.equal(first.upstream.requiredBuildTag, "with_quic");
});

test("accepts a second synthetic Dual server through discovery data without schema changes", () => {
  const syntheticDiscovery: DualServerTargetDiscoverySnapshot = {
    status: "verified-read-only",
    targetId: "synthetic-dual-2",
    platform: { kernel: "Linux", architecture: "aarch64" },
    publicSide: {
      interfaceName: "ens3",
      sourceAddress: "203.0.113.20",
      addresses: ["203.0.113.20/27"],
      gateway: "203.0.113.1",
    },
    privateSide: {
      interfaceName: "ens8",
      sourceAddress: "10.44.0.12",
      addresses: ["10.44.0.12/24"],
    },
    defaultRoute: { via: "203.0.113.1", dev: "ens3" },
    existingPrivateCarrier: {
      type: "mita",
      binaryPath: "/opt/mita/bin/mita",
      serviceStatus: "active",
      listener: { network: "tcp", listen: "*", port: 22464 },
      lifecycle: "preserve",
    },
    installedBinaries: { singBox: false, hysteria: false, standaloneMieru: false },
  };
  const syntheticInfrastructure = createDefaultDualMultipathInfrastructure(syntheticDiscovery);
  const parsed = parseDualMultipathDraft({
    ...draftInput,
    ...syntheticInfrastructure,
    line: draftInput.line,
    legs: draftInput.legs,
    directCarrier: { ...syntheticInfrastructure.directCarrier, server: "203.0.113.20" },
  });
  const preview = compileDualMultipathPreview(parsed);
  if (preview.serverPreview.verifiedTopology.status !== "verified-read-only") throw new Error("expected verified topology");
  assert.equal(preview.serverPreview.verifiedTopology.publicSide.interfaceName, "ens3");
  assert.equal(preview.serverPreview.verifiedTopology.privateSide.sourceAddress, "10.44.0.12");
  assert.equal(preview.serverPreview.verifiedTopology.existingPrivateCarrier.listener.port, 22464);
  assert.equal(preview.serverPreview.authenticatedCarrierRuntime.direct.bind.interface, "ens3");
  assert.equal(preview.serverPreview.authenticatedCarrierRuntime.direct.bind.source_address, "203.0.113.20");
});

test("keeps unresolved auto client ports explicit in deterministic preview", () => {
  const unresolved = parseDualMultipathDraft({
    ...draftInput,
    ...defaultDualMultipathInfrastructure(),
    line: draftInput.line,
    legs: draftInput.legs,
  });
  const preview = compileDualMultipathPreview(unresolved);
  assert.equal(preview.clientPortPlanning.openClashIngress.status, "unresolved");
  assert.equal(preview.clientPortPlanning.privateCarrierSocks?.status, "unresolved");
  assert.equal(preview.privateProxyDiscovery, null);
  assert.equal(preview.privateCarrierBridge.ready, false);
  assert.match(JSON.stringify(preview.clientConfig), /unresolved:auto-dual-ingress-port/);
  assert.match(JSON.stringify(preview.mieruPrivateSidecar), /unresolved:auto-private-bridge-port/);
});

test("invalid drafts perform zero persistence writes", async () => {
  const memory = memoryStore();
  await assert.rejects(saveDualMultipathDraft(memory.store, { ...draftInput, line: { ...draftInput.line, listen: "0.0.0.0" } }), /配置无效/);
  assert.equal(memory.calls.length, 0);
});

test("saves only v5 and loads it back", async () => {
  const memory = memoryStore();
  const saved = await saveDualMultipathDraft(memory.store, draftInput);
  assert.equal(memory.calls[0]?.key, DUAL_MULTIPATH_DRAFT_SETTING_KEY);
  const loaded = await loadDualMultipathDraft(memory.store);
  assert.deepEqual(loaded, saved);
});

test("upgrades v4 in memory and discards unbound client planning evidence", async () => {
  const memory = memoryStore();
  memory.values.set(LEGACY_DUAL_MULTIPATH_V4_DRAFT_SETTING_KEY, JSON.stringify({
    version: 4,
    state: "draft",
    name: draftInput.name,
    line: draftInput.line,
    legs: draftInput.legs,
    targetDiscovery: draftInput.serverTargetDiscovery,
    openClashIngressAdapter: {
      type: "local-socks-sidecar",
      tag: draftInput.openClashIngressAdapter.tag,
      listen: "127.0.0.1",
      portPlanning: { status: "planned-read-only", strategy: "auto", port: 23180, snapshotId: "legacy-v4-client" },
    },
    privateCarrierBridge: {
      type: "mihomo-dedicated-listener",
      listener: {
        kind: "socks", scope: "dedicated", listen: "127.0.0.1",
        portPlanning: { status: "planned-read-only", strategy: "auto", port: 23181, snapshotId: "legacy-v4-client" },
      },
      target: {
        selection: "single-proxy", protocol: "mieru",
        discovery: { status: "verified-read-only", proxyRef: "Legacy-Pure-Mieru" },
        routing: "fixed-proxy", fallback: "none", transportScope: "private-only",
      },
    },
    directCarrier: draftInput.directCarrier,
    serverRuntime: draftInput.serverRuntime,
  }));
  const loaded = await loadDualMultipathDraft(memory.store);
  assert.equal(loaded?.version, 5);
  assert.equal(loaded?.clientTarget.status, "unresolved");
  assert.equal(loaded?.openClashIngressAdapter.portPlanning.status, "unresolved");
  if (loaded?.privateCarrierBridge.type !== "forwardx-managed-mieru-sidecar") throw new Error("expected managed Mieru sidecar");
  assert.equal(loaded.privateCarrierBridge.listener.portPlanning.status, "unresolved");
  assert.equal(loaded.privateCarrierBridge.runtime.clashMiDependency, false);
  assert.deepEqual(loaded.serverTargetDiscovery, draftInput.serverTargetDiscovery);
  assert.deepEqual(loaded.directCarrier, draftInput.directCarrier);
  assert.equal(loaded.serverRuntime.directCarrierRuntime.tlsPrivateKeySecretRef, "dual.hy2.tls.private-key");
  assert.equal(memory.calls.some((call) => call.method === "setSetting"), false);
});

test("upgrades the portable v3 shape in memory without inventing port evidence", async () => {
  const memory = memoryStore();
  memory.values.set(LEGACY_DUAL_MULTIPATH_V3_DRAFT_SETTING_KEY, JSON.stringify({
    version: 3,
    state: "draft",
    name: "NoBrand portable v3",
    line: draftInput.line,
    legs: draftInput.legs,
    targetDiscovery: draftInput.serverTargetDiscovery,
    openClashIngressAdapter: {
      type: "local-socks-sidecar", status: "resolved", tag: draftInput.openClashIngressAdapter.tag,
      listen: "127.0.0.1", portStrategy: "auto", port: 23180,
    },
    privateCarrierBridge: {
      type: "mihomo-dedicated-listener", status: "resolved",
      listener: { kind: "socks", scope: "dedicated", listen: "127.0.0.1", portStrategy: "auto", port: 23181 },
      target: {
        selection: "single-proxy", protocol: "mieru", proxyRef: "Pure-Mieru-v3",
        routing: "fixed-proxy", fallback: "none", transportScope: "private-only",
      },
    },
    directCarrier: draftInput.directCarrier,
    serverRuntime: draftInput.serverRuntime,
  }));
  const loaded = await loadDualMultipathDraft(memory.store);
  assert.equal(loaded?.version, 5);
  assert.equal(loaded?.openClashIngressAdapter.portPlanning.status, "unresolved");
  if (loaded?.privateCarrierBridge.type !== "forwardx-managed-mieru-sidecar") throw new Error("expected managed Mieru sidecar");
  assert.equal(loaded.privateCarrierBridge.listener.portPlanning.status, "unresolved");
  assert.equal(loaded.privateCarrierBridge.runtime.clashMiDependency, false);
  assert.equal(loaded.clientTarget.status, "unresolved");
  assert.equal(loaded.directCarrier.authSecretRef, draftInput.directCarrier.authSecretRef);
  assert.equal(memory.calls.some((call) => call.method === "setSetting"), false);
});

test("upgrades the pre-cleanup v3 host literals into discovery and resets unverified client ports", async () => {
  const memory = memoryStore();
  memory.values.set(LEGACY_DUAL_MULTIPATH_V3_DRAFT_SETTING_KEY, JSON.stringify({
    version: 3,
    state: "draft",
    name: "NoBrand Dual legacy v3",
    line: draftInput.line,
    legs: draftInput.legs,
    openClashIngressAdapter: {
      type: "local-socks-sidecar", status: "planned", tag: "forwardx-dual-ingress-1", listen: "127.0.0.1", listenPort: 20808,
    },
    privateCarrierBridge: {
      type: "mihomo-dedicated-listener", status: "unresolved",
      listener: { kind: "socks", scope: "dedicated", listen: "127.0.0.1", listenPort: 20809 },
      target: {
        selection: "single-proxy", protocol: "mieru", routing: "fixed-proxy", fallback: "none", transportScope: "private-only",
      },
    },
    directCarrier: infrastructure.directCarrier,
    serverRuntime: {
      topologyStatus: "verified-read-only",
      publicSide: { interface: "eth0", sourceAddress: "87.86.22.221", gateway: "87.86.22.1" },
      privateSide: { interface: "eth1", sourceAddress: "172.16.4.114", existingCarrier: "mita", existingListenerPort: 11464, lifecycle: "preserve" },
      directCarrierRuntime: {
        status: "unresolved", engine: "pinned-singbox-multipath", nativeHysteria2: "requires-with_quic-build-tag",
        separateHysteriaBinaryRequired: false, bindInterface: "eth0", sourceAddress: "87.86.22.221",
        tlsCertificateSecretRef: "dual.hy2.tls.certificate", tlsPrivateKeySecretRef: "dual.hy2.tls.private-key",
      },
    },
  }));
  const loaded = await loadDualMultipathDraft(memory.store);
  assert.equal(loaded?.serverTargetDiscovery.status, "verified-read-only");
  assert.equal(loaded?.version, 5);
  assert.equal(loaded?.openClashIngressAdapter.portPlanning.port, null);
  assert.equal(loaded?.privateCarrierBridge.type, "forwardx-managed-mieru-sidecar");
  if (loaded?.privateCarrierBridge.type !== "forwardx-managed-mieru-sidecar") throw new Error("expected migrated managed Mieru sidecar");
  assert.equal(loaded.privateCarrierBridge.listener.portPlanning.port, null);
  assert.doesNotMatch(JSON.stringify(loaded), /20808|20809/);
  assert.equal(memory.calls.some((call) => call.method === "setSetting"), false);
});

test("upgrades v2 in memory without carrying 127.0.0.1:1080 forward", async () => {
  const memory = memoryStore();
  memory.values.set(LEGACY_DUAL_MULTIPATH_V2_DRAFT_SETTING_KEY, JSON.stringify({
    version: 2,
    state: "draft",
    name: draftInput.name,
    line: draftInput.line,
    legs: draftInput.legs,
    carriers: {
      private: { type: "local-socks5", host: "127.0.0.1", port: 1080 },
      direct: { type: "hysteria2", server: "dual.example.invalid", serverPort: 443, tls: { serverName: "dual.example.invalid" }, authSecretRef: "dual.hy2.auth" },
    },
    clientSidecar: { type: "local-socks-sidecar", listen: "127.0.0.1", listenPort: 10808 },
  }));
  const loaded = await loadDualMultipathDraft(memory.store);
  assert.equal(loaded?.version, 5);
  assert.equal(loaded?.privateCarrierBridge.type, "forwardx-managed-mieru-sidecar");
  if (loaded?.privateCarrierBridge.type !== "forwardx-managed-mieru-sidecar") throw new Error("expected managed Mieru sidecar");
  assert.equal(loaded.privateCarrierBridge.runtime.clashMiDependency, false);
  assert.doesNotMatch(JSON.stringify(loaded?.privateCarrierBridge), /1080/);
  assert.equal(memory.calls.some((call) => call.method === "setSetting"), false);
});

test("upgrades v1 in memory to the same fail-closed unresolved model", async () => {
  const memory = memoryStore();
  memory.values.set(LEGACY_DUAL_MULTIPATH_DRAFT_SETTING_KEY, JSON.stringify({
    version: 1, state: "draft", name: draftInput.name, line: draftInput.line, legs: draftInput.legs,
  }));
  const loaded = await loadDualMultipathDraft(memory.store);
  assert.equal(loaded?.version, 5);
  assert.equal(loaded?.line.listen, "127.0.0.1");
  if (loaded?.privateCarrierBridge.type !== "forwardx-managed-mieru-sidecar") throw new Error("expected managed Mieru sidecar");
  assert.equal(loaded.privateCarrierBridge.runtime.clashMiDependency, false);
  assert.equal(memory.calls.some((call) => call.method === "setSetting"), false);
});
