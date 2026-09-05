import {
  compileDualMultipathPreview,
  parseDualMultipathDraft,
  type DualMultipathDraftInput,
} from "./dualMultipathControlPlane";
import type { DualClientPreflightDiagnostic, DualClientPreflightBlockerCode } from "./dualMultipathClientDiscovery";

export const DUAL_MULTIPATH_DEPLOYMENT_PLAN_VERSION = 6 as const;

const FULL_CONFIG_PATH_PLACEHOLDER = "<FULL_CONFIG_PATH>";

/**
 * Build a deterministic, non-executable deployment plan.
 *
 * The current Dual draft can compile both client child outbounds, but only with
 * unresolved secret references. It still does not define the authenticated
 * server-side Hysteria2 runtime, a real target, artifact checksums, lifecycle,
 * or rollback. The planner therefore remains physically non-executable.
 */
const clientBlockerText: Record<DualClientPreflightBlockerCode, string> = {
  "client-target-unbound": "Client target 未绑定",
  "client-snapshot-missing": "Client discovery snapshot 缺失",
  "client-snapshot-mismatch": "Client snapshot target 与当前绑定不一致",
  "client-snapshot-stale": "Client discovery snapshot 已过期",
  "client-snapshot-future": "Client discovery snapshot 时间晚于显式 referenceTime",
  "pure-mieru-unresolved": "Pure Mieru proxy 未发现",
  "pure-mieru-ambiguous": "Pure Mieru proxy 存在多个候选，拒绝自动选择",
};

export function buildDualMultipathDeploymentPlan(
  input: DualMultipathDraftInput | unknown,
  clientPreflight?: DualClientPreflightDiagnostic,
) {
  const draft = parseDualMultipathDraft(input);
  const preview = compileDualMultipathPreview(draft);
  const serverInbound = preview.serverPreview.multipathConfig.inbounds[0];

  const ingressPortPlanned = draft.openClashIngressAdapter.portPlanning.status === "planned-read-only";
  const mihomoBridge = draft.privateCarrierBridge.type === "mihomo-dedicated-listener" ? draft.privateCarrierBridge : null;
  const managedMieruBridge = draft.privateCarrierBridge.type === "forwardx-managed-mieru-sidecar" ? draft.privateCarrierBridge : null;
  const localPrivateBridge = mihomoBridge ?? managedMieruBridge;
  const privateListenerPortPlanned = localPrivateBridge?.listener.portPlanning.status === "planned-read-only";
  const pureMieruProxyDiscovered = mihomoBridge?.target.discovery.status === "verified-read-only";
  const externalEndpointDiscovered = draft.privateCarrierBridge.type === "external-local-socks5"
    && draft.privateCarrierBridge.endpointDiscovery.status === "verified-read-only";
  const serverTargetDiscoveryResolved = draft.serverTargetDiscovery.status === "verified-read-only";
  const clientTargetBound = draft.clientTarget.status === "bound";
  const hasClientEvidence = ingressPortPlanned
    || privateListenerPortPlanned === true
    || pureMieruProxyDiscovered === true
    || externalEndpointDiscovered;
  const clientBlockerCodes = new Set<DualClientPreflightBlockerCode>(clientPreflight?.blockerCodes || []);
  if (!clientTargetBound) clientBlockerCodes.add("client-target-unbound");
  if (clientTargetBound && !hasClientEvidence && clientBlockerCodes.size === 0) clientBlockerCodes.add("client-snapshot-missing");
  const hasPureMieruPreflightBlocker = clientBlockerCodes.has("pure-mieru-unresolved")
    || clientBlockerCodes.has("pure-mieru-ambiguous");
  const directCarrierResolved = draft.directCarrier.status === "resolved";
  const blockers = [
    "客户端 carrier 目前只包含 secret reference；尚未建立灰度 secret resolver 与进程级注入边界",
    ...Array.from(clientBlockerCodes, (code) => clientBlockerText[code]),
    ...(ingressPortPlanned ? [] : ["Dual ingress loopback 端口尚未依据 read-only availability snapshot 完成自动规划"]),
    ...(localPrivateBridge && !privateListenerPortPlanned ? ["private carrier SOCKS loopback 端口尚未依据 read-only availability snapshot 完成自动规划"] : []),
    ...(mihomoBridge && !pureMieruProxyDiscovered && !hasPureMieruPreflightBlocker ? ["单一纯 Mieru proxy 尚未完成 verified read-only discovery"] : []),
    ...(draft.privateCarrierBridge.type === "external-local-socks5" && !externalEndpointDiscovered ? ["external local SOCKS5 endpoint 尚未完成 verified read-only discovery"] : []),
    ...(serverTargetDiscoveryResolved ? [] : ["Dual server target 尚无 verified-read-only discovery snapshot"]),
    ...(directCarrierResolved ? [] : ["Hysteria2 端口、TLS server name 与最终 runtime 仍未解析"]),
    ...(managedMieruBridge ? [
      "client-visible Mieru ingress 尚未通过独立 verified Gray discovery/runtime input 注入",
      "真实 Mieru client username/password 尚未通过 Gray secret resolver 注入",
    ] : []),
    ...(mihomoBridge ? ["旧 Mihomo dedicated listener 草稿必须迁移到 ForwardX-managed official Mieru sidecar"] : []),
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
        preferredBridge: "forwardx-managed-mieru-sidecar" as const,
        note: "ForwardX 管理官方 Mieru foreground sidecar，并用独立 loopback-only SOCKS listener 承载专线；不读取或修改 Clash Mi。",
      },
      directLeg: {
        authenticatedCarrierRequired: true as const,
        nativeHysteria2InPinnedArtifact: true as const,
        requiredBuildTag: "with_quic" as const,
        separateHysteriaBinaryRequired: false as const,
        bindInterface: draft.serverTargetDiscovery.status === "verified-read-only" ? draft.serverTargetDiscovery.publicSide.interfaceName : null,
        sourceAddress: draft.serverTargetDiscovery.status === "verified-read-only" ? draft.serverTargetDiscovery.publicSide.sourceAddress : null,
        runtimeStatus: draft.serverRuntime.directCarrierRuntime.status,
        note: "公网 leg1 使用 pinned singbox-multipath artifact 的 native Hysteria2，并显式绑定已核验的公网侧；不能暴露裸 multipath listener。",
      },
    },
    fragments: {
      clientConfig: preview.clientConfig,
      mihomoPrivateListener: preview.mihomoPrivateListener,
      mieruPrivateSidecar: preview.mieruPrivateSidecar,
      serverPreview: preview.serverPreview,
    },
    intendedArtifacts: [
      {
        kind: "binary" as const,
        name: "official mieru client",
        source: "enfein/mieru@v3.36.0",
        destination: null,
        status: "unresolved" as const,
      },
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
        source: "Dual v5 draft + carrier references",
        destination: null,
        status: "preview-only" as const,
      },
      {
        kind: "client-adapter" as const,
        name: "ForwardX-managed Dual ingress and Mieru sidecar",
        source: "singbox-multipath ingress + official Mieru client preview",
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
