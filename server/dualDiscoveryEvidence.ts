import {
  dualDiscoveryEvidenceBundleSchema,
  type DualDiscoveryEvidenceBundle,
  type DualDiscoveryObservation,
} from "../shared/dualDiscoveryEvidence";
import {
  dualTargetDiscoverySnapshotSchema,
  type DualTargetDiscoverySnapshot,
} from "../shared/dualMultipath";
import type { DualEvidenceCheck, DualPortProbeEvidence } from "../shared/dualRuntimePlanning";
import type { PortAvailabilityProbe, PortAvailabilityProbeRequest } from "./dualRuntimePlanning";

function observationsOfKind<K extends DualDiscoveryObservation["kind"]>(
  observations: readonly DualDiscoveryObservation[],
  kind: K,
): Extract<DualDiscoveryObservation, { kind: K }>[] {
  return observations.filter((item): item is Extract<DualDiscoveryObservation, { kind: K }> => item.kind === kind);
}

function exactlyOne<K extends DualDiscoveryObservation["kind"]>(
  observations: readonly DualDiscoveryObservation[],
  kind: K,
) {
  const matches = observationsOfKind(observations, kind);
  if (matches.length !== 1) {
    throw new Error(`Dual discovery evidence 必须且只能包含一个 ${kind} observation`);
  }
  return matches[0];
}

function hostAddress(value: string) {
  return value.split("/", 1)[0];
}

function interfaceHasAddress(addresses: readonly string[], sourceAddress: string) {
  return addresses.some((address) => hostAddress(address) === sourceAddress);
}

function evidenceSource(bundle: DualDiscoveryEvidenceBundle): DualEvidenceCheck["source"] {
  return bundle.provenance === "agent-read-only" ? "target-read-only" : "synthetic";
}

export type CompiledDualDiscoveryEvidence = {
  targetId: string;
  evidenceId: string;
  provenance: DualDiscoveryEvidenceBundle["provenance"];
  snapshot: DualTargetDiscoverySnapshot;
  targetEvidence: DualEvidenceCheck;
  privateCarrierEvidence: DualEvidenceCheck;
  portEvidence: DualPortProbeEvidence[];
};

export function compileDualDiscoveryEvidence(
  input: unknown,
  options: { expectedTargetId?: string } = {},
): CompiledDualDiscoveryEvidence {
  const bundle = dualDiscoveryEvidenceBundleSchema.parse(input);
  if (options.expectedTargetId && bundle.targetId !== options.expectedTargetId) {
    throw new Error(`Dual discovery target mismatch: expected ${options.expectedTargetId}, got ${bundle.targetId}`);
  }

  const platform = exactlyOne(bundle.observations, "platform");
  const defaultRoute = exactlyOne(bundle.observations, "default-route");
  const privateSide = exactlyOne(bundle.observations, "private-side");
  const mita = exactlyOne(bundle.observations, "mita-runtime");
  const installed = exactlyOne(bundle.observations, "installed-binaries");
  const interfaces = observationsOfKind(bundle.observations, "interface");

  const byName = new Map<string, Extract<DualDiscoveryObservation, { kind: "interface" }>>();
  for (const item of interfaces) {
    if (byName.has(item.interfaceName)) {
      throw new Error(`Dual discovery interface ${item.interfaceName} 重复，无法确定 topology`);
    }
    byName.set(item.interfaceName, item);
  }

  const publicInterface = byName.get(defaultRoute.dev);
  if (!publicInterface) {
    throw new Error(`default route dev ${defaultRoute.dev} 没有对应 interface observation`);
  }
  if (!interfaceHasAddress(publicInterface.addresses, defaultRoute.sourceAddress)) {
    throw new Error("default route sourceAddress 不属于对应公网 interface，已 fail closed");
  }

  const privateInterface = byName.get(privateSide.interfaceName);
  if (!privateInterface) {
    throw new Error(`private side ${privateSide.interfaceName} 没有对应 interface observation`);
  }
  if (privateSide.interfaceName === defaultRoute.dev) {
    throw new Error("public/private side 不能指向同一 interface");
  }
  if (!interfaceHasAddress(privateInterface.addresses, privateSide.sourceAddress)) {
    throw new Error("private side sourceAddress 不属于对应 interface，已 fail closed");
  }

  const snapshot = dualTargetDiscoverySnapshotSchema.parse({
    status: "verified-read-only",
    targetId: bundle.targetId,
    platform: { kernel: platform.kernel, architecture: platform.architecture },
    publicSide: {
      interfaceName: publicInterface.interfaceName,
      sourceAddress: defaultRoute.sourceAddress,
      addresses: publicInterface.addresses,
      gateway: defaultRoute.via,
    },
    privateSide: {
      interfaceName: privateInterface.interfaceName,
      sourceAddress: privateSide.sourceAddress,
      addresses: privateInterface.addresses,
    },
    defaultRoute: { via: defaultRoute.via, dev: defaultRoute.dev },
    existingPrivateCarrier: {
      type: "mita",
      binaryPath: mita.binaryPath,
      serviceStatus: mita.serviceStatus,
      listener: mita.listener,
      lifecycle: mita.lifecycle,
    },
    installedBinaries: {
      singBox: installed.singBox,
      hysteria: installed.hysteria,
      standaloneMieru: installed.standaloneMieru,
    },
  });

  const source = evidenceSource(bundle);
  const check: DualEvidenceCheck = { status: "verified", source, targetId: bundle.targetId };
  const portEvidence = observationsOfKind(bundle.observations, "port-probe").map((item) => ({
    targetId: bundle.targetId,
    address: item.address,
    protocol: item.protocol,
    port: item.port,
    availability: item.availability,
    source: source === "target-read-only" ? "target-read-only" as const : "synthetic" as const,
  }));

  return {
    targetId: bundle.targetId,
    evidenceId: bundle.evidenceId,
    provenance: bundle.provenance,
    snapshot,
    targetEvidence: check,
    privateCarrierEvidence: check,
    portEvidence,
  };
}

export function createDiscoveryEvidencePortProbe(
  compiled: CompiledDualDiscoveryEvidence,
): PortAvailabilityProbe {
  return {
    async probe(request: PortAvailabilityProbeRequest) {
      if (request.targetId !== compiled.targetId) {
        throw new Error("port probe target 与 discovery evidence 不一致，已 fail closed");
      }
      const match = compiled.portEvidence.find((item) =>
        item.targetId === request.targetId
        && item.address === request.address
        && item.protocol === request.protocol
        && item.port === request.port,
      );
      if (match) return match;
      return {
        ...request,
        availability: "unknown",
        source: compiled.provenance === "agent-read-only" ? "target-read-only" : "synthetic",
      };
    },
  };
}
