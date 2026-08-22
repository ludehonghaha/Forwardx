import assert from "node:assert/strict";
import test from "node:test";
import { renderProtocolMihomoSubscription, renderProtocolUriSubscription } from "./protocolSubscription";
import type { ProtocolFeedEntry } from "../shared/protocolAccess";

function entry(overrides: Partial<ProtocolFeedEntry> = {}): ProtocolFeedEntry {
  return {
    assignmentId: 11,
    endpointId: 7,
    name: "NoBrand SS",
    protocol: "shadowsocks",
    publicHost: "211.136.162.184",
    publicPort: 13511,
    endpointConfig: { cipher: "2022-blake3-aes-256-gcm", password: "shared-secret", udp: false },
    credential: {},
    ...overrides,
  };
}

test("renders a SIP002 Shadowsocks URI feed without an extra runtime", () => {
  const result = renderProtocolUriSubscription([entry()]);
  assert.equal(result.included, 1);
  assert.deepEqual(result.skipped, []);
  const decoded = Buffer.from(result.content, "base64").toString("utf8");
  assert.match(decoded, /^ss:\/\//);
  assert.match(decoded, /@211\.136\.162\.184:13511#/);
  assert.match(decoded, /NoBrand%20SS$/);
});

test("assignment password overrides a shared endpoint password", () => {
  const result = renderProtocolMihomoSubscription([
    entry({ credential: { password: "per-user-secret" } }),
  ]);
  assert.equal(result.included, 1);
  assert.match(result.content, /password: "per-user-secret"/);
  assert.doesNotMatch(result.content, /shared-secret/);
});

test("does not trim protocol passwords", () => {
  const result = renderProtocolMihomoSubscription([
    entry({ credential: { password: " secret with spaces " } }),
  ]);
  assert.match(result.content, /password: " secret with spaces "/);
});

test("renders SS-over-SSH only in the Mihomo feed", () => {
  const sshEntry = entry({
    protocol: "shadowsocks_ssh",
    publicPort: 13500,
    endpointConfig: {
      cipher: "2022-blake3-aes-256-gcm",
      remotePort: 13511,
      sshUsername: "tunnel",
      sshPrivateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----",
    },
    credential: { password: "per-user-secret" },
  });

  const uri = renderProtocolUriSubscription([sshEntry]);
  assert.equal(uri.included, 0);
  assert.match(uri.skipped[0]?.reason || "", /Mihomo/);

  const mihomo = renderProtocolMihomoSubscription([sshEntry]);
  assert.equal(mihomo.included, 1);
  assert.match(mihomo.content, /type: ssh/);
  assert.match(mihomo.content, /dialer-proxy: "NoBrand SS · SSH"/);
  assert.match(mihomo.content, /port: 13511/);
  assert.match(mihomo.content, /only-tcp: true/);
});

test("skips invalid credentials instead of emitting a broken node", () => {
  const result = renderProtocolMihomoSubscription([
    entry({ endpointConfig: { cipher: "aes-256-gcm" }, credential: {} }),
  ]);
  assert.equal(result.included, 0);
  assert.equal(result.content, "proxies: []\n");
  assert.match(result.skipped[0]?.reason || "", /password/);
});

test("brackets IPv6 hosts in SIP002 links", () => {
  const result = renderProtocolUriSubscription([entry({ publicHost: "2001:db8::1" })]);
  const decoded = Buffer.from(result.content, "base64").toString("utf8");
  assert.match(decoded, /@\[2001:db8::1\]:13511#/);
});
