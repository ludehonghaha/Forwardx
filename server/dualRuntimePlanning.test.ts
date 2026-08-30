import assert from "node:assert/strict";
import test from "node:test";
import {
  NO_BRAND_DUAL_DISCOVERY_SNAPSHOT,
  createDefaultDualMultipathInfrastructure,
} from "../shared/dualMultipath";
import type { DualDeploymentEvidence, DualEvidenceCheck, DualPortProbeEvidence } from "../shared/dualRuntimePlanning";
import {
  createUnverifiedDualDeploymentEvidence,
  evaluateDualDeploymentReadiness,
  planAutoLoopbackPort,
  type PortAvailabilityProbe,
} from "./dualRuntimePlanning";

function validDraft() {
  return {
    version: 3 as const,
    state: "draft" as const,
    name: "NoBrand Dual",
    ...createDefaultDualMultipathInfrastructure(NO_BRAND_DUAL_DISCOVERY_SNAPSHOT),
  };
}

const verifiedSynthetic = (targetId: string): DualEvidenceCheck => ({
  status: "verified",
  source: "synthetic",
  targetId,
});

const FAKE_SHA = "a".repeat(64);

function fullySyntheticEvidence(targetId: string): DualDeploymentEvidence {
  const evidence = createUnverifiedDualDeploymentEvidence(targetId);
  const synthetic = verifiedSynthetic(targetId);
  return {
    ...evidence,
    clientPorts: synthetic,
    privateCarrierDiscovery: synthetic,
    hy2RuntimeConfig: synthetic,
    mihomoConfigValidation: synthetic,
    singBoxConfigValidation: synthetic,
    privateCarrierReachability: synthetic,
    directCarrierReachability: synthetic,
    secretResolution: synthetic,
    grayLifecycle: synthetic,
    rollbackPlan: synthetic,
    artifacts: {
      client: {
        component: "singbox-multipath-client",
        platform: "openwrt",
        arch: "aarch64",
        version: "test-only",
        source: "synthetic://client",
        sha256: FAKE_SHA,
        verificationStatus: "verified",
      },
      server: {
        component: "singbox-multipath-server",
        platform: "linux",
        arch: "x86_64",
        version: "test-only",
        source: "synthetic://server",
        sha256: FAKE_SHA,
        verificationStatus: "verified",
      },
    },
  };
}

test("current NoBrand target remains fail-closed with typed readiness blockers", () => {
  const readiness = evaluateDualDeploymentReadiness(validDraft());
  assert.equal(readiness.status, "blocked");
  assert.equal(readiness.readyToDeploy, false);
  const codes = new Set(readiness.blockers.map((blocker) => blocker.code));
  assert.equal(codes.has("CLIENT_PORTS_UNRESOLVED"), true);
  assert.equal(codes.has("PRIVATE_CARRIER_DISCOVERY_UNVERIFIED"), true);
  assert.equal(codes.has("HY2_RUNTIME_CONFIG_UNRESOLVED"), true);
  assert.equal(codes.has("SERVER_ARTIFACT_UNPINNED"), true);
  assert.equal(codes.has("CLIENT_ARTIFACT_UNPINNED"), true);
  assert.equal(codes.has("SING_BOX_CONFIG_UNVALIDATED"), true);
  assert.equal(codes.has("PRIVATE_CARRIER_REACHABILITY_UNVERIFIED"), true);
  assert.equal(codes.has("DIRECT_CARRIER_REACHABILITY_UNVERIFIED"), true);
  assert.equal(codes.has("GRAY_LIFECYCLE_UNVERIFIED"), true);
  assert.equal(codes.has("ROLLBACK_PLAN_UNVERIFIED"), true);
});

test("unresolved auto client ports are never deploy-ready", () => {
  const draft = validDraft();
  assert.equal(draft.openClashIngressAdapter.portStrategy, "auto");
  assert.equal(draft.openClashIngressAdapter.port, null);
  const readiness = evaluateDualDeploymentReadiness(draft);
  assert.equal(readiness.readyToDeploy, false);
  assert.equal(readiness.blockers.some((blocker) => blocker.code === "CLIENT_PORTS_UNRESOLVED"), true);
});

test("auto port planner skips occupied candidate and resolves the next confirmed available port", async () => {
  const probe: PortAvailabilityProbe = {
    async probe(request) {
      return {
        ...request,
        availability: request.port === 22001 ? "occupied" : "available",
        source: "synthetic",
      } satisfies DualPortProbeEvidence;
    },
  };
  const plan = await planAutoLoopbackPort({
    targetId: "synthetic-openwrt",
    address: "127.0.0.1",
    protocol: "tcp",
    candidates: [22001, 22002],
  }, probe);
  assert.equal(plan.status, "resolved");
  if (plan.status !== "resolved") throw new Error("expected resolved port plan");
  assert.equal(plan.port, 22002);
  assert.equal(plan.evidence.availability, "available");
});

test("unknown probe evidence is not treated as available", async () => {
  const probe: PortAvailabilityProbe = {
    async probe(request) {
      return { ...request, availability: "unknown", source: "synthetic" } satisfies DualPortProbeEvidence;
    },
  };
  const plan = await planAutoLoopbackPort({
    targetId: "synthetic-openwrt",
    address: "127.0.0.1",
    protocol: "tcp",
    candidates: [22100],
  }, probe);
  assert.equal(plan.status, "unresolved");
  if (plan.status !== "unresolved") throw new Error("expected unresolved port plan");
  assert.equal(plan.port, null);
  assert.equal(plan.reason, "no-confirmed-available-port");
});

test("synthetic evidence cannot make the real NoBrand target deploy-ready", () => {
  const draft = validDraft();
  const resolvedDraft = {
    ...draft,
    openClashIngressAdapter: { ...draft.openClashIngressAdapter, status: "resolved" as const, port: 23180 },
    privateCarrierBridge: draft.privateCarrierBridge.type === "mihomo-dedicated-listener"
      ? {
          ...draft.privateCarrierBridge,
          status: "resolved" as const,
          listener: { ...draft.privateCarrierBridge.listener, port: 23181 },
          target: { ...draft.privateCarrierBridge.target, proxyRef: "Pure-Mieru" },
        }
      : draft.privateCarrierBridge,
    directCarrier: {
      ...draft.directCarrier,
      status: "resolved" as const,
      serverPort: 24443,
      tls: { serverName: "dual.example.test" },
    },
  };
  const readiness = evaluateDualDeploymentReadiness(
    resolvedDraft,
    fullySyntheticEvidence(NO_BRAND_DUAL_DISCOVERY_SNAPSHOT.targetId),
  );
  assert.equal(readiness.readyToDeploy, false);
  assert.equal(readiness.blockers.some((blocker) => blocker.code === "CLIENT_PORTS_UNRESOLVED"), true);
  assert.equal(readiness.blockers.some((blocker) => blocker.code === "PRIVATE_CARRIER_REACHABILITY_UNVERIFIED"), true);
});

test("artifact without exact SHA256 remains a blocker", () => {
  const draft = validDraft();
  const evidence = createUnverifiedDualDeploymentEvidence(NO_BRAND_DUAL_DISCOVERY_SNAPSHOT.targetId);
  const readiness = evaluateDualDeploymentReadiness(draft, evidence);
  assert.equal(readiness.artifactRequirements.server.sha256, null);
  assert.equal(readiness.blockers.some((blocker) => blocker.code === "SERVER_ARTIFACT_UNPINNED"), true);
  assert.equal(readiness.blockers.some((blocker) => blocker.code === "CLIENT_ARTIFACT_UNPINNED"), true);
});
