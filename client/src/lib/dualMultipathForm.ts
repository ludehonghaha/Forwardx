export type DualMultipathFormState = {
  name: string;
  server: string;
  serverPort: string;
  privateOutboundTag: string;
  privateBandwidthMbps: string;
  privateSupportsUdp: boolean;
  privateSocksHost: string;
  privateSocksPort: string;
  privateUsernameSecretRef: string;
  privatePasswordSecretRef: string;
  directOutboundTag: string;
  directBandwidthMbps: string;
  directSupportsUdp: boolean;
  directHy2Server: string;
  directHy2ServerPort: string;
  directHy2TlsServerName: string;
  directHy2AuthSecretRef: string;
  openClashSocksListen: string;
  openClashSocksPort: string;
  activationThresholdMbps: string;
  activationWindow: string;
  udpLegIndex: "0" | "1";
  tcpFastOpen: boolean;
};

const UINT32_MAX = 0xffffffff;
const durationPattern = /^\d+(?:\.\d+)?(?:ms|s|m|h)$/;
const secretReferencePattern = /^dual\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/i;

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
    privateSocksHost: "127.0.0.1",
    privateSocksPort: "1080",
    privateUsernameSecretRef: "",
    privatePasswordSecretRef: "",
    directOutboundTag: "hy2-public",
    directBandwidthMbps: "700",
    directSupportsUdp: true,
    directHy2Server: "dual.example.invalid",
    directHy2ServerPort: "443",
    directHy2TlsServerName: "dual.example.invalid",
    directHy2AuthSecretRef: "dual.hy2.auth",
    openClashSocksListen: "127.0.0.1",
    openClashSocksPort: "10808",
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

function validateSecretReference(value: string, label: string) {
  if (!secretReferencePattern.test(value)) {
    throw new Error(`${label}必须使用 dual.* 命名，不能填写 secret value`);
  }
}

export function buildDualMultipathDraftFromForm(form: DualMultipathFormState) {
  const name = form.name.trim();
  const server = form.server.trim();
  const privateOutboundTag = form.privateOutboundTag.trim();
  const directOutboundTag = form.directOutboundTag.trim();
  const privateUsernameSecretRef = form.privateUsernameSecretRef.trim();
  const privatePasswordSecretRef = form.privatePasswordSecretRef.trim();
  const directHy2Server = form.directHy2Server.trim();
  const directHy2TlsServerName = form.directHy2TlsServerName.trim();
  const directHy2AuthSecretRef = form.directHy2AuthSecretRef.trim();

  if (!name) throw new Error("请填写 Dual 配置名称");
  if (!server) throw new Error("请填写 multipath 服务端地址");
  if (!privateOutboundTag) throw new Error("请填写专线 outbound tag");
  if (!directOutboundTag) throw new Error("请填写直连 outbound tag");
  if (privateOutboundTag === directOutboundTag) throw new Error("专线与直连必须使用不同的 outbound tag");
  if (form.privateSocksHost.trim() !== "127.0.0.1") throw new Error("Mieru SOCKS5 必须使用 127.0.0.1 本地回环地址");
  if ((privateUsernameSecretRef === "") !== (privatePasswordSecretRef === "")) {
    throw new Error("SOCKS5 username/password secret reference 必须同时填写或同时留空");
  }
  if (privateUsernameSecretRef) {
    validateSecretReference(privateUsernameSecretRef, "SOCKS5 username secret reference");
    validateSecretReference(privatePasswordSecretRef, "SOCKS5 password secret reference");
  }
  if (!directHy2Server) throw new Error("请填写 Hysteria2 服务端地址");
  if (!directHy2TlsServerName) throw new Error("请填写 Hysteria2 TLS server name");
  if (!directHy2AuthSecretRef) throw new Error("请填写 Hysteria2 auth secret reference");
  validateSecretReference(directHy2AuthSecretRef, "Hysteria2 auth secret reference");
  if (form.openClashSocksListen.trim() !== "127.0.0.1") throw new Error("OpenClash sidecar 只允许 127.0.0.1 回环监听");

  const serverPort = requiredInteger(form.serverPort, "服务端端口", 1, 65535);
  const privateSocksPort = requiredInteger(form.privateSocksPort, "Mieru SOCKS5 端口", 1, 65535);
  const directHy2ServerPort = requiredInteger(form.directHy2ServerPort, "Hysteria2 服务端端口", 1, 65535);
  const openClashSocksPort = requiredInteger(form.openClashSocksPort, "OpenClash sidecar SOCKS 端口", 1, 65535);
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
    version: 2 as const,
    state: "draft" as const,
    name,
    line: {
      id: 1,
      server,
      serverPort,
      listen: "127.0.0.1" as const,
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
    carriers: {
      private: {
        type: "local-socks5" as const,
        host: "127.0.0.1" as const,
        port: privateSocksPort,
        ...(privateUsernameSecretRef ? {
          usernameSecretRef: privateUsernameSecretRef,
          passwordSecretRef: privatePasswordSecretRef,
        } : {}),
      },
      direct: {
        type: "hysteria2" as const,
        server: directHy2Server,
        serverPort: directHy2ServerPort,
        tls: { serverName: directHy2TlsServerName },
        authSecretRef: directHy2AuthSecretRef,
      },
    },
    clientSidecar: {
      type: "local-socks-sidecar" as const,
      listen: "127.0.0.1" as const,
      listenPort: openClashSocksPort,
    },
  };
}

