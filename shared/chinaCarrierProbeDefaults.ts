import type { HostProbeCarrier } from "./hostProbeMetadata";

export type ChinaCarrierRecommendedDefault = {
  serviceName: string;
  region: string;
  targetIp: string;
  method: "ping";
  intervalSeconds: number;
};

// Built-in recommendations are convenience defaults, not protocol requirements.
// Admins can edit or replace every value after creation.
export const CHINA_CARRIER_RECOMMENDED_DEFAULTS: Record<HostProbeCarrier, ChinaCarrierRecommendedDefault> = {
  cm: {
    serviceName: "上海移动 CM",
    region: "上海",
    targetIp: "211.136.150.66",
    method: "ping",
    intervalSeconds: 60,
  },
  cu: {
    serviceName: "上海联通 CU",
    region: "上海",
    targetIp: "210.22.70.4",
    method: "ping",
    intervalSeconds: 60,
  },
  ct: {
    serviceName: "上海电信 CT",
    region: "上海",
    targetIp: "202.96.209.5",
    method: "ping",
    intervalSeconds: 60,
  },
};
