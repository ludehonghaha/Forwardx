import assert from "node:assert/strict";
import test from "node:test";
import { clearHostPortReservationsForTest } from "./portReservations";
import { reserveManagedProtocolPort } from "./protocolManagedPort";
import {
  managedProtocolTrafficOwnerUserId,
  protocolTrafficBridgeMarker,
  selectProtocolTrafficBridgeForwardType,
  withoutProtocolTrafficBridgeMarker,
} from "./protocolTrafficBridge";

function candidateFinder(start: number) {
  return async (excludedPorts: number[]) => {
    const excluded = new Set(excludedPorts);
    for (let port = start; port < start + 20; port += 1) {
      if (!excluded.has(port)) return port;
    }
    return null;
  };
}

test("managed protocol auto port skips a port that becomes occupied", async () => {
  clearHostPortReservationsForTest();
  const checked: number[] = [];
  const reservation = await reserveManagedProtocolPort({
    hostId: 7,
    protocol: "tcp",
    findAvailablePort: candidateFinder(24000),
    isPortUsed: async (port) => {
      checked.push(port);
      return port === 24000;
    },
  });
  assert.equal(reservation?.port, 24001);
  assert.deepEqual(checked, [24000, 24001]);
  reservation?.release();
  clearHostPortReservationsForTest();
});

test("concurrent managed protocol allocations cannot reserve the same host port", async () => {
  clearHostPortReservationsForTest();
  const allocate = () => reserveManagedProtocolPort({
    hostId: 9,
    protocol: "udp",
    findAvailablePort: candidateFinder(25000),
    isPortUsed: async () => false,
  });
  const [first, second] = await Promise.all([allocate(), allocate()]);
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.port, second.port);
  assert.deepEqual([first.port, second.port].sort((left, right) => left - right), [25000, 25001]);
  first.release();
  second.release();
  clearHostPortReservationsForTest();
});

test("managed protocol traffic attribution accepts one enabled user and ignores disabled assignments", () => {
  const owner = managedProtocolTrafficOwnerUserId([
    { access: { userId: 21, isEnabled: true }, user: { id: 21 } },
    { access: { userId: 22, isEnabled: false }, user: { id: 22 } },
  ]);
  assert.equal(owner, 21);
});

test("managed protocol traffic attribution rejects multiple enabled users on shared credentials", () => {
  assert.throws(() => managedProtocolTrafficOwnerUserId([
    { access: { userId: 21, isEnabled: true }, user: { id: 21 } },
    { access: { userId: 22, isEnabled: true }, user: { id: 22 } },
  ]), /无法把同一监听端口的流量准确拆分给多个用户/);
});

test("protocol traffic bridge marker is strict and removable from endpoint config", () => {
  const config = {
    cipher: "aes-256-gcm",
    _forwardxTrafficBridge: {
      version: 1,
      managed: true,
      ruleId: 31,
      ownerUserId: 21,
      publicPort: 30001,
      listenPort: 31001,
    },
  };
  assert.deepEqual(protocolTrafficBridgeMarker(config), {
    version: 1,
    managed: true,
    ruleId: 31,
    ownerUserId: 21,
    publicPort: 30001,
    listenPort: 31001,
  });
  assert.deepEqual(withoutProtocolTrafficBridgeMarker(config), { cipher: "aes-256-gcm" });
  assert.equal(protocolTrafficBridgeMarker({
    _forwardxTrafficBridge: { version: 1, managed: true, ruleId: 0, ownerUserId: 21, publicPort: 30001, listenPort: 31001 },
  }), null);
});

test("protocol traffic bridge prefers process forwarding and respects disabled settings", () => {
  assert.equal(selectProtocolTrafficBridgeForwardType({ gost: true, realm: true }), "gost");
  assert.equal(selectProtocolTrafficBridgeForwardType({ gost: false, realm: true }), "realm");
  assert.equal(selectProtocolTrafficBridgeForwardType({
    gost: false,
    realm: false,
    socat: false,
    iptables: false,
    nftables: false,
    nginx: false,
  }), null);
});