export function dualMultipathFormFromDraft(draft: any): DualMultipathFormState {
  const base = defaultDualMultipathForm();
  if (!draft || typeof draft !== "object") return base;
  const line = draft.line && typeof draft.line === "object" ? draft.line : {};
  const privateLeg = Array.isArray(draft.legs) ? draft.legs[0] || {} : {};
  const directLeg = Array.isArray(draft.legs) ? draft.legs[1] || {} : {};
  const carriers = draft.carriers && typeof draft.carriers === "object" ? draft.carriers : {};
  const privateCarrier = carriers.private && typeof carriers.private === "object" ? carriers.private : {};
  const directCarrier = carriers.direct && typeof carriers.direct === "object" ? carriers.direct : {};
  const directTls = directCarrier.tls && typeof directCarrier.tls === "object" ? directCarrier.tls : {};
  const clientSidecar = draft.clientSidecar && typeof draft.clientSidecar === "object" ? draft.clientSidecar : {};
  return {
    name: String(draft.name || base.name),
    server: String(line.server || base.server),
    serverPort: String(line.serverPort || base.serverPort),
    privateOutboundTag: String(privateLeg.outboundTag || base.privateOutboundTag),
    privateBandwidthMbps: privateLeg.expectedBandwidthMbps === undefined ? "" : String(privateLeg.expectedBandwidthMbps),
    privateSupportsUdp: privateLeg.supportsUdp !== false,
    privateSocksHost: String(privateCarrier.host || base.privateSocksHost),
    privateSocksPort: String(privateCarrier.port || base.privateSocksPort),
    privateUsernameSecretRef: String(privateCarrier.usernameSecretRef || ""),
    privatePasswordSecretRef: String(privateCarrier.passwordSecretRef || ""),
    directOutboundTag: String(directLeg.outboundTag || base.directOutboundTag),
    directBandwidthMbps: directLeg.expectedBandwidthMbps === undefined ? "" : String(directLeg.expectedBandwidthMbps),
    directSupportsUdp: directLeg.supportsUdp !== false,
    directHy2Server: String(directCarrier.server || base.directHy2Server),
    directHy2ServerPort: String(directCarrier.serverPort || base.directHy2ServerPort),
    directHy2TlsServerName: String(directTls.serverName || base.directHy2TlsServerName),
    directHy2AuthSecretRef: String(directCarrier.authSecretRef || base.directHy2AuthSecretRef),
    openClashSocksListen: String(clientSidecar.listen || base.openClashSocksListen),
    openClashSocksPort: String(clientSidecar.listenPort || base.openClashSocksPort),
    activationThresholdMbps: String(line.activationThresholdMbps || base.activationThresholdMbps),
    activationWindow: String(line.activationWindow || base.activationWindow),
    udpLegIndex: line.udpLegIndex === 1 ? "1" : "0",
    tcpFastOpen: line.tcpFastOpen !== false,
  };
}
