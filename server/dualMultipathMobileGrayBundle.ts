import { z } from "zod";
import {
  dualMultipathDraftSchema,
  dualPortSchema,
  type DualMultipathDraftV5,
} from "../shared/dualMultipath";
import {
  MULTIPATH_POC_UPSTREAM,
  buildMultipathPocInbound,
  buildMultipathPocOutbound,
  type MultipathPocLeg,
} from "./multipathPocPlan";

export const DUAL_MOBILE_GRAY_BUNDLE_VERSION = 1 as const;
export const DUAL_ANDROID_GRAY_ARTIFACT = {
  platform: "android" as const,
  architecture: "arm64" as const,
  upstream: MULTIPATH_POC_UPSTREAM,
  requiredBuildTag: "with_quic" as const,
} as const;

const UNRESOLVED_PURE_MIERU_PROXY = "<unresolved:pure-mieru-proxy-ref>";
const UNRESOLVED_HY2_PORT = "<unresolved:hysteria2-port>";
const UNRESOLVED_HY2_TLS_NAME = "<unresolved:hysteria2-tls-server-name>";

export const dualMobileGrayInputSchema = z.object({
  sidecarIngressPort: dualPortSchema,
  clashMiPrivateListenerPort: dualPortSchema,
  pureMieruProxyRef: z.string().trim().min(1).max(255).nullable().default(null),
}).strict().superRefine((input, ctx) => {
  if (input.sidecarIngressPort === input.clashMiPrivateListenerPort) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["clashMiPrivateListenerPort"],
      message: "Mobile Gray sidecar ingress 与 Clash Mi private listener 不能使用同一端口",
    });
  }
});

export type DualMobileGrayInput = z.output<typeof dualMobileGrayInputSchema>;

function redactedSecretReference(reference: string) {
  return `<secret:${reference}>`;
}

function compilerLegs(draft: DualMultipathDraftV5): MultipathPocLeg[] {
  return draft.legs.map(({ legIndex, outboundTag, expectedBandwidthMbps, supportsUdp }) => ({
    legIndex,
    outboundTag,
    expectedBandwidthMbps,
    supportsUdp,
  }));
}

/**
 * Build an ephemeral Android + Clash Mi Gray validation bundle.
 *
 * This intentionally does not consume or mutate draft.clientTarget. The persisted
 * v5 client target models the eventual managed OpenWrt client; a phone used for a
 * one-off Gray test is a separate validation harness and must never become trusted
 * client discovery evidence.
 */
