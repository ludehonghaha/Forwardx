import { z } from "zod";
import {
  MULTIPATH_POC_UPSTREAM,
  buildMultipathPocInbound,
  buildMultipathPocOutbound,
  type MultipathPocLeg,
  type MultipathPocLine,
} from "./multipathPocPlan";

export const LEGACY_DUAL_MULTIPATH_DRAFT_SETTING_KEY = "dualMultipathDraftV1";
export const LEGACY_DUAL_MULTIPATH_V2_DRAFT_SETTING_KEY = "dualMultipathDraftV2";
export const DUAL_MULTIPATH_DRAFT_SETTING_KEY = "dualMultipathDraftV3";
export const DUAL_MULTIPATH_CONTROL_PLANE_VERSION = 3 as const;

const UINT32_MAX = 0xffffffff;
const MAX_REORDER_BYTES = 512 * 1024 * 1024;
const MAX_QUEUE_BYTES = 64 * 1024 * 1024;
const UNRESOLVED_MIHOMO_PROXY = "<unresolved:pure-mieru-proxy-ref>";
const UNRESOLVED_EXTERNAL_SOCKS_HOST = "<unresolved:external-local-socks5-host>";
const UNRESOLVED_EXTERNAL_SOCKS_PORT = "<unresolved:external-local-socks5-port>";
const UNRESOLVED_HY2_PORT = "<unresolved:hysteria2-port>";
const UNRESOLVED_HY2_TLS_NAME = "<unresolved:hysteria2-tls-server-name>";

const durationSchema = z.string().trim().regex(/^\d+(?:\.\d+)?(?:ms|s|m|h)$/, "时长格式必须类似 500ms、1s、2m");
const secretReferenceSchema = z.string()
  .trim()
  .min(1, "请填写 secret reference")
  .max(128)
  .regex(/^dual\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/i, "secret reference 必须使用 dual.* 命名，不能填写 secret value");
const loopbackSchema = z.literal("127.0.0.1", {
  errorMap: () => ({ message: "当前离线阶段只允许 127.0.0.1 回环监听，禁止公网 listener" }),
});
const portSchema = z.number().int().min(1).max(65535);

const lineSchema = z.object({
  id: z.number().int().positive(),
  server: z.string().trim().min(1, "请填写 multipath 服务端地址").max(255),
  serverPort: portSchema,
  listen: loopbackSchema.optional(),
  preferredLegIndex: z.literal(0).optional(),
  udpLegIndex: z.union([z.literal(0), z.literal(1)]).optional(),
  tcpFastOpen: z.boolean().optional(),
  activationThresholdMbps: z.number().int().min(1).max(UINT32_MAX).optional(),
  activationAfterBytes: z.number().int().safe().positive().optional(),
  activationWindow: durationSchema.optional(),
  chunkSize: z.number().int().min(1024).max(1024 * 1024).optional(),
  queueFrames: z.number().int().min(8).max(4096).optional(),
  maxReorderFrames: z.number().int().min(1).max(UINT32_MAX).optional(),
  maxReorderBytes: z.number().int().safe().positive().max(MAX_REORDER_BYTES).optional(),
  leg1ReplayBytes: z.number().int().safe().positive().max(MAX_REORDER_BYTES).optional(),
  leg1ReplayTimeout: durationSchema.optional(),
  handshakeTimeout: durationSchema.optional(),
}).strict().superRefine((line, ctx) => {
  const chunkSize = line.chunkSize ?? 64 * 1024;
  const queueFrames = line.queueFrames ?? 256;
  if (chunkSize * queueFrames > MAX_QUEUE_BYTES) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["queueFrames"], message: "chunkSize × queueFrames 不能超过 64 MiB" });
  }
});

const privateLegSchema = z.object({
  role: z.literal("private"),
  legIndex: z.literal(0),
  outboundTag: z.string().trim().min(1).max(128),
  expectedBandwidthMbps: z.number().int().min(1).max(UINT32_MAX).optional(),
  supportsUdp: z.boolean().default(true),
}).strict();

const directLegSchema = z.object({
  role: z.literal("direct"),
  legIndex: z.literal(1),
  outboundTag: z.string().trim().min(1).max(128),
  expectedBandwidthMbps: z.number().int().min(1).max(UINT32_MAX).optional(),
  supportsUdp: z.boolean().default(true),
}).strict();

const socksCredentialsSchema = z.object({
  usernameSecretRef: secretReferenceSchema,
  passwordSecretRef: secretReferenceSchema,
}).strict();

