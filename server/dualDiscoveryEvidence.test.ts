import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  NO_BRAND_DUAL_DISCOVERY_SNAPSHOT,
  createDefaultDualMultipathInfrastructure,
} from "../shared/dualMultipath";
import type { DualDiscoveryEvidenceBundle } from "../shared/dualDiscoveryEvidence";
import {
  compileDualDiscoveryEvidence,
  createDiscoveryEvidencePortProbe,
} from "./dualDiscoveryEvidence";
import {
  createUnverifiedDualDeploymentEvidence,
  evaluateDualDeploymentReadiness,
  planAutoLoopbackPort,
} from "./dualRuntimePlanning";

function noBrandBundle(provenance: DualDiscoveryEvidenceBundle["provenance"] = "agent-read-only"): DualDiscoveryEvidenceBundle {
  return {
    version: 1,
    targetId: "nobrand-dual-current",
    evidenceId: `${provenance}-fixture`,
    provenance,
    observations: [
      { kind: "platform", kernel: "Linux", architecture: "x86_64" },
      { kind: "interface", interfaceName: "eth0", addresses: ["87.86.22.221/24"] },
      { kind: "interface", interfaceName: "eth1", addresses: ["172.16.4.114/24"] },
      { kind: "default-route", dev: "eth0", via: "87.86.22.1", sourceAddress: "87.86.22.221" },
      { kind: "private-side", interfaceName: "eth1", sourceAddress: "172.16.4.114" },
      {
        kind: "mita-runtime",
        binaryPath: "/usr/local/bin/mita",
        serviceStatus: "active",
        listener: { network: "tcp", listen: "*", port: 11464 },
        lifecycle: "preserve",
      },
      { kind: "installed-binaries", singBox: false, hysteria: false, standaloneMieru: false },
      { kind: "port-probe", address: "127.0.0.1", protocol: "tcp", port: 23001, availability: "occupied" },
      { kind: "port-probe", address: "127.0.0.1", protocol: "tcp", port: 23002, availability: "available" },
      { kind: "port-probe", address: "127.0.0.1", protocol: "tcp", port: 23003, availability: "unknown" },
    ],
  };
}

function syntheticSecondDual(): DualDiscoveryEvidenceBundle {
  return {
    version: 1,
    targetId: "synthetic-dual-ens3",
    evidenceId: "synthetic-second-dual",
    provenance: "synthetic",
    observations: [
      { kind: "platform", kernel: "Linux", architecture: "x86_64" },
      { kind: "interface", interfaceName: "ens3", addresses: ["203.0.113.20/24"] },
      { kind: "interface", interfaceName: "ens8", addresses: ["10.44.0.12/24"] },
      { kind: "default-route", dev: "ens3", via: "203.0.113.1", sourceAddress: "203.0.113.20" },
      { kind: "private-side", interfaceName: "ens8", sourceAddress: "10.44.0.12" },
      {
        kind: "mita-runtime",
        binaryPath: "/opt/mita",
        serviceStatus: "active",
        listener: { network: "tcp", listen: "*", port: 22464 },
        lifecycle: "preserve",
      },
      { kind: "installed-binaries", singBox: false, hysteria: false, standaloneMieru: false },
    ],
  };
}

test("agent read-only NoBrand evidence compiles to the verified discovery snapshot without secrets", () => {
  const compiled = compileDualDiscoveryEvidence(noBrandBundle(), { expectedTargetId: "nobrand-dual-current" });
  assert.deepEqual(compiled.snapshot, NO_BRAND_DUAL_DISCOVERY_SNAPSHOT);
  assert.equal(compiled.targetEvidence.source, "target-read-only");
  assert.equal(compiled.privateCarrierEvidence.source, "target-read-only");
  assert.doesNotMatch(JSON.stringify(compiled), /password|secret|token|credential/i);
});

