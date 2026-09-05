import { z } from "zod";

export const DUAL_MULTIPATH_CONTROL_PLANE_VERSION = 5 as const;

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

export const dualPrivateCarrierClientEndpointDiscoverySchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("unresolved"),
    endpoint: z.null(),
  }).strict(),
  z.object({
    status: z.literal("verified-read-only"),
    endpoint: z.object({
      server: z.string().trim().min(1).max(255),
      port: dualPortSchema,
      protocol: z.literal("TCP"),
    }).strict(),
    evidence: z.object({
      snapshotId: z.string().trim().min(1).max(128),
      targetId: z.string().trim().min(1).max(128),
      observedAt: z.string().datetime({ offset: true }),
      discoverySource: z.enum([
        "windows-established-tcp-connection",
        "client-config-read-only",
        "synthetic-test",
      ]),
    }).strict(),
  }).strict(),
]);

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

const legacyV3MihomoDedicatedListenerBridgeSchema = z.object({
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

const legacyV3ExternalLocalSocks5BridgeSchema = z.object({
  type: z.literal("external-local-socks5"),
  status: z.enum(["unresolved", "resolved"]),
  endpoint: z.object({
    listenerKind: z.literal("dedicated-socks"),
    host: dualLoopbackSchema,
    port: dualPortSchema,
  }).strict().optional(),
  credentials: socksCredentialsSchema.optional(),
}).strict();

const legacyV3PrivateCarrierBridgeSchema = z.union([
  legacyV3MihomoDedicatedListenerBridgeSchema,
  legacyV3ExternalLocalSocks5BridgeSchema,
]);

const directCarrierSchema = z.object({
  type: z.literal("hysteria2"),
  status: z.enum(["unresolved", "resolved"]),
  server: z.string().trim().min(1).max(255),
  serverPort: dualPortSchema.nullable(),
  tls: z.object({ serverName: z.string().trim().min(1).max(255).nullable() }).strict(),
  authSecretRef: dualSecretReferenceSchema,
}).strict();

const legacyV3OpenClashIngressAdapterSchema = z.object({
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

export const dualServerTargetDiscoverySnapshotSchema = z.union([
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
      unitName: z.string().trim().min(1).max(255).nullable().optional(),
      serviceStatus: z.enum(["active", "inactive", "failed", "unknown"]),
      listener: z.object({ network: z.literal("tcp"), listen: z.string().trim().min(1).max(255), port: dualPortSchema }).strict(),
      lifecycle: z.literal("preserve"),
    }).strict(),
    installedBinaries: z.object({ singBox: z.boolean(), hysteria: z.boolean(), standaloneMieru: z.boolean() }).strict(),
  }).strict(),
]);

// Legacy v3/v4 drafts used the generic targetDiscovery name for server facts.
export const dualTargetDiscoverySnapshotSchema = dualServerTargetDiscoverySnapshotSchema;

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

export const dualMultipathDraftV3Schema = z.object({
  version: z.literal(3).default(3),
  state: z.literal("draft").default("draft"),
  name: z.string().trim().min(1, "请填写 Dual 配置名称").max(80),
  line: dualMultipathLineSchema,
  legs: z.tuple([dualPrivateLegSchema, dualDirectLegSchema]),
  targetDiscovery: dualTargetDiscoverySnapshotSchema,
  openClashIngressAdapter: legacyV3OpenClashIngressAdapterSchema,
  privateCarrierBridge: legacyV3PrivateCarrierBridgeSchema,
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

const dualAutoPortPlanningV4Schema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("unresolved"),
    strategy: z.literal("auto"),
    port: z.null(),
  }).strict(),
  z.object({
    status: z.literal("planned-read-only"),
    strategy: z.literal("auto"),
    port: dualPortSchema,
    snapshotId: z.string().trim().min(1).max(128),
  }).strict(),
]);

const pureMieruProxyDiscoveryV4Schema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unresolved"), proxyRef: z.null() }).strict(),
  z.object({
    status: z.literal("verified-read-only"),
    proxyRef: z.string().trim().min(1).max(255),
  }).strict(),
]);

const externalSocksEndpointDiscoveryV4Schema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unresolved"), endpoint: z.null() }).strict(),
  z.object({
    status: z.literal("verified-read-only"),
    endpoint: z.object({
      listenerKind: z.literal("dedicated-socks"),
      host: dualLoopbackSchema,
      port: dualPortSchema,
    }).strict(),
  }).strict(),
]);

