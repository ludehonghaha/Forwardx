import { z } from "zod";
import {
  MULTIPATH_POC_UPSTREAM,
  buildMultipathPocInbound,
  buildMultipathPocOutbound,
  type MultipathPocLeg,
  type MultipathPocLine,
} from "./multipathPocPlan";

export const LEGACY_DUAL_MULTIPATH_DRAFT_SETTING_KEY = "dualMultipathDraftV1";
export const DUAL_MULTIPATH_DRAFT_SETTING_KEY = "dualMultipathDraftV2";
export const DUAL_MULTIPATH_CONTROL_PLANE_VERSION = 2 as const;

const UINT32_MAX = 0xffffffff;
const MAX_REORDER_BYTES = 512 * 1024 * 1024;
const MAX_QUEUE_BYTES = 64 * 1024 * 1024;
const durationSchema = z.string().trim().regex(/^\d+(?:\.\d+)?(?:ms|s|m|h)$/, "时长格式必须类似 500ms、1s、2m");
const secretReferenceSchema = z.string()
  .trim()
  .min(1, "请填写 secret reference")
  .max(128)
  .regex(/^dual\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/i, "secret reference 必须使用 dual.* 命名，不能填写 secret value");
const loopbackSchema = z.literal("127.0.0.1", {
  errorMap: () => ({ message: "当前离线阶段只允许 127.0.0.1 回环监听，禁止公网 listener" }),
});

const lineSchema = z.object({
  id: z.number().int().positive(),
  server: z.string().trim().min(1, "请填写 multipath 服务端地址").max(255),
  serverPort: z.number().int().min(1).max(65535),
  listen: loopbackSchema.optional(),
  // Dual PoC 固定专线为首选 leg0；如果未来要开放反向偏好，应另升版本。
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
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["queueFrames"],
      message: "chunkSize × queueFrames 不能超过 64 MiB",
    });
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

const privateCarrierSchema = z.object({
  type: z.literal("local-socks5"),
  host: loopbackSchema,
  port: z.number().int().min(1).max(65535),
  usernameSecretRef: secretReferenceSchema.optional(),
  passwordSecretRef: secretReferenceSchema.optional(),
}).strict().superRefine((carrier, ctx) => {
  if ((carrier.usernameSecretRef === undefined) !== (carrier.passwordSecretRef === undefined)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [carrier.usernameSecretRef === undefined ? "usernameSecretRef" : "passwordSecretRef"],
      message: "SOCKS5 username/password secret reference 必须同时填写或同时留空",
    });
  }
});

const directCarrierSchema = z.object({
  type: z.literal("hysteria2"),
  server: z.string().trim().min(1, "请填写 Hysteria2 服务端地址").max(255),
  serverPort: z.number().int().min(1).max(65535),
  tls: z.object({
    serverName: z.string().trim().min(1, "请填写 Hysteria2 TLS server name").max(255),
  }).strict(),
  authSecretRef: secretReferenceSchema,
}).strict();

const clientSidecarSchema = z.object({
  type: z.literal("local-socks-sidecar"),
  listen: loopbackSchema,
  listenPort: z.number().int().min(1).max(65535),
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

export const dualMultipathDraftSchema = z.object({
  version: z.literal(DUAL_MULTIPATH_CONTROL_PLANE_VERSION).default(DUAL_MULTIPATH_CONTROL_PLANE_VERSION),
  state: z.literal("draft").default("draft"),
  name: z.string().trim().min(1, "请填写 Dual 配置名称").max(80),
  line: lineSchema,
  legs: z.tuple([privateLegSchema, directLegSchema]),
  carriers: z.object({
    private: privateCarrierSchema,
    direct: directCarrierSchema,
  }).strict(),
  clientSidecar: clientSidecarSchema,
}).strict().superRefine((draft, ctx) => {
  const [privateLeg, directLeg] = draft.legs;
  if (privateLeg.outboundTag === directLeg.outboundTag) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["legs", 1, "outboundTag"],
      message: "专线与直连必须引用不同的 outbound tag",
    });
  }
  const udpLegIndex = draft.line.udpLegIndex ?? 0;
  if (draft.legs[udpLegIndex].supportsUdp === false) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["line", "udpLegIndex"],
      message: "指定的 UDP 路径不支持 UDP",
    });
  }
});

export type DualMultipathDraft = z.output<typeof dualMultipathDraftSchema>;
export type DualMultipathDraftInput = z.input<typeof dualMultipathDraftSchema>;

export type DualMultipathSettingsStore = {
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string | null): Promise<void>;
};

function defaultCarrierAwareFields() {
  return {
    carriers: {
      private: {
        type: "local-socks5" as const,
        host: "127.0.0.1" as const,
        port: 1080,
      },
      direct: {
        type: "hysteria2" as const,
        server: "dual.example.invalid",
        serverPort: 443,
        tls: { serverName: "dual.example.invalid" },
        authSecretRef: "dual.hy2.auth",
      },
    },
    clientSidecar: {
      type: "local-socks-sidecar" as const,
      listen: "127.0.0.1" as const,
      listenPort: 10808,
    },
  };
}

function validationMessage(error: z.ZodError) {
  return error.issues
    .map((issue) => `${issue.path.length ? issue.path.join(".") : "draft"}: ${issue.message}`)
    .join("; ");
}

