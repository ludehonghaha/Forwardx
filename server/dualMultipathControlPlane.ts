import { z } from "zod";
import {
  DUAL_MULTIPATH_CONTROL_PLANE_VERSION,
  NO_BRAND_DUAL_DISCOVERY_SNAPSHOT,
  createDefaultDualMultipathInfrastructure,
  dualDirectLegSchema,
  dualLoopbackSchema,
  dualMultipathDraftSchema,
  dualMultipathDraftV3Schema,
  dualMultipathLineSchema,
  dualPortSchema,
  dualPrivateLegSchema,
  dualSecretReferenceSchema,
  type DualMultipathDraftV3,
  type DualMultipathDraftV4,
  type DualMultipathDraftV4Input,
  type DualTargetDiscoverySnapshot,
} from "../shared/dualMultipath";
import {
  MULTIPATH_POC_UPSTREAM,
  buildMultipathPocInbound,
  buildMultipathPocOutbound,
  type MultipathPocLeg,
  type MultipathPocLine,
} from "./multipathPocPlan";

export const LEGACY_DUAL_MULTIPATH_DRAFT_SETTING_KEY = "dualMultipathDraftV1";
export const LEGACY_DUAL_MULTIPATH_V2_DRAFT_SETTING_KEY = "dualMultipathDraftV2";
export const LEGACY_DUAL_MULTIPATH_V3_DRAFT_SETTING_KEY = "dualMultipathDraftV3";
export const DUAL_MULTIPATH_DRAFT_SETTING_KEY = "dualMultipathDraftV4";

export {
  DUAL_MULTIPATH_CONTROL_PLANE_VERSION,
  NO_BRAND_DUAL_DISCOVERY_SNAPSHOT,
  createDefaultDualMultipathInfrastructure,
  dualMultipathDraftSchema,
};
export type DualMultipathDraft = DualMultipathDraftV4;
export type DualMultipathDraftInput = DualMultipathDraftV4Input;
export type { DualMultipathInfrastructureState, DualTargetDiscoverySnapshot } from "../shared/dualMultipath";

const UNRESOLVED_MIHOMO_PROXY = "<unresolved:pure-mieru-proxy-ref>";
const UNRESOLVED_AUTO_PRIVATE_PORT = "<unresolved:auto-private-bridge-port>";
const UNRESOLVED_AUTO_INGRESS_PORT = "<unresolved:auto-dual-ingress-port>";
const UNRESOLVED_EXTERNAL_SOCKS_HOST = "<unresolved:external-local-socks5-host>";
const UNRESOLVED_EXTERNAL_SOCKS_PORT = "<unresolved:external-local-socks5-port>";
const UNRESOLVED_HY2_PORT = "<unresolved:hysteria2-port>";
const UNRESOLVED_HY2_TLS_NAME = "<unresolved:hysteria2-tls-server-name>";
const UNRESOLVED_INTERFACE = "<unresolved:public-interface>";
const UNRESOLVED_SOURCE_ADDRESS = "<unresolved:public-source-address>";

const legacyLineSchema = z.preprocess((input) => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const { listen: _ignoredLegacyListen, ...rest } = input as Record<string, unknown>;
  return rest;
}, dualMultipathLineSchema);

const legacyDualMultipathDraftSchema = z.object({
  version: z.literal(1).default(1),
  state: z.literal("draft").default("draft"),
  name: z.string().trim().min(1).max(80),
  line: legacyLineSchema,
  legs: z.tuple([dualPrivateLegSchema, dualDirectLegSchema]),
}).strict();

const legacyV2DraftSchema = z.object({
  version: z.literal(2),
  state: z.literal("draft"),
  name: z.string().trim().min(1).max(80),
  line: dualMultipathLineSchema,
  legs: z.tuple([dualPrivateLegSchema, dualDirectLegSchema]),
  carriers: z.object({
    private: z.object({
      type: z.literal("local-socks5"),
      host: dualLoopbackSchema,
      port: dualPortSchema,
      usernameSecretRef: dualSecretReferenceSchema.optional(),
      passwordSecretRef: dualSecretReferenceSchema.optional(),
    }).strict(),
    direct: z.object({
      type: z.literal("hysteria2"),
      server: z.string().trim().min(1),
      serverPort: dualPortSchema,
      tls: z.object({ serverName: z.string().trim().min(1) }).strict(),
      authSecretRef: dualSecretReferenceSchema,
    }).strict(),
  }).strict(),
  clientSidecar: z.object({ type: z.literal("local-socks-sidecar"), listen: dualLoopbackSchema, listenPort: dualPortSchema }).strict(),
}).strict();