const mihomoDedicatedListenerBridgeV4Schema = z.object({
  type: z.literal("mihomo-dedicated-listener"),
  listener: z.object({
    kind: z.literal("socks"),
    scope: z.literal("dedicated"),
    listen: dualLoopbackSchema,
    portPlanning: dualAutoPortPlanningV4Schema,
  }).strict(),
  target: z.object({
    selection: z.literal("single-proxy"),
    protocol: z.literal("mieru"),
    discovery: pureMieruProxyDiscoveryV4Schema,
    routing: z.literal("fixed-proxy"),
    fallback: z.literal("none"),
    transportScope: z.literal("private-only"),
  }).strict(),
}).strict();

const externalLocalSocks5BridgeV4Schema = z.object({
  type: z.literal("external-local-socks5"),
  endpointDiscovery: externalSocksEndpointDiscoveryV4Schema,
  credentials: socksCredentialsSchema.optional(),
}).strict();

const privateCarrierBridgeV4Schema = z.union([
  mihomoDedicatedListenerBridgeV4Schema,
  externalLocalSocks5BridgeV4Schema,
]);

const openClashIngressAdapterV4Schema = z.object({
  type: z.literal("local-socks-sidecar"),
  tag: z.string().trim().min(1).max(128),
  listen: dualLoopbackSchema,
  portPlanning: dualAutoPortPlanningV4Schema,
}).strict();

export const dualMultipathDraftV4Schema = z.object({
  version: z.literal(4).default(4),
  state: z.literal("draft").default("draft"),
  name: z.string().trim().min(1, "请填写 Dual 配置名称").max(80),
  line: dualMultipathLineSchema,
  legs: z.tuple([dualPrivateLegSchema, dualDirectLegSchema]),
  targetDiscovery: dualTargetDiscoverySnapshotSchema,
  openClashIngressAdapter: openClashIngressAdapterV4Schema,
  privateCarrierBridge: privateCarrierBridgeV4Schema,
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
  const ingressPort = draft.openClashIngressAdapter.portPlanning.port;
  const bridge = draft.privateCarrierBridge;
  if (bridge.type === "mihomo-dedicated-listener") {
    const privatePort = bridge.listener.portPlanning.port;
    if (privatePort !== null && ingressPort !== null && privatePort === ingressPort) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["privateCarrierBridge", "listener", "portPlanning"], message: "private listener 与 Dual ingress 不能使用同一端口" });
    }
    if (bridge.target.discovery.status === "verified-read-only" && bridge.target.discovery.proxyRef === draft.openClashIngressAdapter.tag) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["privateCarrierBridge", "target", "discovery", "proxyRef"], message: "private bridge 不允许递归回 ForwardX Dual ingress" });
    }
  } else if (
    bridge.endpointDiscovery.status === "verified-read-only"
    && ingressPort !== null
    && bridge.endpointDiscovery.endpoint.port === ingressPort
  ) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["privateCarrierBridge", "endpointDiscovery"], message: "private listener 与 Dual ingress 不能使用同一端口" });
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

const dualExternalClientTargetKeySchema = z.string()
  .trim()
  .min(1)
  .max(160)
  .regex(
    /^dual-client:[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._-]*$/i,
    "external OpenWrt target key 必须使用 dual-client:<namespace>:<stable-key>，不能使用 IP",
  );

export const dualClientTargetRefSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("forwardx-host"),
    hostId: z.number().int().positive(),
  }).strict(),
  z.object({
    kind: z.literal("external-openwrt"),
    targetKey: dualExternalClientTargetKeySchema,
  }).strict(),
]);

export const dualClientTargetSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unresolved") }).strict(),
  z.object({
    status: z.literal("bound"),
    ref: dualClientTargetRefSchema,
  }).strict(),
]);

export type DualClientTargetRef = z.output<typeof dualClientTargetRefSchema>;

export function dualClientTargetRefsEqual(a: DualClientTargetRef, b: DualClientTargetRef) {
  if (a.kind !== b.kind) return false;
  return a.kind === "forwardx-host"
    ? a.hostId === (b as Extract<DualClientTargetRef, { kind: "forwardx-host" }>).hostId
    : a.targetKey === (b as Extract<DualClientTargetRef, { kind: "external-openwrt" }>).targetKey;
}

