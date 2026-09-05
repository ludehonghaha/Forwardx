import assert from "node:assert/strict";
import test from "node:test";
import { dualMultipathDraftSchema } from "../shared/dualMultipath";
import { defaultDualMultipathInfrastructure } from "./dualMultipathControlPlane";
import {
  DUAL_ANDROID_GRAY_ARTIFACT,
  buildDualMultipathMobileGrayBundle,
} from "./dualMultipathMobileGrayBundle";

function resolvedDraft() {
  const infrastructure = defaultDualMultipathInfrastructure();
  return dualMultipathDraftSchema.parse({
    version: 5,
    state: "draft",
    name: "NoBrand Dual mobile gray",
    ...infrastructure,
    line: {
      ...infrastructure.line,
      activationThresholdMbps: 120,
      activationWindow: "1s",
    },
    legs: [
      { ...infrastructure.legs[0], expectedBandwidthMbps: 200 },
      { ...infrastructure.legs[1], expectedBandwidthMbps: 1000 },
    ],
    directCarrier: {
      ...infrastructure.directCarrier,
      status: "resolved",
      serverPort: 24443,
      tls: { serverName: "dual-gray.example.test" },
    },
  });
}

const mobileInput = {
  sidecarIngressPort: 24180,
  clashMiPrivateListenerPort: 24181,
  pureMieruProxyRef: "Pure-Mieru",
};

test("builds an ephemeral Clash Mi + Android sidecar bundle without trusting persisted client target", () => {
  const draft = resolvedDraft();
  assert.equal(draft.clientTarget.status, "unresolved");
  const before = structuredClone(draft);
  const bundle = buildDualMultipathMobileGrayBundle(draft, mobileInput);

  assert.deepEqual(draft, before);
  assert.equal(bundle.sourceDraft.clientTargetIgnored, true);
  assert.equal(bundle.testClient.kind, "android-clash-mi");
  assert.equal(bundle.testClient.persistsToDualDraft, false);
  assert.equal(bundle.testClient.localPorts.sidecarIngress, 24180);
  assert.equal(bundle.testClient.localPorts.clashMiPrivateListener, 24181);
  assert.equal(bundle.testClient.localPorts.availabilityVerified, false);
});

test("emits the expected three-layer client path: SOCKS inbound -> private SOCKS/HY2 -> multipath", () => {
  const bundle = buildDualMultipathMobileGrayBundle(resolvedDraft(), mobileInput);
  const config = bundle.fragments.androidSidecarConfig;

  assert.deepEqual(config.inbounds[0], {
    type: "socks",
    tag: "forwardx-dual-mobile-gray-in",
    listen: "127.0.0.1",
    listen_port: 24180,
  });
  assert.equal(config.outbounds[0].type, "socks");
  assert.equal(config.outbounds[0].server, "127.0.0.1");
  assert.equal(config.outbounds[0].server_port, 24181);
  assert.equal(config.outbounds[1].type, "hysteria2");
  assert.equal(config.outbounds[1].server_port, 24443);
  assert.equal(config.outbounds[2].type, "multipath");
  assert.equal(config.outbounds[2].preferred, resolvedDraft().legs[0].outboundTag);
  assert.equal(config.route.final, config.outbounds[2].tag);
});

test("emits a dedicated Clash Mi listener pinned to one pure Mieru proxy", () => {
  const bundle = buildDualMultipathMobileGrayBundle(resolvedDraft(), mobileInput);
  assert.deepEqual(bundle.fragments.clashMiPrivateListener.listeners[0], {
    name: "forwardx-mobile-gray-private-1",
    type: "socks",
    listen: "127.0.0.1",
    port: 24181,
    proxy: "Pure-Mieru",
  });
  assert.equal(bundle.fragments.clashMiPrivateListener.isolation.genericMixedListenerAllowed, false);
  assert.equal(bundle.fragments.clashMiPrivateListener.isolation.recursionAllowed, false);
  assert.equal(bundle.fragments.clashMiPrivateListener.isolation.directOrPublicFallbackAllowed, false);
});

test("keeps secrets redacted and never marks the mobile bundle runnable", () => {
  const bundle = buildDualMultipathMobileGrayBundle(resolvedDraft(), mobileInput);
  const serialized = JSON.stringify(bundle);
  assert.match(serialized, /<secret:dual\.hy2\.auth>/);
  assert.doesNotMatch(serialized, /change-me|password-value|private-key-value/);
  assert.equal(bundle.readyForRuntime, false);
  assert.deepEqual(bundle.safety, {
    draftPersistenceWrite: false,
    clientEvidenceWrite: false,
    agentPush: false,
    commandExecution: false,
    runtimeActivation: false,
    systemdWrite: false,
    firewallMutation: false,
    existingMitaMutation: false,
    existingClashMiMutation: false,
    productionDbWrite: false,
  });
});

test("keeps unresolved Mieru as an explicit blocker instead of selecting or inventing a proxy", () => {
  const bundle = buildDualMultipathMobileGrayBundle(resolvedDraft(), {
    ...mobileInput,
    pureMieruProxyRef: null,
  });
  assert.match(bundle.fragments.clashMiPrivateListener.listeners[0].proxy, /unresolved:pure-mieru/);
  assert.ok(bundle.blockers.some((item) => item.includes("唯一纯 Mieru")));
});

test("rejects loopback port collision and Dual ingress recursion", () => {
  assert.throws(() => buildDualMultipathMobileGrayBundle(resolvedDraft(), {
    ...mobileInput,
    clashMiPrivateListenerPort: mobileInput.sidecarIngressPort,
  }), /不能使用同一端口/);

  assert.throws(() => buildDualMultipathMobileGrayBundle(resolvedDraft(), {
    ...mobileInput,
    pureMieruProxyRef: resolvedDraft().openClashIngressAdapter.tag,
  }), /不允许递归/);
});

test("pins the Android artifact contract to the same upstream multipath compiler generation", () => {
  const bundle = buildDualMultipathMobileGrayBundle(resolvedDraft(), mobileInput);
  assert.deepEqual(bundle.artifact, DUAL_ANDROID_GRAY_ARTIFACT);
  assert.equal(bundle.artifact.platform, "android");
  assert.equal(bundle.artifact.architecture, "arm64");
  assert.equal(bundle.artifact.requiredBuildTag, "with_quic");
  assert.equal(bundle.artifact.upstream.commit, "1c36787d956d750f2ee58d73710d8006a11ccf2c");
});

test("server fragment stays loopback-only and remains a non-executable preview", () => {
  const bundle = buildDualMultipathMobileGrayBundle(resolvedDraft(), mobileInput);
  const inbound = bundle.fragments.serverMultipathConfig.inbounds[0];
  assert.equal(inbound.type, "multipath");
  assert.equal(inbound.listen, "127.0.0.1");
  assert.equal(bundle.fragments.serverDirectCarrierPreview.status, "not-compiled");
  assert.equal(bundle.fragments.serverDirectCarrierPreview.multipathTarget.host, "127.0.0.1");
  assert.equal(bundle.readyForRuntime, false);
});
