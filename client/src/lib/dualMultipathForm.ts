export type DualMultipathInfrastructureState = {
  line: any;
  legs: any;
  openClashIngressAdapter: any;
  privateCarrierBridge: any;
  directCarrier: any;
  serverRuntime: any;
};

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

function defaultInfrastructure(): DualMultipathInfrastructureState {
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
    openClashIngressAdapter: {
      type: "local-socks-sidecar",
      status: "planned",
      tag: "forwardx-dual-ingress-1",
      listen: "127.0.0.1",
      listenPort: 20808,
    },
    privateCarrierBridge: {
      type: "mihomo-dedicated-listener",
      status: "unresolved",
      listener: { kind: "socks", scope: "dedicated", listen: "127.0.0.1", listenPort: 20809 },
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
      server: "87.86.22.221",
      serverPort: null,
      tls: { serverName: null },
      authSecretRef: "dual.hy2.auth",
    },
    serverRuntime: {
      topologyStatus: "verified-read-only",
      publicSide: { interface: "eth0", sourceAddress: "87.86.22.221", gateway: "87.86.22.1" },
      privateSide: {
        interface: "eth1",
        sourceAddress: "172.16.4.114",
        existingCarrier: "mita",
        existingListenerPort: 11464,
        lifecycle: "preserve",
      },
      directCarrierRuntime: {
        status: "unresolved",
        engine: "pinned-singbox-multipath",
        nativeHysteria2: "requires-with_quic-build-tag",
        separateHysteriaBinaryRequired: false,
        bindInterface: "eth0",
        sourceAddress: "87.86.22.221",
        tlsCertificateSecretRef: "dual.hy2.tls.certificate",
        tlsPrivateKeySecretRef: "dual.hy2.tls.private-key",
      },
    },
  };
}

export function defaultDualMultipathForm(): DualMultipathFormState {
  return {
    name: "NoBrand Dual",
    privateBandwidthMbps: "200",
    directBandwidthMbps: "1000",
    activationThresholdMbps: "120",
    activationWindow: "1s",
    infrastructure: defaultInfrastructure(),
  };
}

function requiredInteger(value: string, label: string, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const text = String(value || "").trim();
  if (!/^\d+$/.test(text)) throw new Error(`${label}必须是整数`);
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${label}必须在 ${min}～${max} 之间`);
  return parsed;
}

export function buildDualMultipathDraftFromForm(form: DualMultipathFormState) {
  const name = form.name.trim();
  if (!name) throw new Error("请填写 Dual 配置名称");
  const privateBandwidthMbps = requiredInteger(form.privateBandwidthMbps, "专线带宽", 1, UINT32_MAX);
  const directBandwidthMbps = requiredInteger(form.directBandwidthMbps, "直连带宽", 1, UINT32_MAX);
  const activationThresholdMbps = requiredInteger(form.activationThresholdMbps, "启动直连阈值", 1, UINT32_MAX);
  const activationWindow = form.activationWindow.trim();
  if (!durationPattern.test(activationWindow)) throw new Error("统计窗口格式必须类似 500ms、1s、2m");
  const { line, legs, ...infrastructure } = form.infrastructure;

  return {
    version: 3 as const,
    state: "draft" as const,
    name,
    line: {
      ...line,
      activationThresholdMbps,
      activationWindow,
    },
    legs: [
      {
        ...legs[0],
        expectedBandwidthMbps: privateBandwidthMbps,
      },
      {
        ...legs[1],
        expectedBandwidthMbps: directBandwidthMbps,
      },
    ],
    ...infrastructure,
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
    privateBandwidthMbps: String(privateLeg.expectedBandwidthMbps || base.privateBandwidthMbps),
    directBandwidthMbps: String(directLeg.expectedBandwidthMbps || base.directBandwidthMbps),
    activationThresholdMbps: String(line.activationThresholdMbps || base.activationThresholdMbps),
    activationWindow: String(line.activationWindow || base.activationWindow),
    infrastructure: {
      line: draft.line || base.infrastructure.line,
      legs: Array.isArray(draft.legs) && draft.legs.length === 2 ? draft.legs : base.infrastructure.legs,
      openClashIngressAdapter: draft.openClashIngressAdapter || base.infrastructure.openClashIngressAdapter,
      privateCarrierBridge: draft.privateCarrierBridge || base.infrastructure.privateCarrierBridge,
      directCarrier: draft.directCarrier || base.infrastructure.directCarrier,
      serverRuntime: draft.serverRuntime || base.infrastructure.serverRuntime,
    },
  };
}
