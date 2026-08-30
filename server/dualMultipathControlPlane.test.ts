import assert from "node:assert/strict";
import test from "node:test";
import {
  DUAL_MULTIPATH_DRAFT_SETTING_KEY,
  LEGACY_DUAL_MULTIPATH_DRAFT_SETTING_KEY,
  LEGACY_DUAL_MULTIPATH_V2_DRAFT_SETTING_KEY,
  compileDualMultipathPreview,
  defaultDualMultipathInfrastructure,
  loadDualMultipathDraft,
  parseDualMultipathDraft,
  saveDualMultipathDraft,
  type DualMultipathSettingsStore,
} from "./dualMultipathControlPlane";

const infrastructure = defaultDualMultipathInfrastructure();
const draftInput = {
  version: 3 as const,
  state: "draft" as const,
  name: "NoBrand Dual",
  line: { id: 1, server: "127.0.0.1", serverPort: 39000, listen: "127.0.0.1" as const, activationThresholdMbps: 120 },
  legs: [
    { role: "private" as const, legIndex: 0 as const, outboundTag: "forwardx-private-mieru", expectedBandwidthMbps: 200, supportsUdp: true },
    { role: "direct" as const, legIndex: 1 as const, outboundTag: "forwardx-direct-hy2", expectedBandwidthMbps: 1000, supportsUdp: true },
  ] as const,
  ...infrastructure,
  privateCarrierBridge: {
    ...infrastructure.privateCarrierBridge,
    status: "resolved" as const,
    target: { ...infrastructure.privateCarrierBridge.target, proxyRef: "NoBrand-Private-Mieru" },
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

test("accepts the v3 one-panel Dual model and keeps server multipath on loopback", () => {
  const parsed = parseDualMultipathDraft(draftInput);
  assert.equal(parsed.version, 3);
  assert.equal(parsed.openClashIngressAdapter.type, "local-socks-sidecar");
  assert.equal(parsed.privateCarrierBridge.type, "mihomo-dedicated-listener");
  assert.equal(parsed.line.listen, "127.0.0.1");
  assert.equal(parsed.line.serverPort, 39000);
});

test("does not default or emit the rejected 127.0.0.1:1080 private endpoint", () => {
  const defaults = defaultDualMultipathInfrastructure();
  const serialized = JSON.stringify(defaults);
  assert.doesNotMatch(serialized, /1080/);
  assert.equal(defaults.privateCarrierBridge.type, "mihomo-dedicated-listener");
  assert.equal(defaults.privateCarrierBridge.status, "unresolved");
});

test("keeps an undiscovered external SOCKS5 endpoint unresolved", () => {
  const parsed = parseDualMultipathDraft({
    ...draftInput,
    privateCarrierBridge: { type: "external-local-socks5", status: "unresolved" },
  });
  assert.equal(parsed.privateCarrierBridge.status, "unresolved");
  assert.equal("endpoint" in parsed.privateCarrierBridge, false);
  const preview = compileDualMultipathPreview(parsed);
  assert.equal(preview.privateCarrierBridge.deployable, false);
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
      target: { ...draftInput.privateCarrierBridge.target, proxyRef: draftInput.openClashIngressAdapter.tag },
    },
  }), /递归回 ForwardX Dual ingress/);
  assert.throws(() => parseDualMultipathDraft({
    ...draftInput,
    privateCarrierBridge: {
      ...draftInput.privateCarrierBridge,
      listener: { ...draftInput.privateCarrierBridge.listener, listenPort: draftInput.openClashIngressAdapter.listenPort },
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
  assert.equal(first.mihomoPrivateListener?.listeners[0].proxy, "NoBrand-Private-Mieru");
  assert.equal(first.mihomoPrivateListener?.listeners[0].listen, "127.0.0.1");
  assert.equal(first.mihomoPrivateListener?.isolation.genericMixedListenerAllowed, false);
  assert.deepEqual(first.clientConfig.outbounds.map((item) => item.tag), ["forwardx-private-mieru", "forwardx-direct-hy2", "forwardx-multipath-1"]);
  assert.equal(first.serverPreview.multipathConfig.inbounds[0].listen, "127.0.0.1");
  assert.equal(first.serverPreview.authenticatedCarrierRuntime.direct.bind.interface, "eth0");
  assert.equal(first.serverPreview.authenticatedCarrierRuntime.direct.separateHysteriaBinaryRequired, false);
  const serialized = JSON.stringify(first);
  assert.match(serialized, /<secret:dual\.hy2\.auth>/);
  assert.match(serialized, /<secret:dual\.hy2\.tls\.private-key>/);
  assert.equal(first.upstream.nativeHysteria2, true);
  assert.equal(first.upstream.requiredBuildTag, "with_quic");
});

test("invalid drafts perform zero persistence writes", async () => {
  const memory = memoryStore();
  await assert.rejects(saveDualMultipathDraft(memory.store, { ...draftInput, line: { ...draftInput.line, listen: "0.0.0.0" } }), /配置无效/);
  assert.equal(memory.calls.length, 0);
});

test("saves only v3 and loads it back", async () => {
  const memory = memoryStore();
  const saved = await saveDualMultipathDraft(memory.store, draftInput);
  assert.equal(memory.calls[0]?.key, DUAL_MULTIPATH_DRAFT_SETTING_KEY);
  const loaded = await loadDualMultipathDraft(memory.store);
  assert.deepEqual(loaded, saved);
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
  assert.equal(loaded?.version, 3);
  assert.equal(loaded?.privateCarrierBridge.type, "mihomo-dedicated-listener");
  assert.equal(loaded?.privateCarrierBridge.status, "unresolved");
  assert.doesNotMatch(JSON.stringify(loaded?.privateCarrierBridge), /1080/);
  assert.equal(memory.calls.some((call) => call.method === "setSetting"), false);
});

test("upgrades v1 in memory to the same fail-closed unresolved model", async () => {
  const memory = memoryStore();
  memory.values.set(LEGACY_DUAL_MULTIPATH_DRAFT_SETTING_KEY, JSON.stringify({
    version: 1, state: "draft", name: draftInput.name, line: draftInput.line, legs: draftInput.legs,
  }));
  const loaded = await loadDualMultipathDraft(memory.store);
  assert.equal(loaded?.version, 3);
  assert.equal(loaded?.line.listen, "127.0.0.1");
  assert.equal(loaded?.privateCarrierBridge.status, "unresolved");
  assert.equal(memory.calls.some((call) => call.method === "setSetting"), false);
});
