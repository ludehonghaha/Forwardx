import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveHostProbeJitterMs,
  normalizeHostProbeMetadata,
} from "../shared/hostProbeMetadata";

test("legacy probe metadata defaults to custom", () => {
  assert.deepEqual(normalizeHostProbeMetadata(), {
    probeKind: "custom",
    carrier: null,
    region: null,
  });
});

test("custom probe ignores carrier while preserving optional region", () => {
  assert.deepEqual(normalizeHostProbeMetadata({
    probeKind: "custom",
    carrier: "cm",
    region: " Shanghai ",
  }), {
    probeKind: "custom",
    carrier: null,
    region: "Shanghai",
  });
});

test("china carrier metadata accepts ct cu and cm", () => {
  for (const carrier of ["ct", "cu", "cm"] as const) {
    assert.deepEqual(normalizeHostProbeMetadata({ probeKind: "china_carrier", carrier }), {
      probeKind: "china_carrier",
      carrier,
      region: null,
    });
  }
});

test("china carrier metadata requires a valid carrier", () => {
  assert.throws(
    () => normalizeHostProbeMetadata({ probeKind: "china_carrier" }),
    /ct \/ cu \/ cm/,
  );
  assert.throws(
    () => normalizeHostProbeMetadata({ probeKind: "china_carrier", carrier: "other" }),
    /ct \/ cu \/ cm/,
  );
});

test("jitter needs at least two successful latency samples", () => {
  assert.equal(deriveHostProbeJitterMs([]), null);
  assert.equal(deriveHostProbeJitterMs([{ latencyMs: 100 }]), null);
  assert.equal(deriveHostProbeJitterMs([{ latencyMs: 100, isTimeout: true }, { latencyMs: 120 }]), null);
});

test("jitter is the average absolute delta between consecutive successes", () => {
  assert.equal(deriveHostProbeJitterMs([
    { latencyMs: 100 },
    { latencyMs: 110 },
    { latencyMs: 105 },
  ]), 8);
});

test("jitter ignores timeout rows and uses at most the newest ten successful samples", () => {
  const samples = [
    { latencyMs: 1 },
    { latencyMs: 2 },
    { latencyMs: 1000, isTimeout: true },
    ...Array.from({ length: 10 }, (_, index) => ({ latencyMs: 10 + index * 2 })),
  ];
  assert.equal(deriveHostProbeJitterMs(samples), 2);
});