export function buildDualMultipathMobileGrayBundle(
  draftInput: unknown,
  mobileInput: unknown,
) {
  const draft = dualMultipathDraftSchema.parse(draftInput);
  const mobile = dualMobileGrayInputSchema.parse(mobileInput);
  if (mobile.pureMieruProxyRef === draft.openClashIngressAdapter.tag) {
    throw new Error("Mobile Gray private bridge 不允许递归回 ForwardX Dual ingress");
  }

  const legs = compilerLegs(draft);
  const multipathOutbound = buildMultipathPocOutbound(draft.line, legs);
  const multipathInbound = buildMultipathPocInbound(draft.line, legs);
  if (!multipathOutbound || !multipathInbound) {
    throw new Error("Mobile Gray bundle 未通过 pinned multipath 编译器校验");
  }

  const direct = draft.directCarrier;
  const androidSidecarConfig = {
    inbounds: [{
      type: "socks" as const,
      tag: "forwardx-dual-mobile-gray-in",
      listen: "127.0.0.1" as const,
      listen_port: mobile.sidecarIngressPort,
    }],
    outbounds: [
      {
        type: "socks" as const,
        tag: draft.legs[0].outboundTag,
        server: "127.0.0.1" as const,
        server_port: mobile.clashMiPrivateListenerPort,
        version: "5" as const,
      },
      {
        type: "hysteria2" as const,
        tag: draft.legs[1].outboundTag,
        server: direct.server,
        server_port: direct.serverPort ?? UNRESOLVED_HY2_PORT,
        password: redactedSecretReference(direct.authSecretRef),
        tls: {
          enabled: true as const,
          server_name: direct.tls.serverName ?? UNRESOLVED_HY2_TLS_NAME,
        },
      },
      multipathOutbound,
    ],
    route: { final: multipathOutbound.tag },
  };

  const clashMiPrivateListener = {
    listeners: [{
      name: `forwardx-mobile-gray-private-${draft.line.id}`,
      type: "socks" as const,
      listen: "127.0.0.1" as const,
      port: mobile.clashMiPrivateListenerPort,
      proxy: mobile.pureMieruProxyRef ?? UNRESOLVED_PURE_MIERU_PROXY,
    }],
    isolation: {
      dedicatedListenerOnly: true as const,
      normalRulesBypassed: true as const,
      genericMixedListenerAllowed: false as const,
      recursionAllowed: false as const,
      directOrPublicFallbackAllowed: false as const,
    },
  };

  const blockers = [
    "Android 本地 sidecar/listener 端口尚未在真实手机只读确认空闲",
    ...(mobile.pureMieruProxyRef ? [] : ["Clash Mi 中唯一纯 Mieru proxy 尚未绑定到 dedicated listener"]),
    ...(direct.status === "resolved" ? [] : ["Hysteria2 client 端口与 TLS server name 尚未解析"]),
    "Hysteria2 服务端 Gray runtime 尚未生成、校验或启动",
    `Android arm64 pinned artifact ${MULTIPATH_POC_UPSTREAM.commit} 的 CI SHA256 尚未记录到 deployment evidence`,
    "secret reference 尚未通过 Gray secret resolver 注入真实值",
    "最终 Android client / Dual server 配置尚未执行 sing-box check",
    "手机 VPN 分应用绕过与回环行为尚未在真实 Clash Mi 环境验证",
  ];

  return {
    version: DUAL_MOBILE_GRAY_BUNDLE_VERSION,
    mode: "mobile-gray-preview" as const,
    readyForRuntime: false as const,
    sourceDraft: {
      version: draft.version,
      name: draft.name,
      clientTargetIgnored: true as const,
    },
    testClient: {
      kind: "android-clash-mi" as const,
      lifecycle: "ephemeral-gray" as const,
      persistsToDualDraft: false as const,
      localPorts: {
        sidecarIngress: mobile.sidecarIngressPort,
        clashMiPrivateListener: mobile.clashMiPrivateListenerPort,
        availabilityVerified: false as const,
      },
      requiredVpnIsolation: {
        sidecarProcessMustBypassClashMiTun: true as const,
        reason: "避免 Hysteria2 direct leg 被 Clash Mi TUN 再次捕获形成递归/错误出口",
      },
    },
    artifact: DUAL_ANDROID_GRAY_ARTIFACT,
    fragments: {
      androidSidecarConfig,
      clashMiPrivateListener,
      serverMultipathConfig: { inbounds: [multipathInbound] },
      serverDirectCarrierPreview: {
        type: "hysteria2" as const,
        status: "not-compiled" as const,
        engine: draft.serverRuntime.directCarrierRuntime.engine,
        requiredBuildTag: "with_quic" as const,
        listenPort: direct.serverPort ?? UNRESOLVED_HY2_PORT,
        authSecretRef: direct.authSecretRef,
        tls: {
          serverName: direct.tls.serverName ?? UNRESOLVED_HY2_TLS_NAME,
          certificateSecretRef: draft.serverRuntime.directCarrierRuntime.tlsCertificateSecretRef,
          privateKeySecretRef: draft.serverRuntime.directCarrierRuntime.tlsPrivateKeySecretRef,
        },
        multipathTarget: {
          host: multipathInbound.listen,
          port: multipathInbound.listen_port,
        },
      },
    },
    blockers,
    safety: {
      draftPersistenceWrite: false as const,
      clientEvidenceWrite: false as const,
      agentPush: false as const,
      commandExecution: false as const,
      runtimeActivation: false as const,
      systemdWrite: false as const,
      firewallMutation: false as const,
      existingMitaMutation: false as const,
      existingClashMiMutation: false as const,
      productionDbWrite: false as const,
    },
  };
}