const mihomoDedicatedListenerBridgeSchema = z.object({
  type: z.literal("mihomo-dedicated-listener"),
  status: z.enum(["unresolved", "resolved"]),
  listener: z.object({
    kind: z.literal("socks"),
    scope: z.literal("dedicated"),
    listen: loopbackSchema,
    listenPort: portSchema,
  }).strict(),
  target: z.object({
    selection: z.literal("single-proxy"),
    protocol: z.literal("mieru"),
    proxyRef: z.string().trim().min(1).max(255).optional(),
    routing: z.literal("fixed-proxy"),
    fallback: z.literal("none"),
    transportScope: z.literal("private-only"),
  }).strict(),
}).strict().superRefine((bridge, ctx) => {
  if (bridge.status === "resolved" && !bridge.target.proxyRef) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["target", "proxyRef"], message: "已解析的 Mihomo bridge 必须固定到单一纯 Mieru proxy" });
  }
});

const externalLocalSocks5BridgeSchema = z.object({
  type: z.literal("external-local-socks5"),
  status: z.enum(["unresolved", "resolved"]),
  endpoint: z.object({
    listenerKind: z.literal("dedicated-socks"),
    host: loopbackSchema,
    port: portSchema,
  }).strict().optional(),
  credentials: socksCredentialsSchema.optional(),
}).strict().superRefine((bridge, ctx) => {
  if (bridge.status === "resolved" && !bridge.endpoint) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endpoint"], message: "已解析的 external SOCKS5 bridge 必须包含真实发现的 endpoint" });
  }
  if (bridge.status === "unresolved" && bridge.endpoint) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["endpoint"], message: "未解析的 external SOCKS5 bridge 不得伪造 endpoint" });
  }
});

const privateCarrierBridgeSchema = z.union([
  mihomoDedicatedListenerBridgeSchema,
  externalLocalSocks5BridgeSchema,
]);

const directCarrierSchema = z.object({
  type: z.literal("hysteria2"),
  status: z.enum(["unresolved", "resolved"]),
  server: z.string().trim().min(1).max(255),
  serverPort: portSchema.nullable(),
  tls: z.object({ serverName: z.string().trim().min(1).max(255).nullable() }).strict(),
  authSecretRef: secretReferenceSchema,
}).strict().superRefine((carrier, ctx) => {
  if (carrier.status === "resolved" && (carrier.serverPort === null || carrier.tls.serverName === null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "已解析的 Hysteria2 carrier 必须包含端口和 TLS server name" });
  }
});

const openClashIngressAdapterSchema = z.object({
  type: z.literal("local-socks-sidecar"),
  status: z.literal("planned"),
  tag: z.string().trim().min(1).max(128),
  listen: loopbackSchema,
  listenPort: portSchema,
}).strict();

const serverRuntimeSchema = z.object({
  topologyStatus: z.literal("verified-read-only"),
  publicSide: z.object({
    interface: z.literal("eth0"),
    sourceAddress: z.literal("87.86.22.221"),
    gateway: z.literal("87.86.22.1"),
  }).strict(),
  privateSide: z.object({
    interface: z.literal("eth1"),
    sourceAddress: z.literal("172.16.4.114"),
    existingCarrier: z.literal("mita"),
    existingListenerPort: z.literal(11464),
    lifecycle: z.literal("preserve"),
  }).strict(),
  directCarrierRuntime: z.object({
    status: z.literal("unresolved"),
    engine: z.literal("pinned-singbox-multipath"),
    nativeHysteria2: z.literal("requires-with_quic-build-tag"),
    separateHysteriaBinaryRequired: z.literal(false),
    bindInterface: z.literal("eth0"),
    sourceAddress: z.literal("87.86.22.221"),
    tlsCertificateSecretRef: secretReferenceSchema,
    tlsPrivateKeySecretRef: secretReferenceSchema,
  }).strict(),
}).strict();

const legacyLineSchema = z.preprocess((input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const { listen: _ignoredLegacyListen, ...rest } = input as Record<string, unknown>;
  return rest;
}, lineSchema);

const legacyDualMultipathDraftSchema = z.object({
  version: z.literal(1).default(1),
  state: z.literal("draft").default("draft"),
  name: z.string().trim().min(1).max(80),
  line: legacyLineSchema,
  legs: z.tuple([privateLegSchema, directLegSchema]),
}).strict();

