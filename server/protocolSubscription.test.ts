import assert from "node:assert/strict";
import test from "node:test";
import { renderProtocolMihomoSubscription, renderProtocolUriSubscription } from "./protocolSubscription";
import { buildSubscriptionUserinfo } from "./protocolFeedRoutes";
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

function realityEntry(overrides: Partial<ProtocolFeedEntry> = {}): ProtocolFeedEntry {
  return entry({
    assignmentId: 21,
    endpointId: 21,
    name: "JP Reality",
    protocol: "vless_reality",
    publicHost: "reality.example.com",
    publicPort: 443,
    endpointConfig: {
      uuid: "550e8400-e29b-41d4-a716-446655440000",
      serverName: "www.cloudflare.com",
      realityDest: "www.cloudflare.com:443",
      realityPublicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      shortId: "0011223344556677",
      clientFingerprint: "chrome",
      udp: true,
    },
    credential: {},
    ...overrides,
  });
}

function hysteria2Entry(overrides: Partial<ProtocolFeedEntry> = {}): ProtocolFeedEntry {
  return entry({
    assignmentId: 22,
    endpointId: 22,
    name: "JP Hysteria2",
    protocol: "hysteria2",
    publicHost: "hy2.example.com",
    publicPort: 8443,
    endpointConfig: {
      password: "hy2-secret",
      sni: "www.cloudflare.com",
      insecure: true,
      obfsMode: "salamander",
      obfsPassword: "obfs-secret",
    },
    credential: {},
    ...overrides,
  });
}

