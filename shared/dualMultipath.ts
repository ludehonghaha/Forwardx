import { z } from "zod";

export const DUAL_MULTIPATH_CONTROL_PLANE_VERSION = 3 as const;

const UINT32_MAX = 0xffffffff;
const MAX_REORDER_BYTES = 512 * 1024 * 1024;
const MAX_QUEUE_BYTES = 64 * 1024 * 1024;

export const dualDurationSchema = z.string().trim().regex(/^\d+(?:\.\d+)?(?:ms|s|m|h)$/, "时长格式必须类似 500ms、1s、2m");
export const dualSecretReferenceSchema = z.string()
  .trim()
  .min(1, "请填写 secret reference")
  .max(128)
  .regex(/^dual\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/i, "secret reference 必须使用 dual.* 命名，不能填写 secret value");
export const dualLoopbackSchema = z.literal("127.0.0.1", {
  errorMap: () => ({ message: "当前离线阶段只允许 127.0.0.1 回环监听，禁止公网 listener" }),
});
export const dualPortSchema = z.number().int().min(1).max(65535);

export const dualMultipathLineSchema = z.object({
  id: z.number().int().positive(),
  server: z.string().trim().min(1, "请填写 multipath 服务端地址").max(255),
  serverPort: dualPortSchema,
  listen: dualLoopbackSchema.optional(),
  preferredLegIndex: z.literal(0).optional(),
  udpLegIndex: z.union([z.literal(0), z.literal(1)]).optional(),
  tcpFastOpen: z.boolean().optional(),
  activationThresholdMbps: z.number().int().min(1).max(UINT32_MAX).optional(),
  activationAfterBytes: z.number().int().safe().positive().optional(),
  activationWindow: dualDurationSchema.optional(),
  chunkSize: z.number().int().min(1024).max(1024 * 1024).optional(),
  queueFrames: z.number().int().min(8).max(4096).optional(),
  maxReorderFrames: z.number().int().min(1).max(UINT32_MAX).optional(),
  maxReorderBytes: z.number().int().safe().positive().max(MAX_REORDER_BYTES).optional(),
  leg1ReplayBytes: z.number().int().safe().positive().max(MAX_REORDER_BYTES).optional(),
  leg1ReplayTimeout: dualDurationSchema.optional(),
  handshakeTimeout: dualDurationSchema.optional(),
}).strict().superRefine((line, ctx) => {
  const chunkSize = line.chunkSize ?? 64 * 1024;
  const queueFrames = line.queueFrames ?? 256;
  if (chunkSize * queueFrames > MAX_QUEUE_BYTES) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["queueFrames"], message: "chunkSize × queueFrames 不能超过 64 MiB" });
  }
});

export const dualPrivateLegSchema = z.object({
  role: z.literal("private"),
  legIndex: z.literal(0),
  outboundTag: z.string().trim().min(1).max(128),
  expectedBandwidthMbps: z.number().int().min(1).max(UINT32_MAX).optional(),
  supportsUdp: z.boolean().default(true),
}).strict();

export const dualDirectLegSchema = z.object({
  role: z.literal("direct"),
  legIndex: z.literal(1),
  outboundTag: z.string().trim().min(1).max(128),
  expectedBandwidthMbps: z.number().int().min(1).max(UINT32_MAX).optional(),
  supportsUdp: z.boolean().default(true),
}).strict();

const socksCredentialsSchema = z.object({
  usernameSecretRef: dualSecretReferenceSchema,
  passwordSecretRef: dualSecretReferenceSchema,
}).strict();

const mihomoDedicatedListenerBridgeSchema = z.object({
  type: z.literal("mihomo-dedicated-listener"),
  status: z.enum(["unresolved", "resolved"]),
  listener: z.object({
    kind: z.literal("socks"),
    scope: z.literal("dedicated"),
    listen: dualLoopbackSchema,
    portStrategy: z.literal("auto"),
    port: dualPortSchema.nullable(),
  }).strict(),
  target: z.object({
    selection: z.literal("single-proxy"),
    protocol: z.literal("mieru"),
    proxyRef: z.string().trim().min(1).max(255).optional(),
    routing: z.literal("fixed-proxy"),
    fallback: z.literal("none"),
    transportScope: z.literal("private-only"),
  }).strict(),
}).strict();