// Compatibility for v3 drafts saved before discovery and port planning were
// split from the product schema. Host values are parsed as data, not literals.
const legacyPinnedV3DraftSchema = z.object({
  version: z.literal(3),
  state: z.literal("draft"),
  name: z.string().trim().min(1).max(80),
  line: dualMultipathLineSchema,
  legs: z.tuple([dualPrivateLegSchema, dualDirectLegSchema]),
  openClashIngressAdapter: z.object({
    type: z.literal("local-socks-sidecar"), status: z.literal("planned"), tag: z.string(), listen: dualLoopbackSchema, listenPort: dualPortSchema,
  }).strict(),
  privateCarrierBridge: z.union([
    z.object({
      type: z.literal("mihomo-dedicated-listener"), status: z.enum(["unresolved", "resolved"]),
      listener: z.object({ kind: z.literal("socks"), scope: z.literal("dedicated"), listen: dualLoopbackSchema, listenPort: dualPortSchema }).strict(),
      target: z.object({
        selection: z.literal("single-proxy"), protocol: z.literal("mieru"), proxyRef: z.string().optional(),
        routing: z.literal("fixed-proxy"), fallback: z.literal("none"), transportScope: z.literal("private-only"),
      }).strict(),
    }).strict(),
    z.object({
      type: z.literal("external-local-socks5"), status: z.enum(["unresolved", "resolved"]),
      endpoint: z.object({ listenerKind: z.literal("dedicated-socks"), host: dualLoopbackSchema, port: dualPortSchema }).strict().optional(),
      credentials: z.object({ usernameSecretRef: dualSecretReferenceSchema, passwordSecretRef: dualSecretReferenceSchema }).strict().optional(),
    }).strict(),
  ]),
  directCarrier: z.object({
    type: z.literal("hysteria2"), status: z.enum(["unresolved", "resolved"]), server: z.string(), serverPort: dualPortSchema.nullable(),
    tls: z.object({ serverName: z.string().nullable() }).strict(), authSecretRef: dualSecretReferenceSchema,
  }).strict(),
  serverRuntime: z.object({
    topologyStatus: z.literal("verified-read-only"),
    publicSide: z.object({ interface: z.string(), sourceAddress: z.string(), gateway: z.string() }).strict(),
    privateSide: z.object({
      interface: z.string(), sourceAddress: z.string(), existingCarrier: z.literal("mita"),
      existingListenerPort: dualPortSchema, lifecycle: z.literal("preserve"),
    }).strict(),
    directCarrierRuntime: z.object({
      status: z.literal("unresolved"), engine: z.literal("pinned-singbox-multipath"),
      nativeHysteria2: z.literal("requires-with_quic-build-tag"), separateHysteriaBinaryRequired: z.literal(false),
      bindInterface: z.string(), sourceAddress: z.string(),
      tlsCertificateSecretRef: dualSecretReferenceSchema, tlsPrivateKeySecretRef: dualSecretReferenceSchema,
    }).strict(),
  }).strict(),
}).strict();

export type DualMultipathSettingsStore = {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null): Promise<void>;
};

export function defaultDualMultipathInfrastructure() {
  return createDefaultDualMultipathInfrastructure(NO_BRAND_DUAL_DISCOVERY_SNAPSHOT);
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
    return { server: bridge.listener.listen, server_port: bridge.listener.portPlanning.port ?? UNRESOLVED_AUTO_PRIVATE_PORT };
  }
  if (bridge.endpointDiscovery.status === "verified-read-only") {
    return { server: bridge.endpointDiscovery.endpoint.host, server_port: bridge.endpointDiscovery.endpoint.port };
  }
  return { server: UNRESOLVED_EXTERNAL_SOCKS_HOST, server_port: UNRESOLVED_EXTERNAL_SOCKS_PORT };
}

function privateBridgeReadiness(bridge: DualMultipathDraft["privateCarrierBridge"]) {
  if (bridge.type === "mihomo-dedicated-listener") {
    const listenerPortPlanned = bridge.listener.portPlanning.status === "planned-read-only";
    const proxyDiscovered = bridge.target.discovery.status === "verified-read-only";
    return {
      listenerPortPlanning: bridge.listener.portPlanning.status,
      proxyDiscovery: bridge.target.discovery.status,
      ready: listenerPortPlanned && proxyDiscovered,
    };
  }
  const endpointDiscovered = bridge.endpointDiscovery.status === "verified-read-only";
  return {
    endpointDiscovery: bridge.endpointDiscovery.status,
    ready: endpointDiscovered,
  };
}

