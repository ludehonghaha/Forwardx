import {
  compileDualMultipathPreview,
  parseDualMultipathDraft,
  type DualMultipathDraftInput,
} from "./dualMultipathControlPlane";
import { evaluateDualDeploymentReadiness } from "./dualRuntimePlanning";

export const DUAL_MULTIPATH_DEPLOYMENT_PLAN_VERSION = 5 as const;

const FULL_CONFIG_PATH_PLACEHOLDER = "<FULL_CONFIG_PATH>";

/**
 * Build a deterministic, non-executable deployment plan.
 *
 * Readiness is derived from typed evidence and blockers. Missing, synthetic,
 * mismatched, or unresolved evidence fails closed; the planner itself has no
 * runtime mutation surface.
 */
export function buildDualMultipathDeploymentPlan(
  input: DualMultipathDraftInput | unknown,
  evidenceInput?: unknown,
) {
  const draft = parseDualMultipathDraft(input);
  const preview = compileDualMultipathPreview(draft);
  const readiness = evaluateDualDeploymentReadiness(draft, evidenceInput);
  const serverInbound = preview.serverPreview.multipathConfig.inbounds[0];

  return {
    version: DUAL_MULTIPATH_DEPLOYMENT_PLAN_VERSION,
    mode: "dry-run" as const,
    name: draft.name,
    readyToDeploy: readiness.readyToDeploy,
    readiness,
    upstream: preview.upstream,
    listener: {
      listen: String(serverInbound.listen || "127.0.0.1"),
      port: Number(serverInbound.listen_port),
      tcpFastOpen: serverInbound.tcp_fast_open === true,
      exposureVerified: false as const,
      safeDefault: "loopback" as const,
    },
    topology: preview.topology,
    clientCompatibility: {
      requiredCore: "singbox-multipath" as const,
      nativeMihomoMultipath: false as const,
      openClashDirectImport: false as const,
      recommendedOpenClashAdapter: "local-socks-sidecar" as const,
      explanation: "Dual multipath 是固定 sing-box 分支新增的自定义 outbound；OpenClash/Mihomo 侧应把 sidecar 暴露的本地 SOCKS 当作普通节点，而不是直接解析 multipath outbound。",
    },
    carrierStrategy: {
      preferredServerShape: "same-host-authenticated-carriers" as const,
      multipathListener: "loopback-only" as const,
      privateLeg: {
        nativeSingBoxChildRequired: false as const,
        localSocksBridgeAllowed: true as const,
        preferredBridge: "mihomo-dedicated-listener" as const,
        note: "优先由 ForwardX 规划 loopback-only Mihomo dedicated SOCKS listener，并固定到单一纯 Mieru proxy；禁止通用 mixed listener、普通 rules、递归和 DIRECT/public fallback。",
      },
      directLeg: {
        authenticatedCarrierRequired: true as const,
        nativeHysteria2InPinnedArtifact: true as const,
        requiredBuildTag: "with_quic" as const,
        separateHysteriaBinaryRequired: false as const,
        bindInterface: draft.targetDiscovery.status === "verified-read-only" ? draft.targetDiscovery.publicSide.interfaceName : null,
        sourceAddress: draft.targetDiscovery.status === "verified-read-only" ? draft.targetDiscovery.publicSide.sourceAddress : null,
        runtimeStatus: draft.serverRuntime.directCarrierRuntime.status,
        note: "公网 leg1 使用 pinned singbox-multipath artifact 的 native Hysteria2，并显式绑定已核验的公网侧；不能暴露裸 multipath listener。",
      },
    },
    fragments: {
      clientConfig: preview.clientConfig,
      mihomoPrivateListener: preview.mihomoPrivateListener,
      serverPreview: preview.serverPreview,
    },
    artifactRequirements: readiness.artifactRequirements,
    intendedArtifacts: [
      {
        kind: "binary" as const,
        name: "sing-box",
        source: `${preview.upstream.repository}@${preview.upstream.commit}`,
        destination: null,
        status: "unresolved" as const,
      },
      {
        kind: "config" as const,
        name: "redacted client sing-box config preview",
        source: "Dual v3 draft + carrier references",
        destination: null,
        status: "preview-only" as const,
      },
      {
        kind: "client-adapter" as const,
        name: "ForwardX-managed OpenClash and Mihomo adapters",
        source: "singbox-multipath ingress + Mihomo dedicated listener preview",
        destination: null,
        status: "blocked" as const,
      },
    ],
    proposedChecks: [
      {
        id: "sing-box-config-check" as const,
        label: "完整配置生成后执行 sing-box 原生校验",
        command: `sing-box check -c ${FULL_CONFIG_PATH_PLACEHOLDER}`,
        runnable: false as const,
        reason: "当前配置仍含未解析的 secret placeholder，且尚无已校验 checksum 的 pinned binary 与最终 server runtime config",
      },
    ],
    blockers: readiness.blockers.map((blocker) => blocker.message),
    safety: {
      agentPush: false as const,
      commandExecution: false as const,
      runtimeActivation: false as const,
      systemdWrite: false as const,
      firewallMutation: false as const,
      tunnelMutation: false as const,
      unauthenticatedPublicListenerAllowed: false as const,
    },
  };
}