const externalLocalSocks5BridgeSchema = z.object({
  type: z.literal("external-local-socks5"),
  status: z.enum(["unresolved", "resolved"]),
  endpoint: z.object({
    listenerKind: z.literal("dedicated-socks"),
    host: dualLoopbackSchema,
    port: dualPortSchema,
  }).strict().optional(),
  credentials: socksCredentialsSchema.optional(),
}).strict();

const privateCarrierBridgeSchema = z.union([
  mihomoDedicatedListenerBridgeSchema,
  externalLocalSocks5BridgeSchema,
]);

const directCarrierSchema = z.object({
  type: z.literal("hysteria2"),
  status: z.enum(["unresolved", "resolved"]),
  server: z.string().trim().min(1).max(255),
  serverPort: dualPortSchema.nullable(),
  tls: z.object({ serverName: z.string().trim().min(1).max(255).nullable() }).strict(),
  authSecretRef: dualSecretReferenceSchema,
}).strict();

const openClashIngressAdapterSchema = z.object({
  type: z.literal("local-socks-sidecar"),
  status: z.enum(["unresolved", "resolved"]),
  tag: z.string().trim().min(1).max(128),
  listen: dualLoopbackSchema,
  portStrategy: z.literal("auto"),
  port: dualPortSchema.nullable(),
}).strict();

const targetSideSchema = z.object({
  interfaceName: z.string().trim().min(1).max(64),
  sourceAddress: z.string().trim().min(1).max(255),
  addresses: z.array(z.string().trim().min(1).max(255)).min(1),
}).strict();

export const dualTargetDiscoverySnapshotSchema = z.union([
  z.object({
    status: z.literal("unresolved"),
    targetId: z.string().trim().min(1).max(128),
  }).strict(),
  z.object({
    status: z.literal("verified-read-only"),
    targetId: z.string().trim().min(1).max(128),
    platform: z.object({ kernel: z.string().trim().min(1).max(64), architecture: z.string().trim().min(1).max(64) }).strict(),
    publicSide: targetSideSchema.extend({ gateway: z.string().trim().min(1).max(255) }).strict(),
    privateSide: targetSideSchema,
    defaultRoute: z.object({ via: z.string().trim().min(1).max(255), dev: z.string().trim().min(1).max(64) }).strict(),
    existingPrivateCarrier: z.object({
      type: z.literal("mita"),
      binaryPath: z.string().trim().min(1).max(255).nullable(),
      serviceStatus: z.enum(["active", "inactive", "failed", "unknown"]),
      listener: z.object({ network: z.literal("tcp"), listen: z.string().trim().min(1).max(255), port: dualPortSchema }).strict(),
      lifecycle: z.literal("preserve"),
    }).strict(),
    installedBinaries: z.object({ singBox: z.boolean(), hysteria: z.boolean(), standaloneMieru: z.boolean() }).strict(),
  }).strict(),
]);

const serverRuntimeSchema = z.object({
  status: z.literal("unresolved"),
  multipathListener: z.object({ listen: dualLoopbackSchema, port: dualPortSchema }).strict(),
  directCarrierRuntime: z.object({
    status: z.literal("unresolved"),
    engine: z.literal("pinned-singbox-multipath"),
    nativeHysteria2: z.literal("requires-with_quic-build-tag"),
    separateHysteriaBinaryRequired: z.literal(false),
    bindStrategy: z.literal("discovered-public-side"),
    tlsCertificateSecretRef: dualSecretReferenceSchema,
    tlsPrivateKeySecretRef: dualSecretReferenceSchema,
  }).strict(),
}).strict();

