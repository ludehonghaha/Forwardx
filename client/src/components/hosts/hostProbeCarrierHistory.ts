export type ChinaCarrierKey = "ct" | "cu" | "cm";

export const CHINA_CARRIER_PROBE_TARGETS: Record<ChinaCarrierKey, string> = {
  ct: "202.96.209.5",
  cu: "210.22.84.3",
  cm: "211.136.150.66",
};

export const CHINA_CARRIER_LABELS: Record<ChinaCarrierKey, string> = {
  ct: "电信",
  cu: "联通",
  cm: "移动",
};

export function detectChinaCarrierProbe(service: any): ChinaCarrierKey | null {
  const target = String(service?.targetIp || "").trim();
  for (const carrier of Object.keys(CHINA_CARRIER_PROBE_TARGETS) as ChinaCarrierKey[]) {
    if (target === CHINA_CARRIER_PROBE_TARGETS[carrier]) return carrier;
  }

  const name = String(service?.name || "").trim();
  if (/电信|(?:^|\W)CT(?:\W|$)/i.test(name)) return "ct";
  if (/联通|(?:^|\W)CU(?:\W|$)/i.test(name)) return "cu";
  if (/移动|(?:^|\W)CM(?:\W|$)/i.test(name)) return "cm";
  return null;
}

export function inferChinaCarrierProbeRegion(service: any) {
  const name = String(service?.name || "").trim();
  if (!name) return "未标地区";
  const carrierIndexCandidates = [
    name.indexOf("电信"),
    name.indexOf("联通"),
    name.indexOf("移动"),
  ].filter((value) => value > 0);
  if (carrierIndexCandidates.length > 0) {
    const prefix = name.slice(0, Math.min(...carrierIndexCandidates)).trim();
    if (prefix) return prefix;
  }
  const codeMatch = name.match(/^(.*?)\s*(?:CT|CU|CM)(?:\s|$)/i);
  if (codeMatch?.[1]?.trim()) return codeMatch[1].trim();
  return "未标地区";
}

export function hostProbeServiceAppliesToHost(service: any, hostId: number) {
  const id = Number(hostId);
  if (!Number.isInteger(id) || id <= 0 || service?.isEnabled === false) return false;
  const hostIds = Array.isArray(service?.hostIds) ? service.hostIds.map(Number) : [];
  const excludeHostIds = Array.isArray(service?.excludeHostIds) ? service.excludeHostIds.map(Number) : [];
  if (service?.hostScope === "specific") return hostIds.includes(id);
  if (service?.hostScope === "exclude") return !excludeHostIds.includes(id);
  return true;
}
