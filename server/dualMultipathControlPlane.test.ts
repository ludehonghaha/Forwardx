import assert from "node:assert/strict";
import test from "node:test";
import {
  DUAL_MULTIPATH_DRAFT_SETTING_KEY,
  LEGACY_DUAL_MULTIPATH_DRAFT_SETTING_KEY,
  compileDualMultipathPreview,
  loadDualMultipathDraft,
  parseDualMultipathDraft,
  saveDualMultipathDraft,
  type DualMultipathSettingsStore,
} from "./dualMultipathControlPlane";

const draftInput = {
  version: 2 as const,
  state: "draft" as const,
  name: "NoBrand Dual PoC",
  line: {
    id: 1,
    server: "10.66.67.1",
    serverPort: 39000,
    activationThresholdMbps: 120,
  },
  legs: [
    {
      role: "private" as const,
      legIndex: 0 as const,
      outboundTag: "dedicated",
      expectedBandwidthMbps: 160,
      supportsUdp: true,
    },
    {
      role: "direct" as const,
      legIndex: 1 as const,
      outboundTag: "hy2-public",
      expectedBandwidthMbps: 700,
      supportsUdp: true,
    },
  ] as const,
  carriers: {
    private: {
      type: "local-socks5" as const,
      host: "127.0.0.1" as const,
      port: 1080,
      usernameSecretRef: "dual.mieru.username",
      passwordSecretRef: "dual.mieru.password",
    },
    direct: {
      type: "hysteria2" as const,
      server: "dual.example.invalid",
      serverPort: 443,
      tls: { serverName: "dual.example.invalid" },
      authSecretRef: "dual.hy2.auth",
    },
  },
  clientSidecar: {
    type: "local-socks-sidecar" as const,
    listen: "127.0.0.1" as const,
    listenPort: 10808,
  },
};

function memoryStore() {
  const values = new Map<string, string | null>();
  const calls: Array<{ method: string; key: string; value?: string | null }> = [];
  const store: DualMultipathSettingsStore = {
    async getSetting(key) {
      calls.push({ method: "getSetting", key });
      return values.get(key) ?? null;
    },
    async setSetting(key, next) {
      calls.push({ method: "setSetting", key, value: next });
      values.set(key, next);
    },
  };
  return { store, calls, value: (key = DUAL_MULTIPATH_DRAFT_SETTING_KEY) => values.get(key) ?? null, values };
}

test("accepts the fixed private-leg0/direct-leg1 Dual draft", () => {
  const parsed = parseDualMultipathDraft(draftInput);
  assert.equal(parsed.version, 2);
  assert.equal(parsed.state, "draft");
  assert.equal(parsed.legs[0].role, "private");
  assert.equal(parsed.legs[0].legIndex, 0);
  assert.equal(parsed.legs[1].role, "direct");
  assert.equal(parsed.legs[1].legIndex, 1);
});

test("rejects a swapped topology, duplicate outbound tags and invalid queue budget", () => {
  assert.throws(() => parseDualMultipathDraft({
    ...draftInput,
    legs: [draftInput.legs[1], draftInput.legs[0]],
  }), /Dual multipath 配置无效/);

  assert.throws(() => parseDualMultipathDraft({
    ...draftInput,
    legs: [
      draftInput.legs[0],
      { ...draftInput.legs[1], outboundTag: draftInput.legs[0].outboundTag },
    ],
  }), /不同的 outbound tag/);

  assert.throws(() => parseDualMultipathDraft({
    ...draftInput,
    line: { ...draftInput.line, chunkSize: 1024 * 1024, queueFrames: 4096 },
  }), /64 MiB/);
});

test("compiles a deterministic private-first client sidecar with resolvable child tags", () => {
  const first = compileDualMultipathPreview(draftInput);
  const second = compileDualMultipathPreview(draftInput);
  assert.deepEqual(first, second);
  assert.equal(first.state, "preview-only");
  assert.deepEqual(first.topology, {
    private: "dedicated",
    direct: "hy2-public",
    preferred: "dedicated",
  });
  assert.deepEqual(first.safety, {
    agentPush: false,
    runtimeActivation: false,
    tunnelMutation: false,
  });
  assert.equal(first.clientConfig.inbounds.length, 1);
  assert.deepEqual(first.clientConfig.inbounds[0], {
    type: "socks",
    tag: "forwardx-openclash-socks-1",
    listen: "127.0.0.1",
    listen_port: 10808,
  });
  assert.equal(first.clientConfig.outbounds.length, 3);
  assert.equal(first.clientConfig.outbounds[0].type, "socks");
  assert.equal(first.clientConfig.outbounds[0].tag, "dedicated");
  assert.equal(first.clientConfig.outbounds[1].type, "hysteria2");
  assert.equal(first.clientConfig.outbounds[1].tag, "hy2-public");
  const multipath = first.clientConfig.outbounds[2];
  assert.equal(multipath.type, "multipath");
  assert.equal(multipath.outbounds.length, 2);
  assert.equal(multipath.preferred, "dedicated");
  assert.deepEqual(multipath.outbounds, ["dedicated", "hy2-public"]);
  const tags = new Set(first.clientConfig.outbounds.map((outbound) => outbound.tag));
  assert.equal(tags.size, 3);
  assert.equal(multipath.outbounds.every((tag) => tags.has(tag)), true);
  assert.equal(first.clientConfig.route.final, multipath.tag);
});