export const dualMultipathDraftSchema = z.object({
  version: z.literal(DUAL_MULTIPATH_CONTROL_PLANE_VERSION).default(DUAL_MULTIPATH_CONTROL_PLANE_VERSION),
  state: z.literal("draft").default("draft"),
  name: z.string().trim().min(1, "请填写 Dual 配置名称").max(80),
  line: dualMultipathLineSchema,
  legs: z.tuple([dualPrivateLegSchema, dualDirectLegSchema]),
  targetDiscovery: dualTargetDiscoverySnapshotSchema,
  openClashIngressAdapter: openClashIngressAdapterSchema,
  privateCarrierBridge: privateCarrierBridgeSchema,
  directCarrier: directCarrierSchema,
  serverRuntime: serverRuntimeSchema,
}).strict().superRefine((draft, ctx) => {
  const [privateLeg, directLeg] = draft.legs;
  if (privateLeg.outboundTag === directLeg.outboundTag) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["legs", 1, "outboundTag"], message: "专线与直连必须引用不同的 outbound tag" });
  }
  const udpLegIndex = draft.line.udpLegIndex ?? 0;
  if (draft.legs[udpLegIndex].supportsUdp === false) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["line", "udpLegIndex"], message: "指定的 UDP 路径不支持 UDP" });
  }
  const ingress = draft.openClashIngressAdapter;
  if (ingress.status === "resolved" && ingress.port === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["openClashIngressAdapter", "port"], message: "已解析的 Dual ingress 必须包含自动检查后确定的端口" });
  }
  if (ingress.status === "unresolved" && ingress.port !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["openClashIngressAdapter", "port"], message: "未解析的 Dual ingress 端口必须为 null" });
  }
  const bridge = draft.privateCarrierBridge;
  if (bridge.type === "mihomo-dedicated-listener") {
    if (bridge.status === "resolved" && (!bridge.target.proxyRef || bridge.listener.port === null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["privateCarrierBridge", "status"], message: "已解析的 Mihomo bridge 必须包含单一纯 Mieru proxy 和自动检查后确定的端口" });
    }
    if (bridge.status === "unresolved" && bridge.listener.port !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["privateCarrierBridge", "listener", "port"], message: "未解析的 Mihomo bridge 端口必须为 null" });
    }
    if (bridge.target.proxyRef === ingress.tag) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["privateCarrierBridge", "target", "proxyRef"], message: "private bridge 不允许递归回 ForwardX Dual ingress" });
    }
    if (bridge.listener.port !== null && ingress.port !== null && bridge.listener.port === ingress.port) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["privateCarrierBridge"], message: "private listener 与 Dual ingress 不能使用同一端口" });
    }
  } else {
    if (bridge.status === "resolved" && !bridge.endpoint) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["privateCarrierBridge", "endpoint"], message: "已解析的 external SOCKS5 bridge 必须包含真实发现的 endpoint" });
    }
    if (bridge.status === "unresolved" && bridge.endpoint) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["privateCarrierBridge", "endpoint"], message: "未解析的 external SOCKS5 bridge 不得伪造 endpoint" });
    }
    if (bridge.endpoint && ingress.port !== null && bridge.endpoint.port === ingress.port) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["privateCarrierBridge"], message: "private listener 与 Dual ingress 不能使用同一端口" });
    }
  }
  if (draft.directCarrier.status === "resolved" && (draft.directCarrier.serverPort === null || draft.directCarrier.tls.serverName === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["directCarrier", "status"], message: "已解析的 Hysteria2 carrier 必须包含端口和 TLS server name" });
  }
  if (
    draft.serverRuntime.multipathListener.listen !== (draft.line.listen ?? "127.0.0.1")
    || draft.serverRuntime.multipathListener.port !== draft.line.serverPort
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["serverRuntime", "multipathListener"], message: "server runtime multipath listener 必须与 line 的 loopback target 一致" });
  }
});

export type DualMultipathDraftV3 = z.output<typeof dualMultipathDraftSchema>;
export type DualMultipathDraftV3Input = z.input<typeof dualMultipathDraftSchema>;
export type DualTargetDiscoverySnapshot = z.output<typeof dualTargetDiscoverySnapshotSchema>;
export type DualMultipathInfrastructureState = Pick<
  DualMultipathDraftV3,
  "line" | "legs" | "targetDiscovery" | "openClashIngressAdapter" | "privateCarrierBridge" | "directCarrier" | "serverRuntime"
