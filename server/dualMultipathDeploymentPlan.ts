import {
  compileDualMultipathPreview,
  parseDualMultipathDraft,
  type DualMultipathDraftInput,
} from "./dualMultipathControlPlane";

export const DUAL_MULTIPATH_DEPLOYMENT_PLAN_VERSION = 5 as const;

const FULL_CONFIG_PATH_PLACEHOLDER = "<FULL_CONFIG_PATH>";

/**
 * Build a deterministic, non-executable deployment plan.
 *
 * The current Dual draft can compile both client child outbounds, but only with
 * unresolved secret references. It still does not define the authenticated
 * server-side Hysteria2 runtime, a real target, artifact checksums, lifecycle,
 * or rollback. The planner therefore remains physically non-executable.
 */
export function buildDualMultipathDeploymentPlan(input: DualMultipathDraftInput | unknown) {
  const draft = parseDualMultipathDraft(input);
  const preview = compileDualMultipathPreview(draft);
  const serverInbound = preview.serverPreview.multipathConfig.inbounds[0];

  const ingressPortPlanned = draft.openClashIngressAdapter.portPlanning.status === "planned-read-only";
  const mihomoBridge = draft.privateCarrierBridge.type === "mihomo-dedicated-listener" ? draft.privateCarrierBridge : null;
  const privateListenerPortPlanned = mihomoBridge?.listener.portPlanning.status === "planned-read-only";
  const pureMieruProxyDiscovered = mihomoBridge?.target.discovery.status === "verified-read-only";
  const externalEndpointDiscovered = draft.privateCarrierBridge.type === "external-local-socks5"
    && draft.privateCarrierBridge.endpointDiscovery.status === "verified-read-only";
  const targetDiscoveryResolved = draft.targetDiscovery.status === "verified-read-only";
  const directCarrierResolved = draft.directCarrier.status === "resolved";
  const blockers = [
    "客户端 carrier 目前只包含 secret reference；尚未建立灰度 secret resolver 与进程级注入边界",
    ...(ingressPortPlanned ? [] : ["Dual ingress loopback 端口尚未依据 read-only availability snapshot 完成自动规划"]),
    ...(mihomoBridge && !privateListenerPortPlanned ? ["Mihomo dedicated listener loopback 端口尚未依据 read-only availability snapshot 完成自动规划"] : []),
    ...(mihomoBridge && !pureMieruProxyDiscovered ? ["单一纯 Mieru proxy 尚未完成 verified read-only discovery"] : []),
    ...(draft.privateCarrierBridge.type === "external-local-socks5" && !externalEndpointDiscovered ? ["external local SOCKS5 endpoint 尚未完成 verified read-only discovery"] : []),
    ...(targetDiscoveryResolved ? [] : ["Dual 目标尚无 verified-read-only discovery snapshot"]),
    ...(directCarrierResolved ? [] : ["Hysteria2 端口、TLS server name 与最终 runtime 仍未解析"]),
    "Mihomo dedicated listener 尚未在 OpenClash override 机制中生成并执行原生配置校验",
    "Hysteria2 服务端监听、TLS secret 注入和回环转发语义尚未执行原生配置校验",
    "尚未确认 OpenWrt aarch64 与 Dual x86_64 的固定 artifact 安装目录",
    "尚未确认两条已认证 carrier 都能到达同一个回环 multipath listener；multipath 协议本身不提供认证或加密",
    `尚未建立固定上游 commit ${preview.upstream.commit}、with_quic 构建标签与 SHA256 校验策略`,
    "尚未对 secret 解析后的最终 client/server 配置执行 sing-box check",
    "尚未设计 gray-only runtime lifecycle、健康检查与回滚步骤",
  ];

  return {
    version: DUAL_MULTIPATH_DEPLOYMENT_PLAN_VERSION,
    mode: "dry-run" as const,
    name: draft.name,
    readyToDeploy: false as const,
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
        source: "Dual v4 draft + carrier references",
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
    blockers,
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
