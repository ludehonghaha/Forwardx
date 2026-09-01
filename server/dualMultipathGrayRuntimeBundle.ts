import { z } from "zod";
import {
  dualMultipathDraftSchema,
  dualPortSchema,
  dualPrivateCarrierClientEndpointDiscoverySchema,
  type DualMultipathDraftV5,
} from "../shared/dualMultipath";
import {
  MULTIPATH_POC_UPSTREAM,
  buildMultipathPocInbound,
  buildMultipathPocOutbound,
  type MultipathPocLeg,
} from "./multipathPocPlan";
import {
  DUAL_MIERU_UPSTREAM,
  buildDualMieruClientConfigTemplate,
} from "./dualMultipathMieruSidecar";

export const DUAL_GRAY_RUNTIME_BUNDLE_VERSION = 3 as const;
export const DUAL_WINDOWS_GRAY_ARTIFACT = {
  platform: "windows" as const,
  architecture: "amd64" as const,
  upstream: MULTIPATH_POC_UPSTREAM,
  requiredBuildTag: "with_quic" as const,
  mieru: DUAL_MIERU_UPSTREAM,
} as const;
export const DUAL_LINUX_GRAY_ARTIFACT = {
  platform: "linux" as const,
  architecture: "amd64" as const,
  upstream: MULTIPATH_POC_UPSTREAM,
  requiredBuildTag: "with_quic" as const,
} as const;

export const dualGrayRuntimeInputSchema = z.object({
  windowsSidecarIngressPort: dualPortSchema,
  windowsPrivateSocksPort: dualPortSchema,
  privateCarrierClientEndpoint: dualPrivateCarrierClientEndpointDiscoverySchema,
  hy2Port: dualPortSchema,
  tlsServerName: z.string().trim().min(1).max(255),
  tlsCertificatePath: z.string().trim().min(1).max(1024),
  tlsPrivateKeyPath: z.string().trim().min(1).max(1024),
  tlsMode: z.literal("self-signed-gray"),
}).strict().superRefine((input, ctx) => {
  if (input.windowsSidecarIngressPort === input.windowsPrivateSocksPort) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["windowsPrivateSocksPort"],
      message: "Windows Gray sidecar ingress 与 private SOCKS 不能使用同一端口",
    });
  }
});

export type DualGrayRuntimeInput = z.output<typeof dualGrayRuntimeInputSchema>;

function compilerLegs(draft: DualMultipathDraftV5): MultipathPocLeg[] {
  return draft.legs.map(({ legIndex, outboundTag, expectedBandwidthMbps, supportsUdp }) => ({
    legIndex,
    outboundTag,
    expectedBandwidthMbps,
    supportsUdp,
  }));
}

function secretPlaceholder(reference: string) {
  return `<secret:${reference}>`;
}

/**
 * Build a non-persistent Windows + Dual-server Gray runtime template.
 *
 * The pinned singbox-multipath fork does not implement Mieru. ForwardX owns an
 * official Mieru foreground sidecar which exposes the dedicated loopback SOCKS
 * child outbound. Clash Mi is neither inspected nor modified.
 *
 * This function ignores persisted client discovery state. The client-visible
 * Mieru ingress must instead arrive as explicit verified Gray runtime evidence.
 */