export const dualClientSnapshotEvidenceSchema = z.object({
  snapshotId: z.string().trim().min(1).max(128),
  clientTargetRef: dualClientTargetRefSchema,
}).strict();

export const dualAutoPortPlanningSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("unresolved"),
    strategy: z.literal("auto"),
    port: z.null(),
  }).strict(),
  z.object({
    status: z.literal("planned-read-only"),
    strategy: z.literal("auto"),
    port: dualPortSchema,
    evidence: dualClientSnapshotEvidenceSchema,
  }).strict(),
]);

const pureMieruProxyDiscoverySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unresolved"), proxyRef: z.null() }).strict(),
  z.object({
    status: z.literal("verified-read-only"),
    proxyRef: z.string().trim().min(1).max(255),
    evidence: dualClientSnapshotEvidenceSchema,
  }).strict(),
]);

const externalSocksEndpointDiscoverySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unresolved"), endpoint: z.null() }).strict(),
  z.object({
    status: z.literal("verified-read-only"),
    endpoint: z.object({
      listenerKind: z.literal("dedicated-socks"),
      host: dualLoopbackSchema,
      port: dualPortSchema,
    }).strict(),
    evidence: dualClientSnapshotEvidenceSchema,
  }).strict(),
]);

const mihomoDedicatedListenerBridgeSchema = z.object({
  type: z.literal("mihomo-dedicated-listener"),
  listener: z.object({
    kind: z.literal("socks"),
    scope: z.literal("dedicated"),
    listen: dualLoopbackSchema,
    portPlanning: dualAutoPortPlanningSchema,
  }).strict(),
  target: z.object({
    selection: z.literal("single-proxy"),
    protocol: z.literal("mieru"),
    discovery: pureMieruProxyDiscoverySchema,
    routing: z.literal("fixed-proxy"),
    fallback: z.literal("none"),
    transportScope: z.literal("private-only"),
  }).strict(),
}).strict();

const externalLocalSocks5BridgeSchema = z.object({
  type: z.literal("external-local-socks5"),
  endpointDiscovery: externalSocksEndpointDiscoverySchema,
  credentials: socksCredentialsSchema.optional(),
}).strict();

function normalizeLegacyManagedMieruCarrierSource(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const bridge = input as Record<string, unknown>;
  if (!bridge.carrier || typeof bridge.carrier !== "object" || Array.isArray(bridge.carrier)) return input;
  const carrier = bridge.carrier as Record<string, unknown>;
  if (carrier.serverSource !== "discovered-private-side" || carrier.portSource !== "existing-mita-listener") return input;
  const { serverSource: _legacyServerSource, portSource: _legacyPortSource, ...rest } = carrier;
  return {
    ...bridge,
    carrier: { ...rest, endpointSource: "verified-client-visible-discovery" },
  };
}

const forwardxManagedMieruSidecarBridgeSchema = z.preprocess(normalizeLegacyManagedMieruCarrierSource, z.object({
  type: z.literal("forwardx-managed-mieru-sidecar"),
  listener: z.object({
    kind: z.literal("socks"),
    scope: z.literal("dedicated"),
    listen: dualLoopbackSchema,
    portPlanning: dualAutoPortPlanningSchema,
  }).strict(),
  carrier: z.object({
    protocol: z.literal("mieru"),
    transport: z.literal("TCP"),
    endpointSource: z.literal("verified-client-visible-discovery"),
    usernameSecretRef: dualSecretReferenceSchema,
    passwordSecretRef: dualSecretReferenceSchema,
  }).strict(),
  runtime: z.object({
    owner: z.literal("forwardx"),
    mode: z.literal("foreground-child"),
    configScope: z.literal("per-run-json"),
    globalConfigWrite: z.literal(false),
    clashMiDependency: z.literal(false),
  }).strict(),
}).strict());

const privateCarrierBridgeSchema = z.union([
  forwardxManagedMieruSidecarBridgeSchema,
  mihomoDedicatedListenerBridgeSchema,
  externalLocalSocks5BridgeSchema,
]);