>;
export type DualMihomoDedicatedListenerBridge = Extract<
  DualMultipathDraftV3["privateCarrierBridge"],
  { type: "mihomo-dedicated-listener" }
>;
export type DefaultDualMultipathInfrastructureState = Omit<DualMultipathInfrastructureState, "privateCarrierBridge"> & {
  privateCarrierBridge: DualMihomoDedicatedListenerBridge;
};

export const NO_BRAND_DUAL_DISCOVERY_SNAPSHOT = {
  status: "verified-read-only",
  targetId: "nobrand-dual-current",
  platform: { kernel: "Linux", architecture: "x86_64" },
  publicSide: {
    interfaceName: "eth0",
    sourceAddress: "87.86.22.221",
    addresses: ["87.86.22.221/24"],
    gateway: "87.86.22.1",
  },
  privateSide: {
    interfaceName: "eth1",
    sourceAddress: "172.16.4.114",
    addresses: ["172.16.4.114/24"],
  },
  defaultRoute: { via: "87.86.22.1", dev: "eth0" },
  existingPrivateCarrier: {
    type: "mita",
    binaryPath: "/usr/local/bin/mita",
    serviceStatus: "active",
    listener: { network: "tcp", listen: "*", port: 11464 },
    lifecycle: "preserve",
  },
  installedBinaries: { singBox: false, hysteria: false, standaloneMieru: false },
} as const satisfies DualTargetDiscoverySnapshot;

export function createUnresolvedDualDiscoverySnapshot(targetId = "unselected-target"): DualTargetDiscoverySnapshot {
  return { status: "unresolved", targetId };
}

export function createDefaultDualMultipathInfrastructure(
  targetDiscovery: DualTargetDiscoverySnapshot = createUnresolvedDualDiscoverySnapshot(),
): DefaultDualMultipathInfrastructureState {
  const directServer = targetDiscovery.status === "verified-read-only"
    ? targetDiscovery.publicSide.sourceAddress
    : "<unresolved:dual-public-address>";
  return {
    line: {
      id: 1,
      server: "127.0.0.1",
      serverPort: 39000,
      listen: "127.0.0.1",
      preferredLegIndex: 0,
      udpLegIndex: 0,
      tcpFastOpen: true,
    },
    legs: [
      { role: "private", legIndex: 0, outboundTag: "forwardx-private-mieru", supportsUdp: true },
      { role: "direct", legIndex: 1, outboundTag: "forwardx-direct-hy2", supportsUdp: true },
    ],
    targetDiscovery,
    openClashIngressAdapter: {
      type: "local-socks-sidecar",
      status: "unresolved",
      tag: "forwardx-dual-ingress-1",
      listen: "127.0.0.1",
      portStrategy: "auto",
      port: null,
    },
    privateCarrierBridge: {
      type: "mihomo-dedicated-listener",
      status: "unresolved",
      listener: { kind: "socks", scope: "dedicated", listen: "127.0.0.1", portStrategy: "auto", port: null },
      target: {
        selection: "single-proxy",
        protocol: "mieru",
        routing: "fixed-proxy",
        fallback: "none",
        transportScope: "private-only",
      },
    },
    directCarrier: {
      type: "hysteria2",
      status: "unresolved",
      server: directServer,
      serverPort: null,
      tls: { serverName: null },
      authSecretRef: "dual.hy2.auth",
    },
    serverRuntime: {
      status: "unresolved",
      multipathListener: { listen: "127.0.0.1", port: 39000 },
      directCarrierRuntime: {
        status: "unresolved",
        engine: "pinned-singbox-multipath",
        nativeHysteria2: "requires-with_quic-build-tag",
        separateHysteriaBinaryRequired: false,
        bindStrategy: "discovered-public-side",
        tlsCertificateSecretRef: "dual.hy2.tls.certificate",
        tlsPrivateKeySecretRef: "dual.hy2.tls.private-key",
      },
    },
  };
}
