import assert from "node:assert/strict";
import test from "node:test";
import { dualMultipathDraftSchema } from "../shared/dualMultipath";
import { defaultDualMultipathInfrastructure } from "./dualMultipathControlPlane";
import {
  DUAL_LINUX_GRAY_ARTIFACT,
  DUAL_WINDOWS_GRAY_ARTIFACT,
  buildDualMultipathGrayRuntimeBundle,
} from "./dualMultipathGrayRuntimeBundle";

function grayDraft() {
  const infrastructure = defaultDualMultipathInfrastructure();
  return dualMultipathDraftSchema.parse({
    version: 5,
    state: "draft",
    name: "NoBrand Dual Windows gray",
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
  });
}

const runtimeInput = {
  windowsSidecarIngressPort: 24180,
  windowsPrivateSocksPort: 24181,
  hy2Port: 61464,
  tlsServerName: "forwardx-dual-gray.test",
  tlsCertificatePath: "/tmp/forwardx-dual-gray.crt",
  tlsPrivateKeyPath: "/tmp/forwardx-dual-gray.key",
  tlsMode: "self-signed-gray" as const,
};

test("builds Windows private SOCKS + native HY2 + multipath without pretending sing-box supports Mieru", () => {
  const bundle = buildDualMultipathGrayRuntimeBundle(grayDraft(), runtimeInput);
  const config = bundle.fragments.windowsSidecarConfig;
  assert.equal(config.inbounds[0].listen, "127.0.0.1");
  assert.equal(config.inbounds[0].listen_port, 24180);
  assert.equal(config.outbounds[0].type, "socks");
  assert.equal(config.outbounds[0].server, "127.0.0.1");
  assert.equal(config.outbounds[0].server_port, 24181);
  assert.equal(config.outbounds[1].type, "hysteria2");
  assert.equal(config.outbounds[1].server, "87.86.22.221");
  assert.equal(config.outbounds[1].server_port, 61464);
  assert.equal(config.outbounds[2].type, "multipath");
  assert.equal(config.route.final, config.outbounds[2].tag);
  assert.doesNotMatch(JSON.stringify(config.outbounds), /"type":"mieru"/);
});

test("models an official ForwardX-managed Mieru client with a dedicated loopback SOCKS listener", () => {
  const bundle = buildDualMultipathGrayRuntimeBundle(grayDraft(), runtimeInput);
  const config = bundle.fragments.windowsMieruClientConfig;
  assert.equal(config.socks5Port, 24181);
  assert.equal(config.socks5ListenLAN, false);
  assert.equal(config.rpcPort, 0);
  assert.equal(config.profiles[0].servers[0].ipAddress, "172.16.4.114");
  assert.equal(config.profiles[0].servers[0].portBindings[0].port, 11464);
  assert.equal(config.profiles[0].servers[0].portBindings[0].protocol, "TCP");
  assert.match(config.profiles[0].user.name, /<secret:dual\.mieru\.username>/);
  assert.match(config.profiles[0].user.password, /<secret:dual\.mieru\.password>/);
  assert.equal(bundle.topology.privateLeg.clientEngine, "forwardx-managed-official-mieru");
  assert.equal(bundle.safety.clashMiRead, false);
  assert.equal(bundle.safety.clashMiMutation, false);
});

test("server Gray binds HY2 only to discovered public address while multipath remains loopback-only", () => {
  const bundle = buildDualMultipathGrayRuntimeBundle(grayDraft(), runtimeInput);
  const [hy2, multipath] = bundle.fragments.serverConfig.inbounds;
  assert.equal(hy2.type, "hysteria2");
  assert.equal(hy2.listen, "87.86.22.221");
  assert.equal(hy2.listen_port, 61464);
  assert.equal(multipath.type, "multipath");
  assert.equal(multipath.listen, "127.0.0.1");
  assert.equal(multipath.listen_port, 39000);
  assert.equal(bundle.fragments.serverConfig.route.final, "direct");
});

