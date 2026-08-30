import {
  dualDeploymentEvidenceSchema,
  dualDeploymentReadinessSchema,
  dualPortProbeEvidenceSchema,
  type DualArtifactRequirement,
  type DualDeploymentEvidence,
  type DualEvidenceCheck,
  type DualPortProbeEvidence,
  type DualReadinessBlocker,
} from "../shared/dualRuntimePlanning";
import {
  parseDualMultipathDraft,
  type DualMultipathDraftInput,
} from "./dualMultipathControlPlane";

export type PortAvailabilityProbeRequest = {
  targetId: string;
  address: string;
  protocol: "tcp" | "udp";
  port: number;
};

export interface PortAvailabilityProbe {
  probe(request: PortAvailabilityProbeRequest): Promise<DualPortProbeEvidence>;
}

const unverifiedEvidence = (): DualEvidenceCheck => ({
  status: "unverified",
  source: "none",
  targetId: null,
});

function unresolvedArtifact(component: string, platform: string, arch: string): DualArtifactRequirement {
  return {
    component,
    platform,
    arch,
    version: null,
    source: null,
    sha256: null,
    verificationStatus: "unresolved",
  };
}

export function createUnverifiedDualDeploymentEvidence(
  targetId: string,
  serverArch = "x86_64",
  clientArch = "aarch64",
): DualDeploymentEvidence {
  return {
    targetId,
    clientPorts: unverifiedEvidence(),
    privateCarrierDiscovery: unverifiedEvidence(),
    hy2RuntimeConfig: unverifiedEvidence(),
    mihomoConfigValidation: unverifiedEvidence(),
    singBoxConfigValidation: unverifiedEvidence(),
    privateCarrierReachability: unverifiedEvidence(),
    directCarrierReachability: unverifiedEvidence(),
    secretResolution: unverifiedEvidence(),
    grayLifecycle: unverifiedEvidence(),
    rollbackPlan: unverifiedEvidence(),
    artifacts: {
      client: unresolvedArtifact("singbox-multipath-client", "openwrt", clientArch),
      server: unresolvedArtifact("singbox-multipath-server", "linux", serverArch),
    },
  };
}

function evidenceMatchesTarget(
  evidence: DualEvidenceCheck,
  targetId: string,
  allowRepositoryCi = false,
) {
  if (evidence.status !== "verified" || evidence.targetId !== targetId) return false;
  if (evidence.source === "target-read-only") return true;
  return allowRepositoryCi && evidence.source === "repository-ci";
}

function artifactVerified(artifact: DualArtifactRequirement) {
  return artifact.verificationStatus === "verified"
    && artifact.version !== null
    && artifact.source !== null
    && artifact.sha256 !== null;
}

function pushBlocker(
  blockers: DualReadinessBlocker[],
  code: DualReadinessBlocker["code"],
  category: DualReadinessBlocker["category"],
  message: string,
) {
  blockers.push({ code, category, message });
}

