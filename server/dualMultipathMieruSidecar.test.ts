import assert from "node:assert/strict";
import test from "node:test";
import { defaultDualMultipathInfrastructure } from "./dualMultipathControlPlane";
import {
  DUAL_MIERU_UPSTREAM,
  buildDualMieruClientConfigTemplate,
  materializeDualMieruClientConfig,
} from "./dualMultipathMieruSidecar";

const draft = {
  version: 5 as const,
  state: "draft" as const,
  name: "NoBrand Dual Mieru Gray",
  ...defaultDualMultipathInfrastructure(),
};

test("pins only official enfein/mieru v3.36.0 artifacts", () => {
  assert.equal(DUAL_MIERU_UPSTREAM.repository, "enfein/mieru");
  assert.equal(DUAL_MIERU_UPSTREAM.version, "3.36.0");
  assert.equal(DUAL_MIERU_UPSTREAM.commit, "155ebbd60f86e472586a60d7ffe58ec8f8682cb1");
  assert.equal(DUAL_MIERU_UPSTREAM.assets.windowsAmd64.sha256, "f0136fa3bbfb1489a0a41c1ef5c3aa58ecf5b4793dc51d5a813cf7f5803017d1");
  assert.equal(DUAL_MIERU_UPSTREAM.license, "GPL-3.0");
});

test("builds a loopback-only Mieru template from discovery and secret references", () => {
  const config = buildDualMieruClientConfigTemplate(draft, 24181);
  assert.equal(config.socks5Port, 24181);
  assert.equal(config.socks5ListenLAN, false);
  assert.equal(config.rpcPort, 0);
  assert.equal(config.profiles[0].servers[0].ipAddress, "172.16.4.114");
  assert.deepEqual(config.profiles[0].servers[0].portBindings, [{ port: 11464, protocol: "TCP" }]);
  assert.equal(config.profiles[0].user.name, "<secret:dual.mieru.username>");
  assert.equal(config.profiles[0].user.password, "<secret:dual.mieru.password>");
  assert.doesNotMatch(JSON.stringify(config), /Clash|Mihomo|7890/i);
});

test("materializes only caller-provided ephemeral credentials", () => {
  const config = materializeDualMieruClientConfig(draft, 24181, {
    username: "synthetic-user",
    password: "synthetic-password",
  });
  assert.equal(config.profiles[0].user.name, "synthetic-user");
  assert.equal(config.profiles[0].user.password, "synthetic-password");
  assert.equal(config.socks5ListenLAN, false);
});

test("rejects non dual secret references without echoing rejected values", () => {
  const raw = "REAL-MIERU-PASSWORD";
  let message = "";
  try {
    buildDualMieruClientConfigTemplate({
      ...draft,
      privateCarrierBridge: {
        ...draft.privateCarrierBridge,
        carrier: { ...draft.privateCarrierBridge.carrier, passwordSecretRef: raw },
      },
    }, 24181);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.equal(message.includes(raw), false);
  assert.match(message, /secret reference|Invalid input/i);
});