function topologyPreview(discovery: DualTargetDiscoverySnapshot) {
  if (discovery.status === "unresolved") return { status: discovery.status, targetId: discovery.targetId };
  return {
    status: discovery.status,
    targetId: discovery.targetId,
    publicSide: discovery.publicSide,
    privateSide: discovery.privateSide,
    defaultRoute: discovery.defaultRoute,
    existingPrivateCarrier: discovery.existingPrivateCarrier,
    installedBinaries: discovery.installedBinaries,
  };
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
  const bridgeReadiness = privateBridgeReadiness(privateBridge);
  const directCarrier = draft.directCarrier;
  const discovery = draft.targetDiscovery;
  const publicInterface = discovery.status === "verified-read-only" ? discovery.publicSide.interfaceName : UNRESOLVED_INTERFACE;
  const publicSourceAddress = discovery.status === "verified-read-only" ? discovery.publicSide.sourceAddress : UNRESOLVED_SOURCE_ADDRESS;
  const privateChildOutbound = {
    type: "socks" as const,
    tag: draft.legs[0].outboundTag,
    ...privateBridgeEndpoint(privateBridge),
    version: "5" as const,
    ...(privateCredentials ? {
      username: redactedSecretReference(privateCredentials.usernameSecretRef),
      password: redactedSecretReference(privateCredentials.passwordSecretRef),
    } : {}),
  };
  const directChildOutbound = {
    type: "hysteria2" as const,
    tag: draft.legs[1].outboundTag,
    server: directCarrier.server,
    server_port: directCarrier.serverPort ?? UNRESOLVED_HY2_PORT,
    password: redactedSecretReference(directCarrier.authSecretRef),
    tls: { enabled: true as const, server_name: directCarrier.tls.serverName ?? UNRESOLVED_HY2_TLS_NAME },
  };
  const clientConfig = {
    inbounds: [{
      type: "socks" as const,
      tag: draft.openClashIngressAdapter.tag,
      listen: draft.openClashIngressAdapter.listen,
      listen_port: draft.openClashIngressAdapter.portPlanning.port ?? UNRESOLVED_AUTO_INGRESS_PORT,
    }],
    outbounds: [privateChildOutbound, directChildOutbound, outbound],
    route: { final: outbound.tag },
  };
  const mihomoPrivateListener = privateBridge.type === "mihomo-dedicated-listener" ? {
    status: bridgeReadiness.ready ? "ready" as const : "blocked" as const,
    listeners: [{
      name: `forwardx-private-mieru-${draft.line.id}`,
      type: privateBridge.listener.kind,
      listen: privateBridge.listener.listen,
      port: privateBridge.listener.portPlanning.port ?? UNRESOLVED_AUTO_PRIVATE_PORT,
      proxy: privateBridge.target.discovery.proxyRef ?? UNRESOLVED_MIHOMO_PROXY,
    }],
    isolation: {
      normalRulesBypassed: true as const,
      genericMixedListenerAllowed: false as const,
      recursionAllowed: false as const,
      directOrPublicFallbackAllowed: false as const,
    },
  } : null;
  const serverPreview = {
    multipathConfig: { inbounds: [inbound] },
    verifiedTopology: topologyPreview(discovery),
    authenticatedCarrierRuntime: {
      status: "not-compiled" as const,
      private: {
        type: "existing-mieru-mita" as const,
        lifecycle: "external-preserve" as const,
        mutationAllowed: false as const,
        multipathTarget: { host: inbound.listen, port: inbound.listen_port },
      },
      direct: {
        type: "hysteria2" as const,
        status: draft.serverRuntime.directCarrierRuntime.status,
        engine: draft.serverRuntime.directCarrierRuntime.engine,
        nativeCapability: draft.serverRuntime.directCarrierRuntime.nativeHysteria2,
        separateHysteriaBinaryRequired: draft.serverRuntime.directCarrierRuntime.separateHysteriaBinaryRequired,
        mutationAllowed: false as const,
        bind: { interface: publicInterface, source_address: publicSourceAddress },
        listen_port: directCarrier.serverPort ?? UNRESOLVED_HY2_PORT,
        users: [{ password: redactedSecretReference(directCarrier.authSecretRef) }],
        tls: {
          enabled: true as const,
          server_name: directCarrier.tls.serverName ?? UNRESOLVED_HY2_TLS_NAME,
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
    targetDiscovery: { status: discovery.status, targetId: discovery.targetId },
    clientPortPlanning: {
      openClashIngress: draft.openClashIngressAdapter.portPlanning,
      mihomoPrivateListener: privateBridge.type === "mihomo-dedicated-listener"
        ? privateBridge.listener.portPlanning
        : null,
    },
    privateProxyDiscovery: privateBridge.type === "mihomo-dedicated-listener"
      ? privateBridge.target.discovery
      : null,
    externalPrivateEndpointDiscovery: privateBridge.type === "external-local-socks5"
      ? privateBridge.endpointDiscovery
      : null,
    openClashIngressAdapter: draft.openClashIngressAdapter,
    privateCarrierBridge: {
      type: privateBridge.type,
      readiness: bridgeReadiness.ready ? "ready" as const : "blocked" as const,
      ready: bridgeReadiness.ready,
      facts: bridgeReadiness,
    },
    mihomoPrivateListener,
    clientConfig,
    serverPreview,
    secretHandling: { acceptedInput: "references-only" as const, resolved: false as const, previewValues: "redacted-placeholders" as const },
    safety: { agentPush: false, runtimeActivation: false, tunnelMutation: false },
  };
}

function upgradeLegacyDraft(legacy: z.output<typeof legacyDualMultipathDraftSchema>) {
  const infrastructure = defaultDualMultipathInfrastructure();
  return parseDualMultipathDraft({
    ...legacy,
    version: DUAL_MULTIPATH_CONTROL_PLANE_VERSION,
    ...infrastructure,
    line: { ...legacy.line, listen: "127.0.0.1" },
  });
}

function upgradeV2Draft(legacy: z.output<typeof legacyV2DraftSchema>) {
  const infrastructure = defaultDualMultipathInfrastructure();
  return parseDualMultipathDraft({
    version: DUAL_MULTIPATH_CONTROL_PLANE_VERSION,
    state: legacy.state,
    name: legacy.name,
    ...infrastructure,
    line: { ...legacy.line, listen: "127.0.0.1" },
    legs: legacy.legs,
    directCarrier: {
      ...infrastructure.directCarrier,
      server: legacy.carriers.direct.server,
      authSecretRef: legacy.carriers.direct.authSecretRef,
    },
  });
}

function upgradedMihomoProxyDiscovery(status: "unresolved" | "resolved", proxyRef?: string) {
  return status === "resolved" && proxyRef
    ? { status: "verified-read-only" as const, proxyRef }
    : { status: "unresolved" as const, proxyRef: null };
}

function upgradePortableV3Draft(legacy: DualMultipathDraftV3) {
  const infrastructure = createDefaultDualMultipathInfrastructure(legacy.targetDiscovery);
  const privateCarrierBridge = legacy.privateCarrierBridge.type === "mihomo-dedicated-listener"
    ? {
      ...infrastructure.privateCarrierBridge,
      listener: {
        ...infrastructure.privateCarrierBridge.listener,
        listen: legacy.privateCarrierBridge.listener.listen,
      },
      target: {
        ...infrastructure.privateCarrierBridge.target,
        discovery: upgradedMihomoProxyDiscovery(legacy.privateCarrierBridge.status, legacy.privateCarrierBridge.target.proxyRef),
      },
    }
    : {
      type: "external-local-socks5" as const,
      endpointDiscovery: legacy.privateCarrierBridge.status === "resolved" && legacy.privateCarrierBridge.endpoint
        ? { status: "verified-read-only" as const, endpoint: legacy.privateCarrierBridge.endpoint }
        : { status: "unresolved" as const, endpoint: null },
      credentials: legacy.privateCarrierBridge.credentials,
    };
  return parseDualMultipathDraft({
    version: DUAL_MULTIPATH_CONTROL_PLANE_VERSION,
    state: legacy.state,
    name: legacy.name,
    ...infrastructure,
    line: legacy.line,
    legs: legacy.legs,
    openClashIngressAdapter: {
      ...infrastructure.openClashIngressAdapter,
      tag: legacy.openClashIngressAdapter.tag,
      listen: legacy.openClashIngressAdapter.listen,
    },
    privateCarrierBridge,
    directCarrier: legacy.directCarrier,
    serverRuntime: legacy.serverRuntime,
  });
}

function upgradePinnedV3Draft(legacy: z.output<typeof legacyPinnedV3DraftSchema>) {
  const discovery: DualTargetDiscoverySnapshot = {
    status: "verified-read-only",
    targetId: "legacy-v3-target",
    platform: { kernel: "Linux", architecture: "x86_64" },
    publicSide: {
      interfaceName: legacy.serverRuntime.publicSide.interface,
      sourceAddress: legacy.serverRuntime.publicSide.sourceAddress,
      addresses: [legacy.serverRuntime.publicSide.sourceAddress],
      gateway: legacy.serverRuntime.publicSide.gateway,
    },
    privateSide: {
      interfaceName: legacy.serverRuntime.privateSide.interface,
      sourceAddress: legacy.serverRuntime.privateSide.sourceAddress,
      addresses: [legacy.serverRuntime.privateSide.sourceAddress],
    },
    defaultRoute: { via: legacy.serverRuntime.publicSide.gateway, dev: legacy.serverRuntime.publicSide.interface },
    existingPrivateCarrier: {
      type: "mita",
      binaryPath: "/usr/local/bin/mita",
      serviceStatus: "active",
      listener: { network: "tcp", listen: "*", port: legacy.serverRuntime.privateSide.existingListenerPort },
      lifecycle: "preserve",
    },
    installedBinaries: { singBox: false, hysteria: false, standaloneMieru: false },
  };
  const infrastructure = createDefaultDualMultipathInfrastructure(discovery);
  const privateCarrierBridge = legacy.privateCarrierBridge.type === "mihomo-dedicated-listener"
    ? {
      ...infrastructure.privateCarrierBridge,
      listener: {
        ...infrastructure.privateCarrierBridge.listener,
        listen: legacy.privateCarrierBridge.listener.listen,
      },
      target: {
        ...infrastructure.privateCarrierBridge.target,
        discovery: upgradedMihomoProxyDiscovery(legacy.privateCarrierBridge.status, legacy.privateCarrierBridge.target.proxyRef),
      },
    }
    : {
      type: "external-local-socks5" as const,
      endpointDiscovery: legacy.privateCarrierBridge.status === "resolved" && legacy.privateCarrierBridge.endpoint
        ? { status: "verified-read-only" as const, endpoint: legacy.privateCarrierBridge.endpoint }
        : { status: "unresolved" as const, endpoint: null },
      credentials: legacy.privateCarrierBridge.credentials,
    };
  return parseDualMultipathDraft({
    version: DUAL_MULTIPATH_CONTROL_PLANE_VERSION,
    state: legacy.state,
    name: legacy.name,
    ...infrastructure,
    line: legacy.line,
    legs: legacy.legs,
    openClashIngressAdapter: {
      ...infrastructure.openClashIngressAdapter,
      tag: legacy.openClashIngressAdapter.tag,
      listen: legacy.openClashIngressAdapter.listen,
    },
    privateCarrierBridge,
    directCarrier: legacy.directCarrier,
    serverRuntime: {
      ...infrastructure.serverRuntime,
      directCarrierRuntime: {
        ...infrastructure.serverRuntime.directCarrierRuntime,
        tlsCertificateSecretRef: legacy.serverRuntime.directCarrierRuntime.tlsCertificateSecretRef,
        tlsPrivateKeySecretRef: legacy.serverRuntime.directCarrierRuntime.tlsPrivateKeySecretRef,
      },
    },
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
  if (raw) {
    const decoded = decodeStoredDraft(raw, 4);
    const current = dualMultipathDraftSchema.safeParse(decoded);
    if (current.success) return current.data;
    throw new Error(`Dual multipath v4 草稿无效：${validationMessage(current.error)}`);
  }

  const v3Raw = await store.getSetting(LEGACY_DUAL_MULTIPATH_V3_DRAFT_SETTING_KEY);
  if (v3Raw) {
    const decoded = decodeStoredDraft(v3Raw, 3);
    const portable = dualMultipathDraftV3Schema.safeParse(decoded);
    if (portable.success) return upgradePortableV3Draft(portable.data);
    const pinned = legacyPinnedV3DraftSchema.safeParse(decoded);
    if (pinned.success) return upgradePinnedV3Draft(pinned.data);
    throw new Error(`Dual multipath v3 草稿无效：${validationMessage(portable.error)}`);
  }

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
