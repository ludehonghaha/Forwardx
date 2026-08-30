import assert from "node:assert/strict";
import test from "node:test";
import {
  DUAL_MULTIPATH_DRAFT_SETTING_KEY,
  compileDualMultipathPreview,
  loadDualMultipathDraft,
  parseDualMultipathDraft,
  saveDualMultipathDraft,
  type DualMultipathSettingsStore,
} from "./dualMultipathControlPlane";

const draftInput = {
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
};

function memoryStore() {
  let value: string | null = null;
  const calls: Array<{ method: string; key: string; value?: string | null }> = [];
  const store: DualMultipathSettingsStore = {
    async getSetting(key) {
      calls.push({ method: "getSetting", key });
      return value;
    },
    async setSetting(key, next) {
      calls.push({ method: "setSetting", key, value: next });
      value = next;
    },
  };
  return { store, calls, value: () => value };
}

test("accepts the fixed private-leg0/direct-leg1 Dual draft", () => {
  const parsed = parseDualMultipathDraft(draftInput);
  assert.equal(parsed.version, 1);
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

test("preview compilation is deterministic and explicitly preview-only", () => {
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
  assert.equal(first.clientOutbound.preferred, "dedicated");
  assert.deepEqual(first.clientOutbound.outbounds, ["dedicated", "hy2-public"]);
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
