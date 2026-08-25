import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveLocalForwardXTransportVersion,
  resolveRuleTrafficPortForHost,
  shouldForceStoppedRuleCleanup,
  stoppedForwardRuleNeedsRemoval,
} from "./agentRuntimeRuleState";

test("shared tunnel runtime keeps the public source port on entry hosts", () => {
  assert.equal(resolveRuleTrafficPortForHost({
    sourcePort: 53874,
    usesTunnelRuntime: true,
    isEntry: true,
    exitPorts: [],
  }), 53874);
});

test("shared tunnel runtime uses the internal listener on exit-only hosts", () => {
  assert.equal(resolveRuleTrafficPortForHost({
    sourcePort: 53874,
    usesTunnelRuntime: true,
    isEntry: false,
    exitPorts: [61560],
  }), 61560);
});

test("direct rules always keep their source port", () => {
  assert.equal(resolveRuleTrafficPortForHost({
    sourcePort: 55503,
    usesTunnelRuntime: false,
    isEntry: false,
    exitPorts: [60000],
  }), 55503);
});

test("local ForwardX transport version survives a deleted tunnel record", () => {
  assert.equal(resolveLocalForwardXTransportVersion({
    reportedTransportVersion: "v2",
    tunnel: undefined,
  }), "v2");
});

test("missing local ForwardX transport version stays unknown after tunnel deletion", () => {
  assert.equal(resolveLocalForwardXTransportVersion({
    reportedTransportVersion: undefined,
    tunnel: undefined,
  }), undefined);
});

test("legacy local state falls back to the retained tunnel version", () => {
  assert.equal(resolveLocalForwardXTransportVersion({
    tunnel: { mode: "forwardx", forwardxVersion: "v2" },
  }), "v2");
  assert.equal(resolveLocalForwardXTransportVersion({
    tunnel: { mode: "forwardx", forwardxVersion: "v1" },
  }), "v1");
});

test("stopped rule keeps conservative cleanup without a runtime snapshot", () => {
  assert.equal(stoppedForwardRuleNeedsRemoval({
    hasReportedRuntimeState: false,
    sourcePort: 32676,
    kernelForwardRule: false,
    expectedRuleId: 2,
  }), true);
});

test("stopped rule keeps conservative cleanup for an invalid source port", () => {
  assert.equal(stoppedForwardRuleNeedsRemoval({
    hasReportedRuntimeState: true,
    sourcePort: 0,
    kernelForwardRule: false,
    expectedRuleId: 2,
  }), true);
});

test("kernel stopped rules still require explicit cleanup when absent from process state", () => {
  assert.equal(stoppedForwardRuleNeedsRemoval({
    hasReportedRuntimeState: true,
    sourcePort: 32676,
    kernelForwardRule: true,
    expectedRuleId: 2,
  }), true);
});

test("authoritative runtime absence settles an already-stopped process rule", () => {
  assert.equal(stoppedForwardRuleNeedsRemoval({
    hasReportedRuntimeState: true,
    sourcePort: 32676,
    kernelForwardRule: false,
    expectedRuleId: 2,
  }), false);
});

test("matching reported process rule still requires removal", () => {
  assert.equal(stoppedForwardRuleNeedsRemoval({
    hasReportedRuntimeState: true,
    sourcePort: 32676,
    kernelForwardRule: false,
    expectedRuleId: 2,
    localRuleId: 2,
  }), true);
});

test("replacement rule on the same port settles the old stopped rule", () => {
  assert.equal(stoppedForwardRuleNeedsRemoval({
    hasReportedRuntimeState: true,
    sourcePort: 32676,
    kernelForwardRule: false,
    expectedRuleId: 2,
    localRuleId: 99,
  }), false);
});

test("ACL denied process rule still forces cleanup while its runtime is present", () => {
  assert.equal(shouldForceStoppedRuleCleanup({
    resourceAccessDenied: true,
    supportsDesiredState: true,
    kernelForwardRule: false,
    needsRemoval: true,
  }), true);
});

test("ACL denied process rule does not block finalize after runtime is gone or replaced", () => {
  assert.equal(shouldForceStoppedRuleCleanup({
    resourceAccessDenied: true,
    supportsDesiredState: true,
    kernelForwardRule: false,
    needsRemoval: false,
  }), false);
});

test("kernel cleanup stays conservative when runtime cleanup is still required", () => {
  assert.equal(shouldForceStoppedRuleCleanup({
    resourceAccessDenied: false,
    supportsDesiredState: true,
    kernelForwardRule: true,
    needsRemoval: true,
  }), true);
});

test("old Agent without desired-state support does not invent a kernel force path", () => {
  assert.equal(shouldForceStoppedRuleCleanup({
    resourceAccessDenied: false,
    supportsDesiredState: false,
    kernelForwardRule: true,
    needsRemoval: true,
  }), false);
});
