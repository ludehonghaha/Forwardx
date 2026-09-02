import assert from "node:assert/strict";
import test from "node:test";
import {
  detectChinaCarrierProbe,
  hostProbeServiceAppliesToHost,
  inferChinaCarrierProbeRegion,
} from "./hostProbeCarrierHistory";

test("detects the existing Shanghai carrier probe targets without new metadata", () => {
  assert.equal(detectChinaCarrierProbe({ name: "自定义", targetIp: "202.96.209.5" }), "ct");
  assert.equal(detectChinaCarrierProbe({ name: "上海联通 CU", targetIp: "example.com" }), "cu");
  assert.equal(detectChinaCarrierProbe({ name: "上海移动 CM", targetIp: "example.com" }), "cm");
  assert.equal(detectChinaCarrierProbe({ name: "Cloudflare", targetIp: "1.1.1.1" }), null);
});

test("derives the display region from the existing service name", () => {
  assert.equal(inferChinaCarrierProbeRegion({ name: "上海电信 CT" }), "上海");
  assert.equal(inferChinaCarrierProbeRegion({ name: "北京移动 CM" }), "北京");
  assert.equal(inferChinaCarrierProbeRegion({ name: "CM" }), "未标地区");
});

test("keeps host scoping semantics identical to the advanced probe service", () => {
  assert.equal(hostProbeServiceAppliesToHost({ isEnabled: true, hostScope: "specific", hostIds: [3] }, 3), true);
  assert.equal(hostProbeServiceAppliesToHost({ isEnabled: true, hostScope: "specific", hostIds: [3] }, 4), false);
  assert.equal(hostProbeServiceAppliesToHost({ isEnabled: true, hostScope: "exclude", excludeHostIds: [3] }, 4), true);
  assert.equal(hostProbeServiceAppliesToHost({ isEnabled: true, hostScope: "exclude", excludeHostIds: [3] }, 3), false);
});