test("keeps secret values outside drafts and emits only redacted reference placeholders", () => {
  const preview = compileDualMultipathPreview(draftInput);
  const serialized = JSON.stringify(preview);
  assert.match(serialized, /<secret:dual\.mieru\.username>/);
  assert.match(serialized, /<secret:dual\.mieru\.password>/);
  assert.match(serialized, /<secret:dual\.hy2\.auth>/);
  assert.doesNotMatch(serialized, /REAL_(?:MIERU|HY2)_SECRET/);
  assert.deepEqual(preview.secretHandling, {
    acceptedInput: "references-only",
    resolved: false,
    previewValues: "redacted-placeholders",
  });
});

test("separates the loopback multipath config from authenticated carrier runtimes", () => {
  const preview = compileDualMultipathPreview(draftInput);
  const serverInbound = preview.serverPreview.multipathConfig.inbounds[0];
  assert.equal(serverInbound.type, "multipath");
  assert.equal(serverInbound.listen, "127.0.0.1");
  assert.equal(preview.serverPreview.authenticatedCarrierRuntime.status, "not-compiled");
  assert.equal(preview.serverPreview.authenticatedCarrierRuntime.private.mutationAllowed, false);
  assert.equal(preview.serverPreview.authenticatedCarrierRuntime.direct.mutationAllowed, false);
});

test("saving a draft only writes the dedicated settings key and can be loaded back", async () => {
  const memory = memoryStore();
  const saved = await saveDualMultipathDraft(memory.store, draftInput);

  assert.equal(memory.calls.length, 1);
  assert.deepEqual(memory.calls[0], {
    method: "setSetting",
    key: DUAL_MULTIPATH_DRAFT_SETTING_KEY,
    value: memory.value(),
  });
  assert.ok(memory.value()?.includes("NoBrand Dual PoC"));

  const loaded = await loadDualMultipathDraft(memory.store);
  assert.deepEqual(loaded, saved);
  assert.deepEqual(memory.calls.map((call) => call.method), ["setSetting", "getSetting"]);
});

test("saving an invalid draft performs zero writes", async () => {
  const memory = memoryStore();
  await assert.rejects(
    saveDualMultipathDraft(memory.store, {
      ...draftInput,
      line: { ...draftInput.line, preferredLegIndex: 1 },
    }),
    /Dual multipath 配置无效/,
  );
  assert.equal(memory.calls.length, 0);
});

test("rejects invalid carriers and public listeners with zero persistence writes", async () => {
  const invalidInputs = [
    { ...draftInput, carriers: { ...draftInput.carriers, private: { ...draftInput.carriers.private, port: 0 } } },
    { ...draftInput, carriers: { ...draftInput.carriers, direct: { ...draftInput.carriers.direct, authSecretRef: "REAL-HY2-SUPER-SECRET" } } },
    { ...draftInput, line: { ...draftInput.line, listen: "0.0.0.0" } },
    { ...draftInput, clientSidecar: { ...draftInput.clientSidecar, listen: "0.0.0.0" } },
  ];
  for (const invalid of invalidInputs) {
    const memory = memoryStore();
    await assert.rejects(saveDualMultipathDraft(memory.store, invalid), /Dual multipath 配置无效/);
    assert.equal(memory.calls.length, 0);
  }
});

test("never includes rejected secret-like values in validation errors", () => {
  const secretValue = "REAL-HY2-SUPER-SECRET";
  let message = "";
  try {
    parseDualMultipathDraft({
      ...draftInput,
      carriers: {
        ...draftInput.carriers,
        direct: { ...draftInput.carriers.direct, authSecretRef: secretValue },
      },
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.match(message, /secret reference/);
  assert.equal(message.includes(secretValue), false);
});

test("loads a v1 draft as v2 defaults without persisting a migration", async () => {
  const memory = memoryStore();
  memory.values.set(LEGACY_DUAL_MULTIPATH_DRAFT_SETTING_KEY, JSON.stringify({
    version: 1,
    state: "draft",
    name: draftInput.name,
    line: draftInput.line,
    legs: draftInput.legs,
  }));
  const loaded = await loadDualMultipathDraft(memory.store);
  assert.equal(loaded?.version, 2);
  assert.equal(loaded?.carriers.private.type, "local-socks5");
  assert.equal(loaded?.carriers.direct.authSecretRef, "dual.hy2.auth");
  assert.equal(memory.calls.some((call) => call.method === "setSetting"), false);
});
