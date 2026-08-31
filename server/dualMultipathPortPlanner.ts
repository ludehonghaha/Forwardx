import { z } from "zod";
import {
  dualMultipathDraftSchema,
  dualPortSchema,
  type DualAutoPortPlanning,
  type DualMultipathDraftV4,
} from "../shared/dualMultipath";

export const DUAL_CLIENT_LOOPBACK_AUTO_PORT_RANGE = Object.freeze({ start: 23180, end: 23279 });

export const dualPortAvailabilitySnapshotSchema = z.object({
  snapshotId: z.string().trim().min(1).max(128),
  targetId: z.string().trim().min(1).max(128),
  scope: z.literal("client-loopback-tcp"),
  observedAt: z.string().datetime({ offset: true }),
  occupiedTcpPorts: z.array(dualPortSchema).max(65535),
}).strict().superRefine((snapshot, ctx) => {
  if (new Set(snapshot.occupiedTcpPorts).size !== snapshot.occupiedTcpPorts.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["occupiedTcpPorts"], message: "occupied TCP ports 不能重复" });
  }
});

export type DualPortAvailabilitySnapshot = z.output<typeof dualPortAvailabilitySnapshotSchema>;

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
) {
  const draft = dualMultipathDraftSchema.parse(draftInput);
  const snapshot = dualPortAvailabilitySnapshotSchema.parse(snapshotInput);
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
    snapshotId: snapshot.snapshotId,
  });
  const plannedDraft: DualMultipathDraftV4 = dualMultipathDraftSchema.parse({
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
      targetId: snapshot.targetId,
      scope: snapshot.scope,
      observedAt: snapshot.observedAt,
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
