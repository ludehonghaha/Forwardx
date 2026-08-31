import {
  dualClientTargetRefsEqual,
  dualMultipathDraftSchema,
  type DualClientSnapshotEvidence,
  type DualMultipathDraftV5,
} from "../shared/dualMultipath";
import {
  assertDualClientSnapshotTarget,
  assertFreshDualClientSnapshot,
  dualClientDiscoverySnapshotSchema,
  evaluateDualClientSnapshot,
  type DualClientDiscoverySnapshot,
  type DualMihomoCandidate,
} from "../shared/dualMultipathClientDiscovery";
import { planDualClientLoopbackPorts } from "./dualMultipathPortPlanner";

export type DualClientPreflightBlockerCode =
  | "client-target-unbound"
  | "client-snapshot-missing"
  | "client-snapshot-mismatch"
  | "client-snapshot-stale"
  | "client-snapshot-future"
  | "pure-mieru-unresolved"
  | "pure-mieru-ambiguous";

export type DualClientPreflightDiagnostic = {
  blockerCodes: DualClientPreflightBlockerCode[];
};

function isPureMieruCandidate(candidate: DualMihomoCandidate, ingressTag: string) {
  return candidate.kind === "concrete-proxy"
    && candidate.protocol === "mieru"
    && candidate.transportScope === "private-only"
    && candidate.fallback === "none"
    && candidate.ref !== ingressTag;
}

function unresolvedProxyDraft(draft: DualMultipathDraftV5) {
  if (draft.privateCarrierBridge.type !== "mihomo-dedicated-listener") {
    throw new Error("Pure Mieru discovery 只适用于 Mihomo dedicated listener bridge");
  }
  return dualMultipathDraftSchema.parse({
    ...draft,
    privateCarrierBridge: {
      ...draft.privateCarrierBridge,
      target: {
        ...draft.privateCarrierBridge.target,
        discovery: { status: "unresolved", proxyRef: null },
      },
    },
  });
}

export function resolveDualPureMieruProxy(
  draftInput: unknown,
  snapshotInput: unknown,
  freshnessInput: unknown,
) {
  const draft = dualMultipathDraftSchema.parse(draftInput);
  const snapshot = dualClientDiscoverySnapshotSchema.parse(snapshotInput);
  const clientTargetRef = assertDualClientSnapshotTarget(draft.clientTarget, snapshot.clientTargetRef);
  const freshness = assertFreshDualClientSnapshot(snapshot, freshnessInput);
  if (draft.privateCarrierBridge.type !== "mihomo-dedicated-listener") {
    throw new Error("Pure Mieru discovery 只适用于 Mihomo dedicated listener bridge");
  }

  const candidates = snapshot.mihomo.candidates.filter((candidate) => (
    isPureMieruCandidate(candidate, draft.openClashIngressAdapter.tag)
  ));
  if (candidates.length === 0) {
    return {
      status: "unresolved" as const,
      draft: unresolvedProxyDraft(draft),
      diagnostics: {
        snapshotId: snapshot.snapshotId,
        clientTargetRef,
        freshness,
        acceptedCandidateCount: 0,
        rejectedCandidateCount: snapshot.mihomo.candidates.length,
        blockerCodes: ["pure-mieru-unresolved"] as DualClientPreflightBlockerCode[],
      },
    };
  }
  if (candidates.length > 1) {
    return {
      status: "ambiguous" as const,
      draft: unresolvedProxyDraft(draft),
      diagnostics: {
        snapshotId: snapshot.snapshotId,
        clientTargetRef,
        freshness,
        acceptedCandidateCount: candidates.length,
        rejectedCandidateCount: snapshot.mihomo.candidates.length - candidates.length,
        blockerCodes: ["pure-mieru-ambiguous"] as DualClientPreflightBlockerCode[],
      },
    };
  }

  const evidence: DualClientSnapshotEvidence = {
    snapshotId: snapshot.snapshotId,
    clientTargetRef,
  };
  const proxyRef = candidates[0].ref;
  const resolvedDraft = dualMultipathDraftSchema.parse({
    ...draft,
    privateCarrierBridge: {
      ...draft.privateCarrierBridge,
      target: {
        ...draft.privateCarrierBridge.target,
        discovery: { status: "verified-read-only", proxyRef, evidence },
      },
    },
  });
  return {
    status: "verified-read-only" as const,
    draft: resolvedDraft,
    diagnostics: {
      snapshotId: snapshot.snapshotId,
      clientTargetRef,
      freshness,
      acceptedCandidateCount: 1,
      rejectedCandidateCount: snapshot.mihomo.candidates.length - 1,
      proxyRef,
      blockerCodes: [] as DualClientPreflightBlockerCode[],
    },
  };
}

function blockedMaterialization(
  draft: DualMultipathDraftV5,
  snapshot: DualClientDiscoverySnapshot,
  snapshotStatus: "not-consumed" | "stale" | "future" | "mismatch",
  blockerCode: DualClientPreflightBlockerCode,
) {
  return {
    status: "blocked" as const,
    draft,
    diagnostics: {
      snapshotId: snapshot.snapshotId,
      clientTargetRef: snapshot.clientTargetRef,
      snapshotStatus,
      portPlanningStatus: "not-materialized" as const,
      pureMieruStatus: "not-evaluated" as const,
      blockerCodes: [blockerCode],
    },
    safety: {
      factsOnly: true as const,
      externalCall: false as const,
      socketProbe: false as const,
      persistenceWrite: false as const,
      systemMutation: false as const,
    },
  };
}

export function materializeDualClientFacts(
  draftInput: unknown,
  snapshotInput: unknown,
  freshnessInput: unknown,
) {
  const draft = dualMultipathDraftSchema.parse(draftInput);
  const snapshot = dualClientDiscoverySnapshotSchema.parse(snapshotInput);
  if (draft.clientTarget.status !== "bound") {
    return blockedMaterialization(draft, snapshot, "not-consumed", "client-target-unbound");
  }
  if (!dualClientTargetRefsEqual(draft.clientTarget.ref, snapshot.clientTargetRef)) {
    return blockedMaterialization(draft, snapshot, "mismatch", "client-snapshot-mismatch");
  }
  const freshness = evaluateDualClientSnapshot(snapshot, freshnessInput);
  if (freshness.status === "stale") {
    return blockedMaterialization(draft, snapshot, "stale", "client-snapshot-stale");
  }
  if (freshness.status === "future") {
    return blockedMaterialization(draft, snapshot, "future", "client-snapshot-future");
  }

  const portResult = planDualClientLoopbackPorts(draft, snapshot, freshnessInput);
  const proxyResult = resolveDualPureMieruProxy(portResult.draft, snapshot, freshnessInput);
  const blockerCodes = proxyResult.diagnostics.blockerCodes;
  return {
    status: blockerCodes.length === 0 ? "materialized-read-only" as const : "blocked" as const,
    draft: proxyResult.draft,
    diagnostics: {
      snapshotId: snapshot.snapshotId,
      clientTargetRef: snapshot.clientTargetRef,
      snapshotStatus: "current" as const,
      freshness,
      portPlanningStatus: "planned-read-only" as const,
      pureMieruStatus: proxyResult.status,
      selectedPorts: portResult.diagnostics.selected,
      blockerCodes,
    },
    safety: portResult.safety,
  };
}
