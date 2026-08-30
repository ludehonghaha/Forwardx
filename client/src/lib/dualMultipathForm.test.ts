import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDualMultipathDraftFromForm,
  defaultDualMultipathForm,
  dualMultipathFormFromDraft,
} from "./dualMultipathForm";

test("defaults the same-host Dual target to loopback", () => {
  const form = defaultDualMultipathForm();
  assert.equal(form.server, "127.0.0.1");
  const draft = buildDualMultipathDraftFromForm(form);
  assert.equal(draft.line.server, "127.0.0.1");
  assert.equal(draft.line.listen, "127.0.0.1");
});

test("builds the fixed private-leg-first Dual draft", () => {
  const form = defaultDualMultipathForm();
  form.server = "10.66.67.1";
  const draft = buildDualMultipathDraftFromForm(form);
  assert.equal(draft.version, 2);
  assert.equal(draft.state, "draft");
  assert.equal(draft.line.serverPort, 39000);
  assert.equal(draft.line.preferredLegIndex, 0);
  assert.equal(draft.line.udpLegIndex, 0);
  assert.equal(draft.line.activationThresholdMbps, 120);
  assert.equal(draft.legs[0].role, "private");
  assert.equal(draft.legs[0].outboundTag, "dedicated");
  assert.equal(draft.legs[1].role, "direct");
  assert.equal(draft.legs[1].outboundTag, "hy2-public");
  assert.deepEqual(draft.carriers.private, {
    type: "local-socks5",
    host: "127.0.0.1",
    port: 1080,
  });
  assert.equal(draft.carriers.direct.type, "hysteria2");
  assert.equal(draft.carriers.direct.authSecretRef, "dual.hy2.auth");
  assert.deepEqual(draft.clientSidecar, {
    type: "local-socks-sidecar",
    listen: "127.0.0.1",
    listenPort: 10808,
  });
});

test("rejects ambiguous or unusable topology before API submission", () => {
  const sameTag = defaultDualMultipathForm();
  sameTag.directOutboundTag = sameTag.privateOutboundTag;
  assert.throws(() => buildDualMultipathDraftFromForm(sameTag), /不同的 outbound tag/);

  const halfBandwidth = defaultDualMultipathForm();
  halfBandwidth.directBandwidthMbps = "";
  assert.throws(() => buildDualMultipathDraftFromForm(halfBandwidth), /要么都填写/);

  const invalidUdp = defaultDualMultipathForm();
  invalidUdp.udpLegIndex = "1";
  invalidUdp.directSupportsUdp = false;
  assert.throws(() => buildDualMultipathDraftFromForm(invalidUdp), /直连已标记为不支持 UDP/);

  const halfSocksAuth = defaultDualMultipathForm();
  halfSocksAuth.privateUsernameSecretRef = "dual.mieru.username";
  assert.throws(() => buildDualMultipathDraftFromForm(halfSocksAuth), /必须同时填写/);

  const publicSidecar = defaultDualMultipathForm();
  publicSidecar.openClashSocksListen = "0.0.0.0";
  assert.throws(() => buildDualMultipathDraftFromForm(publicSidecar), /只允许 127\.0\.0\.1/);

  const rawSecret = defaultDualMultipathForm();
  rawSecret.directHy2AuthSecretRef = "REAL-HY2-SUPER-SECRET";
  assert.throws(() => buildDualMultipathDraftFromForm(rawSecret), /必须使用 dual\.\*/);
});

test("hydrates a persisted draft back into editable form state", () => {
  const form = dualMultipathFormFromDraft({
    name: "Dual 灰度",
    line: {
      server: "198.51.100.8",
      serverPort: 39100,
      activationThresholdMbps: 180,
      activationWindow: "2s",
      udpLegIndex: 1,
      tcpFastOpen: false,
    },
    legs: [
      { outboundTag: "private-line", expectedBandwidthMbps: 200, supportsUdp: true },
      { outboundTag: "direct-hy2", expectedBandwidthMbps: 800, supportsUdp: true },
    ],
    carriers: {
      private: {
        type: "local-socks5",
        host: "127.0.0.1",
        port: 2080,
        usernameSecretRef: "dual.mieru.username",
        passwordSecretRef: "dual.mieru.password",
      },
      direct: {
        type: "hysteria2",
        server: "dual-gray.example.invalid",
        serverPort: 8443,
        tls: { serverName: "tls.example.invalid" },
        authSecretRef: "dual.gray.hy2.auth",
      },
    },
    clientSidecar: {
      type: "local-socks-sidecar",
      listen: "127.0.0.1",
      listenPort: 20808,
    },
  });
  assert.equal(form.name, "Dual 灰度");
  assert.equal(form.server, "198.51.100.8");
  assert.equal(form.serverPort, "39100");
  assert.equal(form.privateOutboundTag, "private-line");
  assert.equal(form.directOutboundTag, "direct-hy2");
  assert.equal(form.activationThresholdMbps, "180");
  assert.equal(form.activationWindow, "2s");
  assert.equal(form.udpLegIndex, "1");
  assert.equal(form.tcpFastOpen, false);
  assert.equal(form.privateSocksPort, "2080");
  assert.equal(form.privateUsernameSecretRef, "dual.mieru.username");
  assert.equal(form.privatePasswordSecretRef, "dual.mieru.password");
  assert.equal(form.directHy2Server, "dual-gray.example.invalid");
  assert.equal(form.directHy2ServerPort, "8443");
  assert.equal(form.directHy2TlsServerName, "tls.example.invalid");
  assert.equal(form.directHy2AuthSecretRef, "dual.gray.hy2.auth");
  assert.equal(form.openClashSocksPort, "20808");
});

test("hydrates legacy drafts without a target to the safe loopback default", () => {
  const form = dualMultipathFormFromDraft({ line: {}, legs: [] });
  assert.equal(form.server, "127.0.0.1");
});
