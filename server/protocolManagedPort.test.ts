import assert from "node:assert/strict";
import test from "node:test";
import { clearHostPortReservationsForTest } from "./portReservations";
import { reserveManagedProtocolPort } from "./protocolManagedPort";

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
