import {
  compileDualMultipathPreview,
  parseDualMultipathDraft,
  type DualMultipathDraftInput,
} from "./dualMultipathControlPlane";

export const DUAL_MULTIPATH_DEPLOYMENT_PLAN_VERSION = 2 as const;

const FULL_CONFIG_PATH_PLACEHOLDER = "<FULL_CONFIG_PATH>";

/**
 * Build a deterministic, non-executable deployment plan.
 *
 * The current Dual draft only knows the two child outbound tags. It does not
 * contain their concrete sing-box outbound definitions or credentials, and it
 * is not bound to a real target host. For that reason this planner must remain
 * fail-closed: it can explain the intended artifacts and validation command,
 * but it can never claim that the configuration is ready to deploy.
 */
export function buildDualMultipathDeploymentPlan(input: DualMultipathDraftInput | unknown) {
  const draft = parseDualMultipathDraft(input);
  const preview = compileDualMultipathPreview(draft);
  const privateTag = draft.legs[0].outboundTag;
  const directTag = draft.legs[1].outboundTag;

  const blockers = [
    `缺少专线子 outbound（${privateTag}）的完整定义与凭据`,
    `缺少直连子 outbound（${directTag}）的完整定义与凭据`,
    "尚未绑定真实 Dual 目标主机、系统架构与安装目录",
    "尚未确认 multipath listener 仅通过受信或已认证的子路径可达；multipath 协议本身不提供认证或加密",
    `尚未解析并校验固定上游 commit ${preview.upstream.commit} 对应的可部署二进制产物`,
  ];

  return {
    version: DUAL_MULTIPATH_DEPLOYMENT_PLAN_VERSION,
    mode: "dry-run" as const,
    name: draft.name,
    readyToDeploy: false as const,
    upstream: preview.upstream,
    listener: {
      listen: String(preview.serverInbound.listen || "127.0.0.1"),
      port: Number(preview.serverInbound.listen_port),
      tcpFastOpen: preview.serverInbound.tcp_fast_open === true,
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
      clientOutbound: preview.clientOutbound,
      serverInbound: preview.serverInbound,
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
        name: "full sing-box config",
        source: "Dual draft + two concrete child outbounds",
        destination: null,
        status: "blocked" as const,
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
        reason: "当前只有 multipath 片段，尚无包含两个子 outbound 的完整配置文件",
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
