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

const verifiedClientEndpoint = {
  status: "verified-read-only" as const,
  endpoint: { server: "211.136.162.188", port: 11464, protocol: "TCP" as const },
  evidence: {
    snapshotId: "windows-mieru-established-20260830",
    targetId: "nobrand-windows-gray",
    observedAt: "2026-08-30T12:57:41.381Z",
    discoverySource: "windows-established-tcp-connection" as const,
  },
};

test("pins only official enfein/mieru v3.36.0 artifacts", () => {
  assert.equal(DUAL_MIERU_UPSTREAM.repository, "enfein/mieru");
  assert.equal(DUAL_MIERU_UPSTREAM.version, "3.36.0");
  assert.equal(DUAL_MIERU_UPSTREAM.commit, "155ebbd60f86e472586a60d7ffe58ec8f8682cb1");
  assert.equal(DUAL_MIERU_UPSTREAM.assets.windowsAmd64.sha256, "f0136fa3bbfb1489a0a41c1ef5c3aa58ecf5b4793dc51d5a813cf7f5803017d1");
  assert.equal(DUAL_MIERU_UPSTREAM.license, "GPL-3.0");
});

test("keeps the server private interface separate from the verified client-visible ingress", () => {
  assert.equal(draft.serverTargetDiscovery.status, "verified-read-only");
  if (draft.serverTargetDiscovery.status !== "verified-read-only") throw new Error("expected server discovery");
  assert.equal(draft.serverTargetDiscovery.privateSide.sourceAddress, "172.16.4.114");

  const config = buildDualMieruClientConfigTemplate(draft, 24181, verifiedClientEndpoint);
  assert.equal(config.socks5Port, 24181);
  assert.equal(config.socks5ListenLAN, false);
  assert.equal(config.rpcPort, 0);
  assert.equal(config.profiles[0].servers[0].ipAddress, "211.136.162.188");
  assert.notEqual(config.profiles[0].servers[0].ipAddress, draft.serverTargetDiscovery.privateSide.sourceAddress);
  assert.deepEqual(config.profiles[0].servers[0].portBindings, [{ port: 11464, protocol: "TCP" }]);
  assert.equal(config.profiles[0].user.name, "<secret:dual.mieru.username>");
  assert.equal(config.profiles[0].user.password, "<secret:dual.mieru.password>");
  assert.doesNotMatch(JSON.stringify(config), /Clash|Mihomo|7890/i);
});

test("materializes only caller-provided ephemeral credentials", () => {
  const config = materializeDualMieruClientConfig(draft, 24181, verifiedClientEndpoint, {
    username: "synthetic-user",
    password: "synthetic-password",
  });
  assert.equal(config.profiles[0].user.name, "synthetic-user");
  assert.equal(config.profiles[0].user.password, "synthetic-password");
  assert.equal(config.socks5ListenLAN, false);
});

test("fails closed when the client-visible Mieru ingress is unresolved", () => {
  assert.throws(
    () => buildDualMieruClientConfigTemplate(draft, 24181, { status: "unresolved", endpoint: null }),
    /verified client-visible private carrier endpoint/,
  );
});

test("does not infer a client endpoint after the server private interface changes", () => {
  const otherDraft = {
    ...draft,
    serverTargetDiscovery: {
      ...draft.serverTargetDiscovery,
      privateSide: {
        interfaceName: "ens8",
        sourceAddress: "10.44.0.12",
        addresses: ["10.44.0.12/24"],
      },
    },
  };
  const config = buildDualMieruClientConfigTemplate(otherDraft, 24181, verifiedClientEndpoint);
  assert.equal(config.profiles[0].servers[0].ipAddress, "211.136.162.188");
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
    }, 24181, verifiedClientEndpoint);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.equal(message.includes(raw), false);
  assert.match(message, /secret reference|Invalid input/i);
});
