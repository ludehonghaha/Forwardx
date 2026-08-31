import {
  dualMultipathDraftSchema,
  type DualAutoPortPlanning,
  type DualMultipathDraftV5,
} from "../shared/dualMultipath";
import {
  assertDualClientSnapshotTarget,
  assertFreshDualClientSnapshot,
  dualClientDiscoverySnapshotSchema,
  type DualClientDiscoverySnapshot,
} from "../shared/dualMultipathClientDiscovery";

export const DUAL_CLIENT_LOOPBACK_AUTO_PORT_RANGE = Object.freeze({ start: 23180, end: 23279 });

export const dualPortAvailabilitySnapshotSchema = dualClientDiscoverySnapshotSchema;
export type DualPortAvailabilitySnapshot = DualClientDiscoverySnapshot;

function planningPort(planning: DualAutoPortPlanning) {
  return planning.status === "planned-read-only" ? planning.port : null;
}

function inCandidateRange(port: number) {
  return port >= DUAL_CLIENT_LOOPBACK_AUTO_PORT_RANGE.start && port <= DUAL_CLIENT_LOOPBACK_AUTO_PORT_RANGE.end;
}

function firstAvailablePort(unavailable: ReadonlySet<number>) {
  for (let port = DUAL_CLIENT_LOOPBACK_AUTO_PORT_RANGE.start; port <= DUAL_CLIENT_LOOPBACK_AUTO_PORT_RANGE.end; port += 1) {
    if (!unavailable.has(port)) return port;
  }
  return null;
}

function selectPort(planning: DualAutoPortPlanning, unavailable: Set<number>) {
  const existing = planningPort(planning);
  if (existing !== null && inCandidateRange(existing) && !unavailable.has(existing)) return existing;
  const selected = firstAvailablePort(unavailable);
  if (selected === null) {
    throw new Error(
      `Dual client loopback auto-port 规划失败：候选范围 ${DUAL_CLIENT_LOOPBACK_AUTO_PORT_RANGE.start}-${DUAL_CLIENT_LOOPBACK_AUTO_PORT_RANGE.end} 没有足够的空闲 TCP 端口`,
    );
  }
  return selected;
}

export function planDualClientLoopbackPorts(
  draftInput: unknown,
  snapshotInput: unknown,
  freshnessInput: unknown,
) {
  const draft = dualMultipathDraftSchema.parse(draftInput);
  const snapshot = dualPortAvailabilitySnapshotSchema.parse(snapshotInput);
  const clientTargetRef = assertDualClientSnapshotTarget(draft.clientTarget, snapshot.clientTargetRef);
  const freshness = assertFreshDualClientSnapshot(snapshot, freshnessInput);
  if (draft.privateCarrierBridge.type !== "mihomo-dedicated-listener") {
    throw new Error("Dual client loopback auto-port 规划只适用于 Mihomo dedicated listener bridge");
  }

  const unavailable = new Set(snapshot.occupiedTcpPorts);
  const ingressPort = selectPort(draft.openClashIngressAdapter.portPlanning, unavailable);
  unavailable.add(ingressPort);
  const privateBridgePort = selectPort(draft.privateCarrierBridge.listener.portPlanning, unavailable);

  const plannedEvidence = (port: number): DualAutoPortPlanning => ({
    status: "planned-read-only",
    strategy: "auto",
    port,
    evidence: {
      snapshotId: snapshot.snapshotId,
      clientTargetRef,
    },
  });
  const plannedDraft: DualMultipathDraftV5 = dualMultipathDraftSchema.parse({
    ...draft,
    openClashIngressAdapter: {
      ...draft.openClashIngressAdapter,
      portPlanning: plannedEvidence(ingressPort),
    },
    privateCarrierBridge: {
      ...draft.privateCarrierBridge,
      listener: {
        ...draft.privateCarrierBridge.listener,
        portPlanning: plannedEvidence(privateBridgePort),
      },
    },
  });

  return {
    draft: plannedDraft,
    diagnostics: {
      snapshotId: snapshot.snapshotId,
      clientTargetRef,
      scope: snapshot.scope,
      observedAt: snapshot.observedAt,
      freshness,
      candidateRange: DUAL_CLIENT_LOOPBACK_AUTO_PORT_RANGE,
      selected: { dualIngressPort: ingressPort, mihomoDedicatedListenerPort: privateBridgePort },
      deterministic: true as const,
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
