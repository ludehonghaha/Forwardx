export type DualMultipathFormState = {
  name: string;
  server: string;
  serverPort: string;
  privateOutboundTag: string;
  privateBandwidthMbps: string;
  privateSupportsUdp: boolean;
  directOutboundTag: string;
  directBandwidthMbps: string;
  directSupportsUdp: boolean;
  activationThresholdMbps: string;
  activationWindow: string;
  udpLegIndex: "0" | "1";
  tcpFastOpen: boolean;
};

const UINT32_MAX = 0xffffffff;
const durationPattern = /^\d+(?:\.\d+)?(?:ms|s|m|h)$/;

export function defaultDualMultipathForm(): DualMultipathFormState {
  return {
    name: "NoBrand Dual",
    // For the NoBrand same-host carrier model both authenticated proxies
    // terminate on the Dual box and dial the multipath listener locally.
    // Loopback is also the fail-closed default because multipath itself has no
    // authentication or encryption.
    server: "127.0.0.1",
    serverPort: "39000",
    privateOutboundTag: "dedicated",
    privateBandwidthMbps: "160",
    privateSupportsUdp: true,
    directOutboundTag: "hy2-public",
    directBandwidthMbps: "700",
    directSupportsUdp: true,
    activationThresholdMbps: "120",
    activationWindow: "1s",
    udpLegIndex: "0",
    tcpFastOpen: true,
  };
}

function requiredInteger(value: string, label: string, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const text = String(value || "").trim();
  if (!/^\d+$/.test(text)) throw new Error(`${label}必须是整数`);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label}必须在 ${min}～${max} 之间`);
  }
  return parsed;
}

function optionalInteger(value: string, label: string, min = 1, max = UINT32_MAX) {
  const text = String(value || "").trim();
  if (!text) return undefined;
  return requiredInteger(text, label, min, max);
}

export function buildDualMultipathDraftFromForm(form: DualMultipathFormState) {
  const name = form.name.trim();
  const server = form.server.trim();
  const privateOutboundTag = form.privateOutboundTag.trim();
  const directOutboundTag = form.directOutboundTag.trim();

  if (!name) throw new Error("请填写 Dual 配置名称");
  if (!server) throw new Error("请填写 multipath 服务端地址");
  if (!privateOutboundTag) throw new Error("请填写专线 outbound tag");
  if (!directOutboundTag) throw new Error("请填写直连 outbound tag");
  if (privateOutboundTag === directOutboundTag) throw new Error("专线与直连必须使用不同的 outbound tag");

  const serverPort = requiredInteger(form.serverPort, "服务端端口", 1, 65535);
  const activationThresholdMbps = requiredInteger(form.activationThresholdMbps, "启动直连阈值", 1, UINT32_MAX);
  const activationWindow = form.activationWindow.trim();
  if (!durationPattern.test(activationWindow)) {
    throw new Error("统计窗口格式必须类似 500ms、1s、2m");
  }

  const privateBandwidthMbps = optionalInteger(form.privateBandwidthMbps, "专线带宽");
  const directBandwidthMbps = optionalInteger(form.directBandwidthMbps, "直连带宽");
  if ((privateBandwidthMbps === undefined) !== (directBandwidthMbps === undefined)) {
    throw new Error("两条线路带宽要么都填写，要么都留空");
  }

  const udpLegIndex = form.udpLegIndex === "1" ? 1 : 0;
  if (udpLegIndex === 0 && !form.privateSupportsUdp) throw new Error("当前 UDP 路径选择了专线，但专线已标记为不支持 UDP");
  if (udpLegIndex === 1 && !form.directSupportsUdp) throw new Error("当前 UDP 路径选择了直连，但直连已标记为不支持 UDP");

  return {
    version: 1 as const,
    state: "draft" as const,
    name,
    line: {
      id: 1,
      server,
      serverPort,
      preferredLegIndex: 0 as const,
      udpLegIndex: udpLegIndex as 0 | 1,
      tcpFastOpen: form.tcpFastOpen,
      activationThresholdMbps,
      activationWindow,
    },
    legs: [
      {
        role: "private" as const,
        legIndex: 0 as const,
        outboundTag: privateOutboundTag,
        ...(privateBandwidthMbps === undefined ? {} : { expectedBandwidthMbps: privateBandwidthMbps }),
        supportsUdp: form.privateSupportsUdp,
      },
      {
        role: "direct" as const,
        legIndex: 1 as const,
        outboundTag: directOutboundTag,
        ...(directBandwidthMbps === undefined ? {} : { expectedBandwidthMbps: directBandwidthMbps }),
        supportsUdp: form.directSupportsUdp,
      },
    ] as const,
  };
}

export function dualMultipathFormFromDraft(draft: any): DualMultipathFormState {
  const base = defaultDualMultipathForm();
  if (!draft || typeof draft !== "object") return base;
  const line = draft.line && typeof draft.line === "object" ? draft.line : {};
  const privateLeg = Array.isArray(draft.legs) ? draft.legs[0] || {} : {};
  const directLeg = Array.isArray(draft.legs) ? draft.legs[1] || {} : {};
  return {
    name: String(draft.name || base.name),
    server: String(line.server || base.server),
    serverPort: String(line.serverPort || base.serverPort),
    privateOutboundTag: String(privateLeg.outboundTag || base.privateOutboundTag),
    privateBandwidthMbps: privateLeg.expectedBandwidthMbps === undefined ? "" : String(privateLeg.expectedBandwidthMbps),
    privateSupportsUdp: privateLeg.supportsUdp !== false,
    directOutboundTag: String(directLeg.outboundTag || base.directOutboundTag),
    directBandwidthMbps: directLeg.expectedBandwidthMbps === undefined ? "" : String(directLeg.expectedBandwidthMbps),
    directSupportsUdp: directLeg.supportsUdp !== false,
    activationThresholdMbps: String(line.activationThresholdMbps || base.activationThresholdMbps),
    activationWindow: String(line.activationWindow || base.activationWindow),
    udpLegIndex: line.udpLegIndex === 1 ? "1" : "0",
    tcpFastOpen: line.tcpFastOpen !== false,
  };
}
