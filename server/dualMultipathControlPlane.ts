import { z } from "zod";
import {
  MULTIPATH_POC_UPSTREAM,
  buildMultipathPocInbound,
  buildMultipathPocOutbound,
  type MultipathPocLeg,
  type MultipathPocLine,
} from "./multipathPocPlan";

export const DUAL_MULTIPATH_DRAFT_SETTING_KEY = "dualMultipathDraftV1";
export const DUAL_MULTIPATH_CONTROL_PLANE_VERSION = 1 as const;

const UINT32_MAX = 0xffffffff;
const MAX_REORDER_BYTES = 512 * 1024 * 1024;
const MAX_QUEUE_BYTES = 64 * 1024 * 1024;
const durationSchema = z.string().trim().regex(/^\d+(?:\.\d+)?(?:ms|s|m|h)$/, "时长格式必须类似 500ms、1s、2m");

const lineSchema = z.object({
  id: z.number().int().positive(),
  server: z.string().trim().min(1, "请填写 multipath 服务端地址").max(255),
  serverPort: z.number().int().min(1).max(65535),
  listen: z.string().trim().min(1).max(255).optional(),
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

export const dualMultipathDraftSchema = z.object({
  version: z.literal(DUAL_MULTIPATH_CONTROL_PLANE_VERSION).default(DUAL_MULTIPATH_CONTROL_PLANE_VERSION),
  state: z.literal("draft").default("draft"),
  name: z.string().trim().min(1, "请填写 Dual 配置名称").max(80),
  line: lineSchema,
  legs: z.tuple([privateLegSchema, directLegSchema]),
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

export function compileDualMultipathPreview(input: unknown) {
  const draft = parseDualMultipathDraft(input);
  const line: MultipathPocLine = draft.line;
  const legs = compilerLegs(draft);
  const outbound = buildMultipathPocOutbound(line, legs);
  const inbound = buildMultipathPocInbound(line, legs);
  if (!outbound || !inbound) {
    throw new Error("Dual multipath 配置未通过 pinned upstream 编译器校验");
  }
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
    clientOutbound: outbound,
    serverInbound: inbound,
    safety: {
      agentPush: false,
      runtimeActivation: false,
      tunnelMutation: false,
    },
  };
}

export async function loadDualMultipathDraft(store: DualMultipathSettingsStore) {
  const raw = await store.getSetting(DUAL_MULTIPATH_DRAFT_SETTING_KEY);
  if (!raw) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new Error("已保存的 Dual multipath 草稿不是有效 JSON");
  }
  return parseDualMultipathDraft(decoded);
}

export async function saveDualMultipathDraft(store: DualMultipathSettingsStore, input: unknown) {
  const draft = parseDualMultipathDraft(input);
  await store.setSetting(DUAL_MULTIPATH_DRAFT_SETTING_KEY, JSON.stringify(draft));
  return draft;
}