test("preserves existing Mita and never mutates the source draft", () => {
  const draft = grayDraft();
  const before = structuredClone(draft);
  const bundle = buildDualMultipathGrayRuntimeBundle(draft, runtimeInput);
  assert.deepEqual(draft, before);
  assert.equal(bundle.topology.privateLeg.existingServerBinaryPath, "/usr/bin/mita");
  assert.equal(bundle.topology.privateLeg.existingServerUnitName, "mita-oneclick@uc650fd438a46ab4e.service");
  assert.equal(bundle.topology.privateLeg.existingServerListenerPort, 11464);
  assert.equal(bundle.topology.privateLeg.lifecycle, "preserve");
  assert.equal(bundle.safety.existingMitaMutation, false);
  assert.equal(bundle.safety.systemdWrite, false);
  assert.equal(bundle.safety.firewallMutation, false);
  assert.equal(bundle.safety.routeMutation, false);
});

test("keeps real Mieru client credentials as the live blocker", () => {
  const bundle = buildDualMultipathGrayRuntimeBundle(grayDraft(), runtimeInput);
  assert.equal(bundle.fragments.windowsMieruClientConfig.socks5Port, 24181);
  assert.ok(bundle.blockers.some((item) => item.includes("真实 Mieru client username/password")));
});

test("uses secret references only and keeps self-signed TLS explicitly Gray-only", () => {
  const bundle = buildDualMultipathGrayRuntimeBundle(grayDraft(), runtimeInput);
  const serialized = JSON.stringify(bundle);
  assert.match(serialized, /<secret:dual\.hy2\.auth>/);
  assert.doesNotMatch(serialized, /real-password|private-key-value/);
  assert.equal(bundle.safety.templatesContainSecretValues, false);
  assert.equal(bundle.safety.secretReferencesOnly, true);
  assert.equal(bundle.safety.tlsMode, "self-signed-gray");
  assert.equal(bundle.safety.tlsVerificationDisabledOnGrayClient, true);
  assert.equal(bundle.safety.productionTlsApproved, false);
  assert.equal(bundle.readyForRuntime, false);
});

test("rejects local port collision, Mita port reuse and multipath port reuse", () => {
  assert.throws(() => buildDualMultipathGrayRuntimeBundle(grayDraft(), {
    ...runtimeInput,
    windowsPrivateSocksPort: runtimeInput.windowsSidecarIngressPort,
  }), /不能使用同一端口/);

  assert.throws(() => buildDualMultipathGrayRuntimeBundle(grayDraft(), {
    ...runtimeInput,
    hy2Port: 11464,
  }), /Mita listener/);

  assert.throws(() => buildDualMultipathGrayRuntimeBundle(grayDraft(), {
    ...runtimeInput,
    hy2Port: 39000,
  }), /multipath loopback/);

});

test("pins Windows and Linux Gray artifacts to the same upstream protocol generation", () => {
  const bundle = buildDualMultipathGrayRuntimeBundle(grayDraft(), runtimeInput);
  assert.deepEqual(bundle.artifacts.windows, DUAL_WINDOWS_GRAY_ARTIFACT);
  assert.deepEqual(bundle.artifacts.server, DUAL_LINUX_GRAY_ARTIFACT);
  assert.equal(bundle.artifacts.windows.upstream.commit, "1c36787d956d750f2ee58d73710d8006a11ccf2c");
  assert.equal(bundle.artifacts.server.upstream.commit, bundle.artifacts.windows.upstream.commit);
  assert.equal(bundle.artifacts.windows.requiredBuildTag, "with_quic");
  assert.equal(bundle.artifacts.server.requiredBuildTag, "with_quic");
});

test("ignores formal v5 client target/evidence for ephemeral Windows Gray", () => {
  const bundle = buildDualMultipathGrayRuntimeBundle(grayDraft(), runtimeInput);
  assert.equal(bundle.sourceDraft.clientTargetIgnored, true);
  assert.equal(bundle.sourceDraft.clientEvidenceIgnored, true);
  assert.equal(bundle.safety.clientEvidenceWrite, false);
  assert.equal(bundle.safety.draftPersistenceWrite, false);
});
