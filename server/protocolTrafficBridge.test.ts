import assert from "node:assert/strict";
import test from "node:test";
import {
  managedProtocolTrafficBridgeMatches,
  managedProtocolTrafficOwnerUserId,
  protocolTrafficBridgeMarker,
  selectProtocolTrafficBridgeForwardType,
  withoutProtocolTrafficBridgeMarker,
} from "./protocolTrafficBridge";

test("managed protocol traffic owner accepts one enabled user and rejects ambiguous ownership", () => {
  assert.equal(managedProtocolTrafficOwnerUserId([
    { access: { userId: 7, isEnabled: true }, user: { id: 7 } },
    { access: { userId: 8, isEnabled: false }, user: { id: 8 } },
  ]), 7);
  assert.throws(() => managedProtocolTrafficOwnerUserId([
    { access: { userId: 7, isEnabled: true }, user: { id: 7 } },
    { access: { userId: 8, isEnabled: true }, user: { id: 8 } },
  ]), /无法把同一监听端口的流量准确拆分给多个用户/);
});

test("traffic bridge marker round-trips and can be removed without changing other config", () => {
  const config = {
    listenPort: 25001,
    password: "secret",
    _forwardxTrafficBridge: {
      version: 1,
      managed: true,
      ruleId: 41,
      ownerUserId: 9,
      publicPort: 24001,
      listenPort: 25001,
    },
  };
  assert.deepEqual(protocolTrafficBridgeMarker(config), {
    version: 1,
    managed: true,
    ruleId: 41,
    ownerUserId: 9,
    publicPort: 24001,
    listenPort: 25001,
  });
  assert.deepEqual(withoutProtocolTrafficBridgeMarker(config), {
    listenPort: 25001,
    password: "secret",
  });
});

test("traffic bridge structural match detects endpoint or rule drift", () => {
  const config = {
    listenPort: 25001,
    password: "secret",
    udp: false,
    _forwardxTrafficBridge: {
      version: 1,
      managed: true,
      ruleId: 41,
      ownerUserId: 9,
      publicPort: 24001,
      listenPort: 25001,
    },
  };
  const marker = protocolTrafficBridgeMarker(config);
  const endpoint = {
    id: 3,
    hostId: 5,
    forwardRuleId: 41,
    protocol: "shadowsocks",
    publicPort: 24001,
    configJson: JSON.stringify(config),
  };
  const rule = {
    id: 41,
    userId: 9,
    hostId: 5,
    sourcePort: 24001,
    targetIp: "127.0.0.1",
    targetPort: 25001,
    protocol: "tcp",
    forwardType: "gost",
    tunnelId: null,
    forwardGroupId: null,
    isForwardGroupTemplate: false,
    pendingDelete: false,
  };
  assert.equal(managedProtocolTrafficBridgeMatches({ endpoint, ownerUserId: 9, marker, linkedRule: rule }), true);
  assert.equal(managedProtocolTrafficBridgeMatches({
    endpoint: { ...endpoint, publicPort: 24002 },
    ownerUserId: 9,
    marker,
    linkedRule: rule,
  }), false);
  assert.equal(managedProtocolTrafficBridgeMatches({
    endpoint,
    ownerUserId: 9,
    marker,
    linkedRule: { ...rule, protocol: "udp" },
  }), false);
  assert.equal(managedProtocolTrafficBridgeMatches({
    endpoint,
    ownerUserId: 10,
    marker,
    linkedRule: rule,
  }), false);
});

test("traffic bridge backend never falls back to loopback-sensitive NAT forwarding", () => {
  assert.equal(selectProtocolTrafficBridgeForwardType({ gost: true }), "gost");
  assert.equal(selectProtocolTrafficBridgeForwardType({ gost: false, realm: true }), "realm");
  assert.equal(selectProtocolTrafficBridgeForwardType({ gost: false, realm: false, socat: true }), "socat");
  assert.equal(selectProtocolTrafficBridgeForwardType({ gost: false, realm: false, socat: false, nginx: true }), "nginx");
  assert.equal(selectProtocolTrafficBridgeForwardType({
    gost: false,
    realm: false,
    socat: false,
    nginx: false,
    iptables: true,
    nftables: true,
  }), null);
});