const legacyV2DraftSchema = z.object({
  version: z.literal(2),
  state: z.literal("draft"),
  name: z.string().trim().min(1).max(80),
  line: lineSchema,
  legs: z.tuple([privateLegSchema, directLegSchema]),
  carriers: z.object({
    private: z.object({
      type: z.literal("local-socks5"), host: loopbackSchema, port: portSchema,
      usernameSecretRef: secretReferenceSchema.optional(), passwordSecretRef: secretReferenceSchema.optional(),
    }).strict(),
    direct: z.object({
      type: z.literal("hysteria2"), server: z.string().trim().min(1), serverPort: portSchema,
      tls: z.object({ serverName: z.string().trim().min(1) }).strict(), authSecretRef: secretReferenceSchema,
    }).strict(),
  }).strict(),
  clientSidecar: z.object({ type: z.literal("local-socks-sidecar"), listen: loopbackSchema, listenPort: portSchema }).strict(),
}).strict();

export const dualMultipathDraftSchema = z.object({
  version: z.literal(DUAL_MULTIPATH_CONTROL_PLANE_VERSION).default(DUAL_MULTIPATH_CONTROL_PLANE_VERSION),
  state: z.literal("draft").default("draft"),
  name: z.string().trim().min(1, "请填写 Dual 配置名称").max(80),
  line: lineSchema,
  legs: z.tuple([privateLegSchema, directLegSchema]),
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
  const bridge = draft.privateCarrierBridge;
  const privatePort = bridge.type === "mihomo-dedicated-listener" ? bridge.listener.listenPort : bridge.endpoint?.port;
  if (privatePort !== undefined && privatePort === draft.openClashIngressAdapter.listenPort) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["privateCarrierBridge"], message: "private listener 与 Dual ingress 不能使用同一端口" });
  }
  if (bridge.type === "mihomo-dedicated-listener" && bridge.target.proxyRef === draft.openClashIngressAdapter.tag) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["privateCarrierBridge", "target", "proxyRef"], message: "private bridge 不允许递归回 ForwardX Dual ingress" });
  }
});

export type DualMultipathDraft = z.output<typeof dualMultipathDraftSchema>;
export type DualMultipathDraftInput = z.input<typeof dualMultipathDraftSchema>;
export type DualMultipathSettingsStore = {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null): Promise<void>;
};

export function defaultDualMultipathInfrastructure() {
  return {
    openClashIngressAdapter: {
      type: "local-socks-sidecar" as const, status: "planned" as const, tag: "forwardx-dual-ingress-1",
      listen: "127.0.0.1" as const, listenPort: 20808,
    },
    privateCarrierBridge: {
      type: "mihomo-dedicated-listener" as const,
      status: "unresolved" as const,
      listener: { kind: "socks" as const, scope: "dedicated" as const, listen: "127.0.0.1" as const, listenPort: 20809 },
      target: {
        selection: "single-proxy" as const, protocol: "mieru" as const, routing: "fixed-proxy" as const,
        fallback: "none" as const, transportScope: "private-only" as const,
      },
    },
    directCarrier: {
      type: "hysteria2" as const, status: "unresolved" as const, server: "87.86.22.221",
      serverPort: null, tls: { serverName: null }, authSecretRef: "dual.hy2.auth",
    },
    serverRuntime: {
      topologyStatus: "verified-read-only" as const,
      publicSide: { interface: "eth0" as const, sourceAddress: "87.86.22.221" as const, gateway: "87.86.22.1" as const },
      privateSide: {
        interface: "eth1" as const, sourceAddress: "172.16.4.114" as const, existingCarrier: "mita" as const,
        existingListenerPort: 11464 as const, lifecycle: "preserve" as const,
      },
      directCarrierRuntime: {
        status: "unresolved" as const, engine: "pinned-singbox-multipath" as const,
        nativeHysteria2: "requires-with_quic-build-tag" as const, separateHysteriaBinaryRequired: false as const,
        bindInterface: "eth0" as const, sourceAddress: "87.86.22.221" as const,
        tlsCertificateSecretRef: "dual.hy2.tls.certificate", tlsPrivateKeySecretRef: "dual.hy2.tls.private-key",
      },
    },
  };
}

function validationMessage(error: z.ZodError) {
  return error.issues.map((issue) => `${issue.path.length ? issue.path.join(".") : "draft"}: ${issue.message}`).join("; ");
}