export function parseDualMultipathDraft(input: unknown): DualMultipathDraft {
  const parsed = dualMultipathDraftSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Dual multipath 配置无效：${validationMessage(parsed.error)}`);
  }
  return parsed.data;
}

function compilerLegs(draft: DualMultipathDraft): MultipathPocLeg[] {
  return draft.legs.map(({ legIndex, outboundTag, expectedBandwidthMbps, supportsUdp }) => ({
    legIndex,
    outboundTag,
    expectedBandwidthMbps,
    supportsUdp,
  }));
}

function redactedSecretReference(reference: string) {
  return `<secret:${reference}>`;
}

export function compileDualMultipathPreview(input: unknown) {
  const draft = parseDualMultipathDraft(input);
  const line: MultipathPocLine = draft.line;
  const legs = compilerLegs(draft);
  const outbound = buildMultipathPocOutbound(line, legs);
  const inbound = buildMultipathPocInbound(line, legs);
  if (!outbound || !inbound) {
    throw new Error("Dual multipath 配置未通过 pinned upstream 编译器校验");
  }
  const privateCarrier = draft.carriers.private;
  const directCarrier = draft.carriers.direct;
  const privateChildOutbound = {
    type: "socks" as const,
    tag: draft.legs[0].outboundTag,
    server: privateCarrier.host,
    server_port: privateCarrier.port,
    version: "5" as const,
    ...(privateCarrier.usernameSecretRef === undefined ? {} : {
      username: redactedSecretReference(privateCarrier.usernameSecretRef),
      password: redactedSecretReference(privateCarrier.passwordSecretRef!),
    }),
  };
  const directChildOutbound = {
    type: "hysteria2" as const,
    tag: draft.legs[1].outboundTag,
    server: directCarrier.server,
    server_port: directCarrier.serverPort,
    password: redactedSecretReference(directCarrier.authSecretRef),
    tls: {
      enabled: true as const,
      server_name: directCarrier.tls.serverName,
    },
  };
  const clientConfig = {
    inbounds: [{
      type: "socks" as const,
      tag: `forwardx-openclash-socks-${draft.line.id}`,
      listen: draft.clientSidecar.listen,
      listen_port: draft.clientSidecar.listenPort,
    }],
    outbounds: [privateChildOutbound, directChildOutbound, outbound],
    route: {
      final: outbound.tag,
    },
  };
  const serverPreview = {
    multipathConfig: {
      inbounds: [inbound],
    },
    authenticatedCarrierRuntime: {
      status: "not-compiled" as const,
      boundary: "multipath has no authentication or encryption; carrier runtimes remain separate and unresolved",
      private: {
        type: "existing-mieru-mita" as const,
        lifecycle: "external-preserve" as const,
        mutationAllowed: false as const,
        multipathTarget: { host: inbound.listen, port: inbound.listen_port },
      },
      direct: {
        type: "hysteria2" as const,
        lifecycle: "unresolved-server-runtime" as const,
        mutationAllowed: false as const,
        clientEndpoint: {
          server: directCarrier.server,
          server_port: directCarrier.serverPort,
          tls_server_name: directCarrier.tls.serverName,
          auth_secret_ref: directCarrier.authSecretRef,
        },
        multipathTarget: { host: inbound.listen, port: inbound.listen_port },
      },
    },
  };
  return {
    version: DUAL_MULTIPATH_CONTROL_PLANE_VERSION,
    state: "preview-only" as const,
    name: draft.name,
    upstream: MULTIPATH_POC_UPSTREAM,
    topology: {
      private: draft.legs[0].outboundTag,
      direct: draft.legs[1].outboundTag,
      preferred: draft.legs[0].outboundTag,
    },
    clientConfig,
    serverPreview,
    secretHandling: {
      acceptedInput: "references-only" as const,
      resolved: false as const,
      previewValues: "redacted-placeholders" as const,
    },
    safety: {
      agentPush: false,
      runtimeActivation: false,
      tunnelMutation: false,
    },
  };
}

export async function loadDualMultipathDraft(store: DualMultipathSettingsStore) {
  const raw = await store.getSetting(DUAL_MULTIPATH_DRAFT_SETTING_KEY);
  if (raw) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      throw new Error("已保存的 Dual multipath v2 草稿不是有效 JSON");
    }
    return parseDualMultipathDraft(decoded);
  }

  const legacyRaw = await store.getSetting(LEGACY_DUAL_MULTIPATH_DRAFT_SETTING_KEY);
  if (!legacyRaw) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(legacyRaw);
  } catch {
    throw new Error("已保存的 Dual multipath v1 草稿不是有效 JSON");
  }
  const legacy = legacyDualMultipathDraftSchema.safeParse(decoded);
  if (!legacy.success) {
    throw new Error(`Dual multipath v1 草稿无效：${validationMessage(legacy.error)}`);
  }
  return parseDualMultipathDraft({
    ...legacy.data,
    version: DUAL_MULTIPATH_CONTROL_PLANE_VERSION,
    line: {
      ...legacy.data.line,
      listen: "127.0.0.1",
    },
    ...defaultCarrierAwareFields(),
  });
}

export async function saveDualMultipathDraft(store: DualMultipathSettingsStore, input: unknown) {
  const draft = parseDualMultipathDraft(input);
  await store.setSetting(DUAL_MULTIPATH_DRAFT_SETTING_KEY, JSON.stringify(draft));
  return draft;
}