test("a second synthetic Dual uses different interfaces, addresses and Mita port without schema changes", () => {
  const compiled = compileDualDiscoveryEvidence(syntheticSecondDual());
  assert.equal(compiled.snapshot.status, "verified-read-only");
  if (compiled.snapshot.status !== "verified-read-only") throw new Error("expected compiled snapshot");
  assert.equal(compiled.snapshot.publicSide.interfaceName, "ens3");
  assert.equal(compiled.snapshot.publicSide.sourceAddress, "203.0.113.20");
  assert.equal(compiled.snapshot.privateSide.interfaceName, "ens8");
  assert.equal(compiled.snapshot.privateSide.sourceAddress, "10.44.0.12");
  assert.equal(compiled.snapshot.existingPrivateCarrier.listener.port, 22464);
  assert.equal(compiled.targetEvidence.source, "synthetic");
});

test("target mismatch is rejected before evidence can enter planning", () => {
  assert.throws(
    () => compileDualDiscoveryEvidence(noBrandBundle(), { expectedTargetId: "another-target" }),
    /target mismatch/,
  );
});

test("incomplete or ambiguous topology fails closed", () => {
  const missingPrivate = noBrandBundle();
  missingPrivate.observations = missingPrivate.observations.filter((item) => item.kind !== "private-side");
  assert.throws(() => compileDualDiscoveryEvidence(missingPrivate), /private-side observation/);

  const duplicatePublic = noBrandBundle();
  duplicatePublic.observations.push({ kind: "interface", interfaceName: "eth0", addresses: ["87.86.22.222/24"] });
  assert.throws(() => compileDualDiscoveryEvidence(duplicatePublic), /interface eth0 重复/);
});

test("explicit Mita runtime observation is required", () => {
  const bundle = noBrandBundle();
  bundle.observations = bundle.observations.filter((item) => item.kind !== "mita-runtime");
  assert.throws(() => compileDualDiscoveryEvidence(bundle), /mita-runtime observation/);
});

test("evidence-backed port probe preserves occupied/available/unknown and never infers missing as available", async () => {
  const compiled = compileDualDiscoveryEvidence(noBrandBundle());
  const probe = createDiscoveryEvidencePortProbe(compiled);
  const plan = await planAutoLoopbackPort({
    targetId: compiled.targetId,
    address: "127.0.0.1",
    protocol: "tcp",
    candidates: [23001, 23003, 23002],
  }, probe);
  assert.equal(plan.status, "resolved");
  if (plan.status !== "resolved") throw new Error("expected resolved port plan");
  assert.equal(plan.port, 23002);

  const missing = await probe.probe({ targetId: compiled.targetId, address: "127.0.0.1", protocol: "tcp", port: 23999 });
  assert.equal(missing.availability, "unknown");
});

test("synthetic discovery remains synthetic evidence and cannot satisfy real target readiness", () => {
  const compiled = compileDualDiscoveryEvidence(noBrandBundle("synthetic"));
  assert.equal(compiled.targetEvidence.source, "synthetic");
  const infrastructure = createDefaultDualMultipathInfrastructure(compiled.snapshot);
  const draft = {
    version: 3 as const,
    state: "draft" as const,
    name: "Synthetic NoBrand facts",
    ...infrastructure,
  };
  const evidence = createUnverifiedDualDeploymentEvidence(compiled.targetId);
  evidence.privateCarrierDiscovery = compiled.privateCarrierEvidence;
  const readiness = evaluateDualDeploymentReadiness(draft, evidence);
  assert.equal(readiness.readyToDeploy, false);
  assert.equal(readiness.blockers.some((blocker) => blocker.code === "PRIVATE_CARRIER_DISCOVERY_UNVERIFIED"), true);
});

test("discovery protocol has no arbitrary command/shell field and source file contains no any", () => {
  const invalid = { ...noBrandBundle(), command: "ip route" };
  assert.throws(() => compileDualDiscoveryEvidence(invalid), /unrecognized_keys|Unrecognized key/);
  const sharedSource = readFileSync(fileURLToPath(new URL("../shared/dualDiscoveryEvidence.ts", import.meta.url)), "utf8");
  const serverSource = readFileSync(fileURLToPath(new URL("./dualDiscoveryEvidence.ts", import.meta.url)), "utf8");
  assert.doesNotMatch(sharedSource, /\bany\b/);
  assert.doesNotMatch(serverSource, /\bany\b/);
  assert.doesNotMatch(sharedSource, /\b(command|shell|script)\s*:/i);
});