export function parseDualMultipathDraft(input: unknown): DualMultipathDraft {
  const parsed = dualMultipathDraftSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Dual multipath 配置无效：${validationMessage(parsed.error)}`);
  return parsed.data;
}

function compilerLegs(draft: DualMultipathDraft): MultipathPocLeg[] {
  return draft.legs.map(({ legIndex, outboundTag, expectedBandwidthMbps, supportsUdp }) => ({ legIndex, outboundTag, expectedBandwidthMbps, supportsUdp }));
}

function redactedSecretReference(reference: string) {
  return `<secret:${reference}>`;
}

function privateBridgeEndpoint(bridge: DualMultipathDraft["privateCarrierBridge"]) {
  if (bridge.type === "mihomo-dedicated-listener") {
    return { server: bridge.listener.listen, server_port: bridge.listener.listenPort };
  }
  if (bridge.endpoint) return { server: bridge.endpoint.host, server_port: bridge.endpoint.port };
  return { server: UNRESOLVED_EXTERNAL_SOCKS_HOST, server_port: UNRESOLVED_EXTERNAL_SOCKS_PORT };
}

export function compileDualMultipathPreview(input: unknown) {
  const draft = parseDualMultipathDraft(input);
  const line: MultipathPocLine = draft.line;
  const legs = compilerLegs(draft);
  const outbound = buildMultipathPocOutbound(line, legs);
  const inbound = buildMultipathPocInbound(line, legs);
  if (!outbound || !inbound) throw new Error("Dual multipath 配置未通过 pinned upstream 编译器校验");

  const privateBridge = draft.privateCarrierBridge;
  const privateCredentials = privateBridge.type === "external-local-socks5" ? privateBridge.credentials : undefined;
  const directCarrier = draft.directCarrier;
  const privateChildOutbound = {
    type: "socks" as const, tag: draft.legs[0].outboundTag, ...privateBridgeEndpoint(privateBridge), version: "5" as const,
    ...(privateCredentials ? {
      username: redactedSecretReference(privateCredentials.usernameSecretRef),
      password: redactedSecretReference(privateCredentials.passwordSecretRef),
    } : {}),
  };
  const directChildOutbound = {
    type: "hysteria2" as const, tag: draft.legs[1].outboundTag, server: directCarrier.server,
    server_port: directCarrier.serverPort ?? UNRESOLVED_HY2_PORT,
    password: redactedSecretReference(directCarrier.authSecretRef),
    tls: { enabled: true as const, server_name: directCarrier.tls.serverName ?? UNRESOLVED_HY2_TLS_NAME },
  };
  const clientConfig = {
    inbounds: [{
      type: "socks" as const, tag: draft.openClashIngressAdapter.tag,
      listen: draft.openClashIngressAdapter.listen, listen_port: draft.openClashIngressAdapter.listenPort,
    }],
    outbounds: [privateChildOutbound, directChildOutbound, outbound],
    route: { final: outbound.tag },
  };
  const mihomoPrivateListener = privateBridge.type === "mihomo-dedicated-listener" ? {
    status: privateBridge.status,
    listeners: [{
      name: `forwardx-private-mieru-${draft.line.id}`, type: privateBridge.listener.kind,
      listen: privateBridge.listener.listen, port: privateBridge.listener.listenPort,
      proxy: privateBridge.target.proxyRef ?? UNRESOLVED_MIHOMO_PROXY,
    }],
    isolation: {
      normalRulesBypassed: true as const, genericMixedListenerAllowed: false as const,
      recursionAllowed: false as const, directOrPublicFallbackAllowed: false as const,
    },
  } : null;
  const serverPreview = {
    multipathConfig: { inbounds: [inbound] },
    verifiedTopology: {
      publicSide: draft.serverRuntime.publicSide,
      privateSide: draft.serverRuntime.privateSide,
      defaultRoute: { via: draft.serverRuntime.publicSide.gateway, dev: draft.serverRuntime.publicSide.interface },
    },
    authenticatedCarrierRuntime: {
      status: "not-compiled" as const,
      private: {
        type: "existing-mieru-mita" as const, lifecycle: "external-preserve" as const, mutationAllowed: false as const,
        multipathTarget: { host: inbound.listen, port: inbound.listen_port },
      },
      direct: {
        type: "hysteria2" as const, status: draft.serverRuntime.directCarrierRuntime.status,
        engine: draft.serverRuntime.directCarrierRuntime.engine,
        nativeCapability: draft.serverRuntime.directCarrierRuntime.nativeHysteria2,
        separateHysteriaBinaryRequired: draft.serverRuntime.directCarrierRuntime.separateHysteriaBinaryRequired,
        mutationAllowed: false as const,
        bind: {
          interface: draft.serverRuntime.directCarrierRuntime.bindInterface,
          source_address: draft.serverRuntime.directCarrierRuntime.sourceAddress,
        },
        listen_port: directCarrier.serverPort ?? UNRESOLVED_HY2_PORT,
        users: [{ password: redactedSecretReference(directCarrier.authSecretRef) }],
        tls: {
          enabled: true as const, server_name: directCarrier.tls.serverName ?? UNRESOLVED_HY2_TLS_NAME,
          certificate: redactedSecretReference(draft.serverRuntime.directCarrierRuntime.tlsCertificateSecretRef),
          key: redactedSecretReference(draft.serverRuntime.directCarrierRuntime.tlsPrivateKeySecretRef),
        },
        multipathTarget: { host: inbound.listen, port: inbound.listen_port },
      },
    },
  };
  return {
    version: DUAL_MULTIPATH_CONTROL_PLANE_VERSION,
    state: "preview-only" as const,
    name: draft.name,
    upstream: { ...MULTIPATH_POC_UPSTREAM, nativeHysteria2: true as const, requiredBuildTag: "with_quic" as const },
    topology: { private: draft.legs[0].outboundTag, direct: draft.legs[1].outboundTag, preferred: draft.legs[0].outboundTag },
    openClashIngressAdapter: draft.openClashIngressAdapter,
    privateCarrierBridge: { type: privateBridge.type, status: privateBridge.status, deployable: privateBridge.status === "resolved" },
    mihomoPrivateListener,
    clientConfig,
    serverPreview,
    secretHandling: { acceptedInput: "references-only" as const, resolved: false as const, previewValues: "redacted-placeholders" as const },
    safety: { agentPush: false, runtimeActivation: false, tunnelMutation: false },
  };
}

function upgradeLegacyDraft(legacy: z.output<typeof legacyDualMultipathDraftSchema>) {
  return parseDualMultipathDraft({
    ...legacy, version: DUAL_MULTIPATH_CONTROL_PLANE_VERSION,
    line: { ...legacy.line, listen: "127.0.0.1" }, ...defaultDualMultipathInfrastructure(),
  });
}

function upgradeV2Draft(legacy: z.output<typeof legacyV2DraftSchema>) {
  const infrastructure = defaultDualMultipathInfrastructure();
  return parseDualMultipathDraft({
    version: DUAL_MULTIPATH_CONTROL_PLANE_VERSION, state: legacy.state, name: legacy.name,
    line: { ...legacy.line, listen: "127.0.0.1" }, legs: legacy.legs, ...infrastructure,
    openClashIngressAdapter: { ...infrastructure.openClashIngressAdapter, listenPort: legacy.clientSidecar.listenPort },
    directCarrier: { ...infrastructure.directCarrier, server: legacy.carriers.direct.server, authSecretRef: legacy.carriers.direct.authSecretRef },
  });
}

function decodeStoredDraft(raw: string, version: number) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`已保存的 Dual multipath v${version} 草稿不是有效 JSON`);
  }
}

export async function loadDualMultipathDraft(store: DualMultipathSettingsStore) {
  const raw = await store.getSetting(DUAL_MULTIPATH_DRAFT_SETTING_KEY);
  if (raw) return parseDualMultipathDraft(decodeStoredDraft(raw, 3));

  const v2Raw = await store.getSetting(LEGACY_DUAL_MULTIPATH_V2_DRAFT_SETTING_KEY);
  if (v2Raw) {
    const parsed = legacyV2DraftSchema.safeParse(decodeStoredDraft(v2Raw, 2));
    if (!parsed.success) throw new Error(`Dual multipath v2 草稿无效：${validationMessage(parsed.error)}`);
    return upgradeV2Draft(parsed.data);
  }

  const legacyRaw = await store.getSetting(LEGACY_DUAL_MULTIPATH_DRAFT_SETTING_KEY);
  if (!legacyRaw) return null;
  const parsed = legacyDualMultipathDraftSchema.safeParse(decodeStoredDraft(legacyRaw, 1));
  if (!parsed.success) throw new Error(`Dual multipath v1 草稿无效：${validationMessage(parsed.error)}`);
  return upgradeLegacyDraft(parsed.data);
}

export async function saveDualMultipathDraft(store: DualMultipathSettingsStore, input: unknown) {
  const draft = parseDualMultipathDraft(input);
  await store.setSetting(DUAL_MULTIPATH_DRAFT_SETTING_KEY, JSON.stringify(draft));
  return draft;
}