const openClashIngressAdapterSchema = z.object({
  type: z.literal("local-socks-sidecar"),
  tag: z.string().trim().min(1).max(128),
  listen: dualLoopbackSchema,
  portPlanning: dualAutoPortPlanningSchema,
}).strict();

function evidenceMatchesBoundClient(
  clientTarget: z.output<typeof dualClientTargetSchema>,
  evidence: z.output<typeof dualClientSnapshotEvidenceSchema>,
) {
  return clientTarget.status === "bound" && dualClientTargetRefsEqual(clientTarget.ref, evidence.clientTargetRef);
}

export const dualMultipathDraftSchema = z.object({
  version: z.literal(DUAL_MULTIPATH_CONTROL_PLANE_VERSION).default(DUAL_MULTIPATH_CONTROL_PLANE_VERSION),
  state: z.literal("draft").default("draft"),
  name: z.string().trim().min(1, "请填写 Dual 配置名称").max(80),
  line: dualMultipathLineSchema,
  legs: z.tuple([dualPrivateLegSchema, dualDirectLegSchema]),
  serverTargetDiscovery: dualServerTargetDiscoverySnapshotSchema,
  clientTarget: dualClientTargetSchema,
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
  const ingressPlanning = draft.openClashIngressAdapter.portPlanning;
  const bridge = draft.privateCarrierBridge;
  const evidenceChecks: Array<{ path: Array<string | number>; evidence: z.output<typeof dualClientSnapshotEvidenceSchema> }> = [];
  if (ingressPlanning.status === "planned-read-only") {
    evidenceChecks.push({ path: ["openClashIngressAdapter", "portPlanning", "evidence"], evidence: ingressPlanning.evidence });
  }
  if (bridge.type === "mihomo-dedicated-listener" || bridge.type === "forwardx-managed-mieru-sidecar") {
    const privatePlanning = bridge.listener.portPlanning;
    if (privatePlanning.port !== null && ingressPlanning.port !== null && privatePlanning.port === ingressPlanning.port) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["privateCarrierBridge", "listener", "portPlanning"], message: "private listener 与 Dual ingress 不能使用同一端口" });
    }
    if (privatePlanning.status === "planned-read-only") {
      evidenceChecks.push({ path: ["privateCarrierBridge", "listener", "portPlanning", "evidence"], evidence: privatePlanning.evidence });
    }
    if (bridge.type === "mihomo-dedicated-listener" && bridge.target.discovery.status === "verified-read-only") {
      evidenceChecks.push({ path: ["privateCarrierBridge", "target", "discovery", "evidence"], evidence: bridge.target.discovery.evidence });
      if (bridge.target.discovery.proxyRef === draft.openClashIngressAdapter.tag) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["privateCarrierBridge", "target", "discovery", "proxyRef"], message: "private bridge 不允许递归回 ForwardX Dual ingress" });
      }
    }
  } else if (bridge.endpointDiscovery.status === "verified-read-only") {
    evidenceChecks.push({ path: ["privateCarrierBridge", "endpointDiscovery", "evidence"], evidence: bridge.endpointDiscovery.evidence });
    if (ingressPlanning.port !== null && bridge.endpointDiscovery.endpoint.port === ingressPlanning.port) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["privateCarrierBridge", "endpointDiscovery"], message: "private listener 与 Dual ingress 不能使用同一端口" });
    }
  }
  for (const check of evidenceChecks) {
    if (!evidenceMatchesBoundClient(draft.clientTarget, check.evidence)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: check.path, message: "client-side evidence 必须绑定当前 Dual client target" });
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

export type DualMultipathDraftV3 = z.output<typeof dualMultipathDraftV3Schema>;
export type DualMultipathDraftV3Input = z.input<typeof dualMultipathDraftV3Schema>;
export type DualMultipathDraftV4 = z.output<typeof dualMultipathDraftV4Schema>;
export type DualMultipathDraftV4Input = z.input<typeof dualMultipathDraftV4Schema>;
export type DualMultipathDraftV5 = z.output<typeof dualMultipathDraftSchema>;
export type DualMultipathDraftV5Input = z.input<typeof dualMultipathDraftSchema>;
export type DualAutoPortPlanning = z.output<typeof dualAutoPortPlanningSchema>;
export type DualClientTarget = z.output<typeof dualClientTargetSchema>;
export type DualClientSnapshotEvidence = z.output<typeof dualClientSnapshotEvidenceSchema>;
export type DualPrivateCarrierClientEndpointDiscovery = z.output<typeof dualPrivateCarrierClientEndpointDiscoverySchema>;
export type DualServerTargetDiscoverySnapshot = z.output<typeof dualServerTargetDiscoverySnapshotSchema>;
export type DualTargetDiscoverySnapshot = z.output<typeof dualTargetDiscoverySnapshotSchema>;
export type DualMultipathInfrastructureState = Pick<
  DualMultipathDraftV5,
  "line" | "legs" | "serverTargetDiscovery" | "clientTarget" | "openClashIngressAdapter" | "privateCarrierBridge" | "directCarrier" | "serverRuntime"