export function evaluateDualDeploymentReadiness(
  input: DualMultipathDraftInput | unknown,
  evidenceInput?: unknown,
) {
  const draft = parseDualMultipathDraft(input);
  const targetId = draft.targetDiscovery.targetId;
  const serverArch = draft.targetDiscovery.status === "verified-read-only"
    ? draft.targetDiscovery.platform.architecture
    : "unknown";
  const evidence = evidenceInput === undefined
    ? createUnverifiedDualDeploymentEvidence(targetId, serverArch)
    : dualDeploymentEvidenceSchema.parse(evidenceInput);
  const blockers: DualReadinessBlocker[] = [];

  if (draft.targetDiscovery.status !== "verified-read-only") {
    pushBlocker(blockers, "TARGET_DISCOVERY_UNVERIFIED", "discovery", "Dual 目标尚无 verified-read-only discovery snapshot");
  }

  const bridge = draft.privateCarrierBridge;
  const privateBridgePortResolved = bridge.type === "mihomo-dedicated-listener"
    ? bridge.status === "resolved" && bridge.listener.port !== null
    : bridge.status === "resolved" && bridge.endpoint !== undefined;
  const clientPortsResolved = draft.openClashIngressAdapter.status === "resolved"
    && draft.openClashIngressAdapter.port !== null
    && privateBridgePortResolved;
  if (!clientPortsResolved || !evidenceMatchesTarget(evidence.clientPorts, targetId)) {
    pushBlocker(blockers, "CLIENT_PORTS_UNRESOLVED", "ports", "Dual ingress / private bridge loopback 端口尚未经过目标端口占用检查与自动规划");
  }

  if (
    draft.targetDiscovery.status !== "verified-read-only"
    || bridge.status !== "resolved"
    || !evidenceMatchesTarget(evidence.privateCarrierDiscovery, targetId)
  ) {
    pushBlocker(blockers, "PRIVATE_CARRIER_DISCOVERY_UNVERIFIED", "discovery", "private carrier bridge 尚未解析到单一纯 Mieru proxy 或真实 external SOCKS5 endpoint，并缺少目标只读发现 evidence");
  }

  if (draft.directCarrier.status !== "resolved" || !evidenceMatchesTarget(evidence.hy2RuntimeConfig, targetId)) {
    pushBlocker(blockers, "HY2_RUNTIME_CONFIG_UNRESOLVED", "runtime", "Hysteria2 端口、TLS server name 与最终 runtime 仍未解析或未验证");
  }

  if (!artifactVerified(evidence.artifacts.server)) {
    pushBlocker(blockers, "SERVER_ARTIFACT_UNPINNED", "artifact", "Dual server artifact 尚未固定 exact version/source/SHA256；pinned singbox-multipath 仍要求 with_quic 构建标签");
  }
  if (!artifactVerified(evidence.artifacts.client)) {
    pushBlocker(blockers, "CLIENT_ARTIFACT_UNPINNED", "artifact", "OpenWrt client artifact 尚未固定 exact version/source/SHA256");
  }

  if (bridge.type === "mihomo-dedicated-listener" && !evidenceMatchesTarget(evidence.mihomoConfigValidation, targetId, true)) {
    pushBlocker(blockers, "MIHOMO_CONFIG_UNVALIDATED", "validation", "Mihomo dedicated listener 尚未执行原生配置校验");
  }
  if (!evidenceMatchesTarget(evidence.singBoxConfigValidation, targetId, true)) {
    pushBlocker(blockers, "SING_BOX_CONFIG_UNVALIDATED", "validation", "尚未对 secret 解析后的最终 client/server 配置执行 sing-box check");
  }
  if (!evidenceMatchesTarget(evidence.privateCarrierReachability, targetId)) {
    pushBlocker(blockers, "PRIVATE_CARRIER_REACHABILITY_UNVERIFIED", "reachability", "尚未确认专线 authenticated carrier 能到达同一个 127.0.0.1 multipath listener；multipath 协议本身不提供认证或加密");
  }
  if (!evidenceMatchesTarget(evidence.directCarrierReachability, targetId)) {
    pushBlocker(blockers, "DIRECT_CARRIER_REACHABILITY_UNVERIFIED", "reachability", "尚未确认直连 authenticated carrier 能到达同一个 127.0.0.1 multipath listener；multipath 协议本身不提供认证或加密");
  }
  if (!evidenceMatchesTarget(evidence.secretResolution, targetId, true)) {
    pushBlocker(blockers, "SECRET_RESOLUTION_UNVERIFIED", "secrets", "客户端 carrier 目前只包含 secret reference；尚未建立灰度 secret resolver 与进程级注入边界");
  }
  if (!evidenceMatchesTarget(evidence.grayLifecycle, targetId, true)) {
    pushBlocker(blockers, "GRAY_LIFECYCLE_UNVERIFIED", "lifecycle", "尚未建立并验证 gray-only runtime lifecycle 与健康检查");
  }
  if (!evidenceMatchesTarget(evidence.rollbackPlan, targetId, true)) {
    pushBlocker(blockers, "ROLLBACK_PLAN_UNVERIFIED", "lifecycle", "尚未验证 gray rollback plan 与回滚步骤");
  }

  return dualDeploymentReadinessSchema.parse({
    status: blockers.length === 0 ? "ready" : "blocked",
    readyToDeploy: blockers.length === 0,
    targetId,
    blockers,
    artifactRequirements: evidence.artifacts,
  });
}

export async function planAutoLoopbackPort(
  request: {
    targetId: string;
    address: string;
    protocol: "tcp" | "udp";
    candidates: readonly number[];
  },
  probe: PortAvailabilityProbe,
) {
  const candidates = [...new Set(request.candidates)].filter((port) => Number.isInteger(port) && port >= 1 && port <= 65535);
  if (candidates.length === 0) {
    return {
      portStrategy: "auto" as const,
      status: "unresolved" as const,
      port: null,
      checked: [] as DualPortProbeEvidence[],
      reason: "no-candidates" as const,
    };
  }

  const checked: DualPortProbeEvidence[] = [];
  for (const port of candidates) {
    const evidence = dualPortProbeEvidenceSchema.parse(await probe.probe({
      targetId: request.targetId,
      address: request.address,
      protocol: request.protocol,
      port,
    }));
    if (
      evidence.targetId !== request.targetId
      || evidence.address !== request.address
      || evidence.protocol !== request.protocol
      || evidence.port !== port
    ) {
      throw new Error("port probe 返回的 evidence 与请求不一致，已 fail closed");
    }
    checked.push(evidence);
    if (evidence.availability === "available") {
      return {
        portStrategy: "auto" as const,
        status: "resolved" as const,
        port,
        evidence,
      };
    }
  }

  return {
    portStrategy: "auto" as const,
    status: "unresolved" as const,
    port: null,
    checked,
    reason: "no-confirmed-available-port" as const,
  };
}