function snellEntry(overrides: Partial<ProtocolFeedEntry> = {}): ProtocolFeedEntry {
  return entry({
    assignmentId: 23,
    endpointId: 23,
    name: "JP Snell",
    protocol: "snell",
    publicHost: "snell.example.com",
    publicPort: 1443,
    endpointConfig: { password: "snell-secret", version: 5, udp: true },
    credential: {},
    ...overrides,
  });
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

test("renders one external Mieru endpoint into simple URI and Mihomo formats", () => {
  const mieruEntry = entry({
    name: "Shanghai to Japan",
    protocol: "mieru",
    publicHost: "jp.example.com",
    publicPort: 22226,
    endpointConfig: {
      username: "shared user",
      password: "shared/password",
      transport: "TCP",
      mtu: 1400,
      multiplexing: "MULTIPLEXING_HIGH",
      handshakeMode: "HANDSHAKE_NO_WAIT",
      trafficPattern: "YWJjPQ==",
      udp: true,
    },
    credential: {},
  });

  const uri = renderProtocolUriSubscription([mieruEntry]);
  assert.equal(uri.included, 1);
  assert.deepEqual(uri.skipped, []);
  const decoded = Buffer.from(uri.content, "base64").toString("utf8");
  assert.equal(
    decoded,
    "mierus://shared%20user:shared%2Fpassword@jp.example.com"
      + "?handshake-mode=HANDSHAKE_NO_WAIT&mtu=1400&multiplexing=MULTIPLEXING_HIGH"
      + "&port=22226&profile=Shanghai%20to%20Japan&protocol=TCP&traffic-pattern=YWJjPQ%3D%3D",
  );

  const mihomo = renderProtocolMihomoSubscription([mieruEntry]);
  assert.equal(mihomo.included, 1);
  assert.match(mihomo.content, /type: mieru/);
  assert.match(mihomo.content, /port: 22226/);
  assert.match(mihomo.content, /transport: TCP/);
  assert.match(mihomo.content, /username: "shared user"/);
  assert.match(mihomo.content, /password: "shared\/password"/);
  assert.match(mihomo.content, /multiplexing: MULTIPLEXING_HIGH/);
  assert.match(mihomo.content, /handshake-mode: HANDSHAKE_NO_WAIT/);
  assert.match(mihomo.content, /traffic-pattern: "YWJjPQ=="/);
});

test("Mieru user assignment can override endpoint credentials without another user model", () => {
  const result = renderProtocolMihomoSubscription([entry({
    protocol: "mieru",
    endpointConfig: {
      username: "shared",
      password: "shared-secret",
      transport: "TCP",
      mtu: 1400,
      multiplexing: "MULTIPLEXING_LOW",
      handshakeMode: "HANDSHAKE_STANDARD",
    },
    credential: { username: "alice", password: "alice-secret" },
  })]);
  assert.equal(result.included, 1);
  assert.match(result.content, /username: "alice"/);
  assert.match(result.content, /password: "alice-secret"/);
  assert.doesNotMatch(result.content, /shared-secret/);
});

test("skips malformed Mieru configuration and credentials", () => {
  const result = renderProtocolMihomoSubscription([entry({
    protocol: "mieru",
    endpointConfig: {
      transport: "QUIC",
      mtu: 1500,
      multiplexing: "HIGH",
      handshakeMode: "FAST",
    },
    credential: {},
  })]);
  assert.equal(result.included, 0);
  assert.match(result.skipped[0]?.reason || "", /transport/);
  assert.match(result.skipped[0]?.reason || "", /mtu/);
  assert.match(result.skipped[0]?.reason || "", /username/);
  assert.match(result.skipped[0]?.reason || "", /password/);
});

test("renders Snell v5 into Mihomo without inventing a non-standard share URI", () => {
  const uri = renderProtocolUriSubscription([snellEntry()]);
  assert.equal(uri.included, 0);
  assert.match(uri.skipped[0]?.reason || "", /Snell.*Mihomo/);

  const mihomo = renderProtocolMihomoSubscription([snellEntry()]);
  assert.equal(mihomo.included, 1);
  assert.match(mihomo.content, /type: snell/);
  assert.match(mihomo.content, /psk: "snell-secret"/);
  assert.match(mihomo.content, /version: 5/);
  assert.match(mihomo.content, /udp: true/);
});

test("renders VLESS Reality into URI and Mihomo feeds", () => {
  const uri = renderProtocolUriSubscription([realityEntry()]);
  assert.equal(uri.included, 1);
  const decoded = Buffer.from(uri.content, "base64").toString("utf8");
  assert.match(decoded, /^vless:\/\/550e8400-e29b-41d4-a716-446655440000@reality\.example\.com:443\?/);
  assert.match(decoded, /security=reality/);
  assert.match(decoded, /flow=xtls-rprx-vision/);
  assert.match(decoded, /pbk=AAAAAAAA/);

  const mihomo = renderProtocolMihomoSubscription([realityEntry()]);
  assert.equal(mihomo.included, 1);
  assert.match(mihomo.content, /type: vless/);
  assert.match(mihomo.content, /flow: xtls-rprx-vision/);
  assert.match(mihomo.content, /reality-opts:/);
  assert.match(mihomo.content, /public-key: "AAAAAAAA/);
  assert.match(mihomo.content, /short-id: "0011223344556677"/);
});

test("renders Hysteria2 into URI and Mihomo feeds with Salamander and explicit h3 ALPN", () => {
  const uri = renderProtocolUriSubscription([hysteria2Entry()]);
  assert.equal(uri.included, 1);
  const decoded = Buffer.from(uri.content, "base64").toString("utf8");
  assert.match(decoded, /^hysteria2:\/\/hy2-secret@hy2\.example\.com:8443\/\?/);
  assert.match(decoded, /sni=www.cloudflare.com/);
  assert.match(decoded, /alpn=h3/);
  assert.match(decoded, /obfs=salamander/);

  const mihomo = renderProtocolMihomoSubscription([hysteria2Entry()]);
  assert.equal(mihomo.included, 1);
  assert.match(mihomo.content, /type: hysteria2/);
  assert.match(mihomo.content, /password: "hy2-secret"/);
  assert.match(mihomo.content, /sni: "www.cloudflare.com"\n    alpn:\n      - "h3"/);
  assert.match(mihomo.content, /skip-cert-verify: true/);
  assert.match(mihomo.content, /obfs: salamander/);
});

test("Hysteria2 subscriptions preserve an explicit ALPN list", () => {
  const custom = hysteria2Entry({
    endpointConfig: {
      password: "hy2-secret",
      sni: "example.com",
      insecure: true,
      alpn: ["h3", "custom-hy2"],
    },
  });
  const uri = renderProtocolUriSubscription([custom]);
  const decoded = Buffer.from(uri.content, "base64").toString("utf8");
  assert.match(decoded, /alpn=h3%2Ccustom-hy2/);

  const mihomo = renderProtocolMihomoSubscription([custom]);
  assert.match(mihomo.content, /alpn:\n      - "h3"\n      - "custom-hy2"/);
});

test("one total Mihomo subscription preserves all selected entry protocols", () => {
  const result = renderProtocolMihomoSubscription([
    snellEntry(),
    realityEntry(),
    hysteria2Entry(),
  ]);
  assert.equal(result.included, 3);
  assert.deepEqual(result.skipped, []);
  assert.equal((result.content.match(/  - name:/g) || []).length, 3);
  assert.match(result.content, /type: snell/);
  assert.match(result.content, /type: vless/);
  assert.match(result.content, /type: hysteria2/);
});

test("generic URI feed keeps Reality and Hysteria2 when Snell is skipped", () => {
  const result = renderProtocolUriSubscription([
    snellEntry(),
    realityEntry(),
    hysteria2Entry(),
  ]);
  assert.equal(result.included, 2);
  assert.equal(result.skipped.length, 1);
  const decoded = Buffer.from(result.content, "base64").toString("utf8");
  assert.match(decoded, /vless:\/\//);
  assert.match(decoded, /hysteria2:\/\//);
});

test("subscription userinfo omits expire when the access feed has no expiry", () => {
  const header = buildSubscriptionUserinfo({ trafficUsed: 123, trafficLimit: 456, expiresAt: null });
  assert.equal(header, "upload=0; download=123; total=456");
  assert.doesNotMatch(header, /(?:^|; )expire=/);
});

test("subscription userinfo includes a real Unix expiry when configured", () => {
  const expiresAt = "2026-12-31T16:00:00.000Z";
  const expected = Math.floor(new Date(expiresAt).getTime() / 1000);
  const header = buildSubscriptionUserinfo({ trafficUsed: 123, trafficLimit: 456, expiresAt });
  assert.equal(header, `upload=0; download=123; total=456; expire=${expected}`);
});