export function buildDualMultipathGrayRuntimeBundle(
  draftInput: unknown,
  runtimeInput: unknown,
) {
  const draft = dualMultipathDraftSchema.parse(draftInput);
  const input = dualGrayRuntimeInputSchema.parse(runtimeInput);
  const serverTarget = draft.serverTargetDiscovery;
  if (serverTarget.status !== "verified-read-only") {
    throw new Error("Dual Gray server 必须先有 verified-read-only 服务端 discovery");
  }
  if (serverTarget.existingPrivateCarrier.serviceStatus !== "active") {
    throw new Error("Dual Gray private Mita carrier 当前不是 active，拒绝生成可测试拓扑");
  }
  if (draft.line.server !== "127.0.0.1" || (draft.line.listen ?? "127.0.0.1") !== "127.0.0.1") {
    throw new Error("Dual Gray multipath target/listener 必须保持 127.0.0.1 loopback-only");
  }
  if (input.hy2Port === serverTarget.existingPrivateCarrier.listener.port) {
    throw new Error("Dual Gray HY2 端口不能占用现有 Mita listener 端口");
  }
  if (input.hy2Port === draft.serverRuntime.multipathListener.port) {
    throw new Error("Dual Gray HY2 端口不能与 multipath loopback listener 共用");
  }
  if (draft.privateCarrierBridge.type !== "forwardx-managed-mieru-sidecar") {
    throw new Error("Dual Gray private bridge 必须使用 ForwardX-managed official Mieru sidecar");
  }
  if (input.privateCarrierClientEndpoint.status !== "verified-read-only") {
    throw new Error("Dual Gray 缺少 verified client-visible Mieru ingress，拒绝生成 Windows runtime");
  }
  const privateCarrierEndpoint = input.privateCarrierClientEndpoint.endpoint;

  const legs = compilerLegs(draft);
  const multipathOutbound = buildMultipathPocOutbound(draft.line, legs);
  const multipathInbound = buildMultipathPocInbound(draft.line, legs);
  if (!multipathOutbound || !multipathInbound) {
    throw new Error("Dual Gray bundle 未通过 pinned multipath 编译器校验");
  }

  const publicAddress = serverTarget.publicSide.sourceAddress;
  const hy2Password = secretPlaceholder(draft.directCarrier.authSecretRef);
  const windowsMieruClientConfig = buildDualMieruClientConfigTemplate(
    draft,
    input.windowsPrivateSocksPort,
    input.privateCarrierClientEndpoint,
  );

  const windowsSidecarConfig = {
    log: { level: "info" as const },
    inbounds: [{
      type: "socks" as const,
      tag: "forwardx-dual-windows-gray-in",
      listen: "127.0.0.1" as const,
      listen_port: input.windowsSidecarIngressPort,
    }],
    outbounds: [
      {
        type: "socks" as const,
        tag: draft.legs[0].outboundTag,
        server: "127.0.0.1" as const,
        server_port: input.windowsPrivateSocksPort,
        version: "5" as const,
      },
      {
        type: "hysteria2" as const,
        tag: draft.legs[1].outboundTag,
        server: publicAddress,
        server_port: input.hy2Port,
        password: hy2Password,
        tls: {
          enabled: true as const,
          server_name: input.tlsServerName,
          insecure: true as const,
        },
      },
      multipathOutbound,
    ],
    route: { final: multipathOutbound.tag },
  };

  const serverConfig = {
    log: { level: "info" as const },
    inbounds: [
      {
        type: "hysteria2" as const,
        tag: "forwardx-dual-gray-hy2-in",
        listen: publicAddress,
        listen_port: input.hy2Port,
        users: [{ name: "forwardx-dual-gray", password: hy2Password }],
        tls: {
          enabled: true as const,
          server_name: input.tlsServerName,
          certificate_path: input.tlsCertificatePath,
          key_path: input.tlsPrivateKeyPath,
        },
      },
      multipathInbound,
    ],
    outbounds: [{ type: "direct" as const, tag: "direct" as const }],
    route: { final: "direct" as const },
  };

  const blockers = [
    "Windows 两个本地 Gray 端口尚未在真实机器确认空闲",
    "真实 Mieru client username/password 尚未通过 Gray secret resolver 注入",
    "Dual 服务端 Gray HY2 UDP 端口尚未在真实机器确认空闲",
    "Gray 自签 TLS 仅用于隔离测试，不能作为生产 TLS 策略",
    "真实 HY2 auth secret 尚未通过 Gray secret resolver 注入",
    "真实服务端证书/私钥文件尚未部署",
    "真实 Windows / Dual server materialized 配置尚未执行 sing-box check",
    "Gray runtime 尚未启动，健康检查与回滚尚未执行",
  ];

  return {
    version: DUAL_GRAY_RUNTIME_BUNDLE_VERSION,
    mode: "windows-server-gray-preview" as const,
    readyForRuntime: false as const,
    sourceDraft: {
      version: draft.version,
      name: draft.name,
      clientTargetIgnored: true as const,
      clientEvidenceIgnored: true as const,
      privateCarrierClientEndpointEvidence: input.privateCarrierClientEndpoint.evidence,
    },
    artifacts: {
      windows: DUAL_WINDOWS_GRAY_ARTIFACT,
      server: DUAL_LINUX_GRAY_ARTIFACT,
    },
    topology: {
      privateLeg: {
        clientEngine: "forwardx-managed-official-mieru" as const,
        upstream: DUAL_MIERU_UPSTREAM,
        localSocks: { listen: "127.0.0.1" as const, port: input.windowsPrivateSocksPort },
        clientVisibleIngress: privateCarrierEndpoint,
        carrier: "existing-mita-mieru" as const,
        existingServerBinaryPath: serverTarget.existingPrivateCarrier.binaryPath,
        existingServerUnitName: serverTarget.existingPrivateCarrier.unitName ?? null,
        existingServerListenerPort: serverTarget.existingPrivateCarrier.listener.port,
        lifecycle: serverTarget.existingPrivateCarrier.lifecycle,
      },
      directLeg: {
        clientEngine: "pinned-singbox-hysteria2" as const,
        serverBind: publicAddress,
        serverPort: input.hy2Port,
      },
      multipath: {
        clientEngine: "pinned-singbox-multipath" as const,
        serverListen: multipathInbound.listen,
        serverPort: multipathInbound.listen_port,
      },
    },
    fragments: {
      windowsSidecarConfig,
      windowsMieruClientConfig,
      serverConfig,
    },
    blockers,
    safety: {
      tlsMode: input.tlsMode,
      tlsVerificationDisabledOnGrayClient: true as const,
      productionTlsApproved: false as const,
      templatesContainSecretValues: false as const,
      secretReferencesOnly: true as const,
      draftPersistenceWrite: false as const,
      clientEvidenceWrite: false as const,
      agentPush: false as const,
      commandExecution: false as const,
      runtimeActivation: false as const,
      systemdWrite: false as const,
      firewallMutation: false as const,
      routeMutation: false as const,
      existingMitaMutation: false as const,
      productionDbWrite: false as const,
      clashMiRead: false as const,
      clashMiMutation: false as const,
      globalMieruConfigWrite: false as const,
    },
  };
}
