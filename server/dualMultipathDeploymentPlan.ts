import {
  compileDualMultipathPreview,
  parseDualMultipathDraft,
  type DualMultipathDraftInput,
} from "./dualMultipathControlPlane";

export const DUAL_MULTIPATH_DEPLOYMENT_PLAN_VERSION = 3 as const;

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

  const blockers = [
    "客户端 carrier 目前只包含 secret reference；尚未建立灰度 secret resolver 与进程级注入边界",
    "现有 Mieru 客户端本地 SOCKS5 endpoint 尚未在目标 OpenWrt 上只读核验",
    "Hysteria2 仅有客户端 outbound 预览；服务端监听、TLS 证书引用、认证用户和回环转发语义尚未设计与验证",
    "尚未绑定真实 Dual 目标主机、系统架构与安装目录",
    "尚未确认两条已认证 carrier 都能到达同一个回环 multipath listener；multipath 协议本身不提供认证或加密",
    `尚未建立固定上游 commit ${preview.upstream.commit} 的二进制产物、架构和 SHA256 校验策略`,
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
        note: "现有专线代理若能在客户端提供本地 SOCKS，可作为 singbox-multipath 的 child outbound 载体，不要求改动远端现有专线服务。",
      },
      directLeg: {
        authenticatedCarrierRequired: true as const,
        note: "公网直连 leg1 仍需一个 sing-box 可直接使用的已认证传输（例如 Hysteria2），不能把裸 multipath listener 暴露在公网。",
      },
    },
    fragments: {
      clientConfig: preview.clientConfig,
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
        source: "Dual v2 draft + carrier references",
        destination: null,
        status: "preview-only" as const,
      },
      {
        kind: "client-adapter" as const,
        name: "OpenClash local SOCKS adapter",
        source: "singbox-multipath sidecar",
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