>;
export type DualMihomoDedicatedListenerBridge = Extract<
  DualMultipathDraftV5["privateCarrierBridge"],
  { type: "mihomo-dedicated-listener" }
>;
export type DualForwardxManagedMieruSidecarBridge = Extract<
  DualMultipathDraftV5["privateCarrierBridge"],
  { type: "forwardx-managed-mieru-sidecar" }
>;
export type DefaultDualMultipathInfrastructureState = Omit<DualMultipathInfrastructureState, "privateCarrierBridge"> & {
  privateCarrierBridge: DualForwardxManagedMieruSidecarBridge;
};

export const NO_BRAND_DUAL_SERVER_DISCOVERY_SNAPSHOT = {
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
    binaryPath: "/usr/local/lib/nobrand-oneclick/bin/mita",
    unitName: "nobrand-mieru@ud17b1f3bca519c5f.service",
    serviceStatus: "active",
    listener: { network: "tcp", listen: "*", port: 11464 },
    lifecycle: "preserve",
  },
  installedBinaries: { singBox: false, hysteria: false, standaloneMieru: false },
} as const satisfies DualServerTargetDiscoverySnapshot;

// Compatibility alias for code that still imports the pre-v5 constant name.
export const NO_BRAND_DUAL_DISCOVERY_SNAPSHOT = NO_BRAND_DUAL_SERVER_DISCOVERY_SNAPSHOT;

export function createUnresolvedDualServerDiscoverySnapshot(targetId = "unselected-server-target"): DualServerTargetDiscoverySnapshot {
  return { status: "unresolved", targetId };
}

export const createUnresolvedDualDiscoverySnapshot = createUnresolvedDualServerDiscoverySnapshot;

export function createDefaultDualMultipathInfrastructure(
  serverTargetDiscovery: DualServerTargetDiscoverySnapshot = createUnresolvedDualServerDiscoverySnapshot(),
): DefaultDualMultipathInfrastructureState {
  const directServer = serverTargetDiscovery.status === "verified-read-only"
    ? serverTargetDiscovery.publicSide.sourceAddress
    : "<unresolved:dual-public-address>";
  return {
    line: {
      id: 1,
      server: "127.0.0.1",
      serverPort: 39000,
      listen: "127.0.0.1",
      preferredLegIndex: 0,
      udpLegIndex: 0,
      tcpFastOpen: false,
    },
    legs: [
      { role: "private", legIndex: 0, outboundTag: "forwardx-private-mieru", supportsUdp: true },
      { role: "direct", legIndex: 1, outboundTag: "forwardx-direct-hy2", supportsUdp: true },
    ],
    serverTargetDiscovery,
    clientTarget: { status: "unresolved" },
    openClashIngressAdapter: {
      type: "local-socks-sidecar",
      tag: "forwardx-dual-ingress-1",
      listen: "127.0.0.1",
      portPlanning: { status: "unresolved", strategy: "auto", port: null },
    },
    privateCarrierBridge: {
      type: "forwardx-managed-mieru-sidecar",
      listener: {
        kind: "socks",
        scope: "dedicated",
        listen: "127.0.0.1",
        portPlanning: { status: "unresolved", strategy: "auto", port: null },
      },
      carrier: {
        protocol: "mieru",
        transport: "TCP",
        endpointSource: "verified-client-visible-discovery",
        usernameSecretRef: "dual.mieru.username",
        passwordSecretRef: "dual.mieru.password",
      },
      runtime: {
        owner: "forwardx",
        mode: "foreground-child",
        configScope: "per-run-json",
        globalConfigWrite: false,
        clashMiDependency: false,
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
