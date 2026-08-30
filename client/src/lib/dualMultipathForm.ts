import {
  NO_BRAND_DUAL_DISCOVERY_SNAPSHOT,
  createDefaultDualMultipathInfrastructure,
  type DualMultipathDraftV3,
  type DualMultipathInfrastructureState,
} from "@shared/dualMultipath";

export type { DualMultipathInfrastructureState } from "@shared/dualMultipath";

export type DualMultipathFormState = {
  name: string;
  privateBandwidthMbps: string;
  directBandwidthMbps: string;
  activationThresholdMbps: string;
  activationWindow: string;
  infrastructure: DualMultipathInfrastructureState;
};

const UINT32_MAX = 0xffffffff;
const durationPattern = /^\d+(?:\.\d+)?(?:ms|s|m|h)$/;

export function defaultDualMultipathForm(): DualMultipathFormState {
  return {
    name: "NoBrand Dual",
    privateBandwidthMbps: "200",
    directBandwidthMbps: "1000",
    activationThresholdMbps: "120",
    activationWindow: "1s",
    infrastructure: createDefaultDualMultipathInfrastructure(NO_BRAND_DUAL_DISCOVERY_SNAPSHOT),
  };
}

function requiredInteger(value: string, label: string, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const text = String(value || "").trim();
  if (!/^\d+$/.test(text)) throw new Error(`${label}必须是整数`);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${label}必须在 ${min}～${max} 之间`);
  return parsed;
}

export function buildDualMultipathDraftFromForm(form: DualMultipathFormState): DualMultipathDraftV3 {
  const name = form.name.trim();
  if (!name) throw new Error("请填写 Dual 配置名称");
  const privateBandwidthMbps = requiredInteger(form.privateBandwidthMbps, "专线带宽", 1, UINT32_MAX);
  const directBandwidthMbps = requiredInteger(form.directBandwidthMbps, "直连带宽", 1, UINT32_MAX);
  const activationThresholdMbps = requiredInteger(form.activationThresholdMbps, "启动直连阈值", 1, UINT32_MAX);
  const activationWindow = form.activationWindow.trim();
  if (!durationPattern.test(activationWindow)) throw new Error("统计窗口格式必须类似 500ms、1s、2m");
  const { line, legs, ...infrastructure } = form.infrastructure;

  return {
    version: 3,
    state: "draft",
    name,
    line: { ...line, activationThresholdMbps, activationWindow },
    legs: [
      { ...legs[0], expectedBandwidthMbps: privateBandwidthMbps },
      { ...legs[1], expectedBandwidthMbps: directBandwidthMbps },
    ],
    ...infrastructure,
  };
}

export function dualMultipathFormFromDraft(
  draft: DualMultipathDraftV3 | null | undefined,
): DualMultipathFormState {
  const base = defaultDualMultipathForm();
  if (!draft) return base;
  return {
    name: draft.name,
    privateBandwidthMbps: String(draft.legs[0].expectedBandwidthMbps ?? base.privateBandwidthMbps),
    directBandwidthMbps: String(draft.legs[1].expectedBandwidthMbps ?? base.directBandwidthMbps),
    activationThresholdMbps: String(draft.line.activationThresholdMbps ?? base.activationThresholdMbps),
    activationWindow: draft.line.activationWindow ?? base.activationWindow,
    infrastructure: {
      line: draft.line,
      legs: draft.legs,
      targetDiscovery: draft.targetDiscovery,
      openClashIngressAdapter: draft.openClashIngressAdapter,
      privateCarrierBridge: draft.privateCarrierBridge,
      directCarrier: draft.directCarrier,
      serverRuntime: draft.serverRuntime,
    },
  };
}
