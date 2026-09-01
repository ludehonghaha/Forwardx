import assert from "node:assert/strict";
import test from "node:test";
import type { ProtocolFeedEntry } from "../shared/protocolAccess";
import {
  ProtocolFeedIpv6UnavailableError,
  parseProtocolFeedIpVersion,
  selectProtocolFeedAddressFamily,
} from "./protocolFeedIpVersion";
import { renderProtocolUriSubscription } from "./protocolSubscription";

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

test("missing ipVersion keeps the existing IPv4 feed", () => {
  const source = [entry()];
  const ipVersion = parseProtocolFeedIpVersion(undefined);
  const selected = selectProtocolFeedAddressFamily(source, ipVersion, new Map([[7, "2001:db8::7"]]));
  assert.equal(ipVersion, "4");
  assert.equal(selected[0]?.publicHost, "211.136.162.184");
});

test("explicit IPv4 keeps the existing public host", () => {
  const selected = selectProtocolFeedAddressFamily(
    [entry()],
    parseProtocolFeedIpVersion("4"),
    new Map([[7, "2001:db8::7"]]),
  );
  assert.equal(selected[0]?.publicHost, "211.136.162.184");
});

test("explicit IPv6 selects the host IPv6 address", () => {
  const selected = selectProtocolFeedAddressFamily(
    [entry()],
    parseProtocolFeedIpVersion("6"),
    new Map([[7, "2001:db8::7"]]),
  );
  assert.equal(selected[0]?.publicHost, "2001:db8::7");
});

test("explicit IPv6 skips IPv4-only endpoints without falling back", () => {
  const selected = selectProtocolFeedAddressFamily(
    [
      entry(),
      entry({ assignmentId: 12, endpointId: 8, name: "IPv4 only", publicHost: "198.51.100.8", publicPort: 13512 }),
    ],
    "6",
    new Map([[7, "2001:db8::7"]]),
  );
  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.endpointId, 7);
  assert.equal(selected[0]?.publicHost, "2001:db8::7");
  assert.ok(!selected.some((item) => item.publicHost === "198.51.100.8"));
});

test("IPv6 URI literals are bracketed", () => {
  const selected = selectProtocolFeedAddressFamily(
    [entry()],
    "6",
    new Map([[7, "2001:db8::7"]]),
  );
  const rendered = renderProtocolUriSubscription(selected);
  const decoded = Buffer.from(rendered.content, "base64").toString("utf8");
  assert.match(decoded, /@\[2001:db8::7\]:13511#/);
});

test("explicit IPv6 still fails when no endpoint has IPv6", () => {
  assert.throws(
    () => selectProtocolFeedAddressFamily([entry()], "6", new Map()),
    (error: unknown) => error instanceof ProtocolFeedIpv6UnavailableError
      && /没有可用 IPv6 地址/.test(error.message),
  );
});
