import assert from "node:assert/strict";
import test from "node:test";
import { buildDualMultipathDraftFromForm, defaultDualMultipathForm, dualMultipathFormFromDraft } from "./dualMultipathForm";

test("defaults to a simple one-panel Dual model without 127.0.0.1:1080", () => {
  const form = defaultDualMultipathForm();
  const draft = buildDualMultipathDraftFromForm(form);
  assert.equal(draft.version, 3);
  assert.equal(draft.line.server, "127.0.0.1");
  assert.equal(draft.line.serverPort, 39000);
  assert.equal(draft.privateCarrierBridge.type, "mihomo-dedicated-listener");
  assert.equal(draft.privateCarrierBridge.status, "unresolved");
  assert.doesNotMatch(JSON.stringify(draft.privateCarrierBridge), /1080/);
  assert.equal(draft.directCarrier.status, "unresolved");
  assert.equal(draft.serverRuntime.directCarrierRuntime.separateHysteriaBinaryRequired, false);
});

test("maps ordinary UI fields to the fixed private-first topology", () => {
  const form = defaultDualMultipathForm();
  form.name = "Dual 聚合";
  form.privateBandwidthMbps = "200";
  form.directBandwidthMbps = "1000";
  form.activationThresholdMbps = "150";
  const draft = buildDualMultipathDraftFromForm(form);
  assert.equal(draft.name, "Dual 聚合");
  assert.equal(draft.legs[0].role, "private");
  assert.equal(draft.legs[0].expectedBandwidthMbps, 200);
  assert.equal(draft.legs[1].role, "direct");
  assert.equal(draft.legs[1].expectedBandwidthMbps, 1000);
  assert.equal(draft.line.preferredLegIndex, 0);
  assert.equal(draft.line.activationThresholdMbps, 150);
});

test("rejects invalid ordinary UI values before API submission", () => {
  const noName = defaultDualMultipathForm();
  noName.name = "";
  assert.throws(() => buildDualMultipathDraftFromForm(noName), /配置名称/);
  const badBandwidth = defaultDualMultipathForm();
  badBandwidth.privateBandwidthMbps = "0";
  assert.throws(() => buildDualMultipathDraftFromForm(badBandwidth), /专线带宽/);
  const badWindow = defaultDualMultipathForm();
  badWindow.activationWindow = "now";
  assert.throws(() => buildDualMultipathDraftFromForm(badWindow), /统计窗口/);
});

test("hydrates a v3 draft without exposing or rewriting infrastructure", () => {
  const base = defaultDualMultipathForm();
  const draft = buildDualMultipathDraftFromForm(base);
  const resolved = {
    ...draft,
    name: "Dual 已发现",
    line: { ...draft.line, chunkSize: 32768, queueFrames: 128 },
    legs: [draft.legs[0], { ...draft.legs[1], supportsUdp: false }],
    privateCarrierBridge: {
      ...draft.privateCarrierBridge,
      status: "resolved",
      target: { ...draft.privateCarrierBridge.target, proxyRef: "Pure-Mieru" },
    },
  };
  const hydrated = dualMultipathFormFromDraft(resolved);
  const rebuilt = buildDualMultipathDraftFromForm(hydrated);
  assert.equal(hydrated.name, "Dual 已发现");
  assert.deepEqual(rebuilt.privateCarrierBridge, resolved.privateCarrierBridge);
  assert.equal(rebuilt.line.chunkSize, 32768);
  assert.equal(rebuilt.line.queueFrames, 128);
  assert.equal(rebuilt.legs[1].supportsUdp, false);
  assert.deepEqual(rebuilt.openClashIngressAdapter, resolved.openClashIngressAdapter);
  assert.deepEqual(rebuilt.serverRuntime, resolved.serverRuntime);
});
