import assert from "node:assert/strict";
import test from "node:test";
import {
  MULTIPATH_POC_UPSTREAM,
  buildMultipathPocInbound,
  buildMultipathPocOutbound,
  type MultipathPocLeg,
  type MultipathPocLine,
} from "./multipathPocPlan";

const line: MultipathPocLine = {
  id: 1,
  server: "10.66.67.1",
  serverPort: 39000,
};

const legs: MultipathPocLeg[] = [
  { legIndex: 0, outboundTag: "dedicated", expectedBandwidthMbps: 160, supportsUdp: true },
  { legIndex: 1, outboundTag: "hy2-public", expectedBandwidthMbps: 700, supportsUdp: true },
];

test("pins the experimental upstream protocol generation", () => {
  assert.deepEqual(MULTIPATH_POC_UPSTREAM, {
    repository: "WuSiYu/singbox-multipath",
    branch: "multipath-poc3",
    commit: "1c36787d956d750f2ee58d73710d8006a11ccf2c",
    protocolGeneration: "v4",
  });
});

test("compiles a two-leg client outbound with conservative PoC defaults", () => {
  assert.deepEqual(buildMultipathPocOutbound(line, legs), {
    type: "multipath",
    tag: "forwardx-multipath-1",
    outbounds: ["dedicated", "hy2-public"],
    preferred: "dedicated",
    udp_outbound: "dedicated",
    server: "10.66.67.1",
    server_port: 39000,
    tcp_fast_open: true,
    activation_threshold_mbps: 120,
    activation_window: "1s",
    chunk_size: 65536,
    queue_frames: 256,
    max_reorder_bytes: 67108864,
    leg1_replay_bytes: 67108864,
    leg1_replay_timeout: "5s",
    handshake_timeout: "10s",
    bandwidth_mbps: [160, 700],
  });
});

test("compiles the matching server inbound without copying child credentials", () => {
  const inbound = buildMultipathPocInbound(line, legs) as Record<string, unknown> | null;
  assert.equal(inbound?.type, "multipath");
  assert.equal(inbound?.listen, "0.0.0.0");
  assert.equal(inbound?.listen_port, 39000);
  assert.deepEqual(inbound?.bandwidth_mbps, [160, 700]);
  assert.equal(inbound?.max_reorder_frames, 2048);
  assert.equal(JSON.stringify(inbound).includes("password"), false);
  assert.equal(JSON.stringify(inbound).includes("outbounds"), false);
});

test("allows explicit leg preference and UDP delegation", () => {
  const outbound = buildMultipathPocOutbound({ ...line, preferredLegIndex: 1, udpLegIndex: 1 }, legs);
  assert.equal(outbound?.preferred, "hy2-public");
  assert.equal(outbound?.udp_outbound, "hy2-public");
});

test("rejects malformed leg sets and an unusable UDP fallback", () => {
  assert.equal(buildMultipathPocOutbound(line, [legs[0]]), null);
  assert.equal(buildMultipathPocOutbound(line, [legs[0], { ...legs[1], legIndex: 0 }]), null);
  assert.equal(buildMultipathPocOutbound(line, [legs[0], { ...legs[1], outboundTag: "dedicated" }]), null);
  assert.equal(buildMultipathPocOutbound({ ...line, udpLegIndex: 1 }, [legs[0], { ...legs[1], supportsUdp: false }]), null);
});

test("rejects invalid ports and queue memory above the upstream safety bound", () => {
  assert.equal(buildMultipathPocOutbound({ ...line, serverPort: 70000 }, legs), null);
  assert.equal(buildMultipathPocOutbound({ ...line, chunkSize: 1024 * 1024, queueFrames: 4096 }, legs), null);
});
