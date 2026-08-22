import { isAgentVersionAtLeast } from "./agentRouteUtils";
import type { AgentLocalRuntimeState } from "./agentHeartbeatRoute";
import { managedProtocolListenPort, parseProtocolAccessConfig, protocolConfigBool, protocolConfigText } from "../shared/protocolAccess";

export const AGENT_PROTOCOL_LISTENER_STATE_VERSION = "2.2.191";
export const AGENT_MIERU_LISTENER_STATE_VERSION = "2.2.192";
export const AGENT_MIHOMO_LISTENER_STATE_VERSION = "2.2.193";

export type ProtocolEndpointRuntimeState =
  | "external"
  | "stopped"
  | "offline"
  | "pending"
  | "unsupported"
  | "unknown"
  | "unhealthy"
  | "healthy";

export type ProtocolEndpointRuntimeStatus = {
  state: ProtocolEndpointRuntimeState;
  label: string;
  applied: boolean | null;
  listenerHealthy: boolean | null;
  message: string;
  lastError: string | null;
  checkedAt: number | null;
};

type RuntimeStatusInput = {
  endpoint: any;
  host?: any;
  hostProtocolRevision: number;
  localState?: AgentLocalRuntimeState | null;
  localStateUpdatedAt?: number | null;
};

function status(
  state: ProtocolEndpointRuntimeState,
  label: string,
  input: Pick<ProtocolEndpointRuntimeStatus, "applied" | "listenerHealthy" | "message" | "lastError" | "checkedAt">,
): ProtocolEndpointRuntimeStatus {
  return { state, label, ...input };
}

function isMihomoEntryProtocol(protocol: string) {
  return protocol === "snell" || protocol === "vless_reality" || protocol === "hysteria2";
}

export function projectProtocolEndpointRuntimeStatus(input: RuntimeStatusInput): ProtocolEndpointRuntimeStatus {
  const endpoint = input.endpoint || {};
  if (String(endpoint.runtimeMode || "external") !== "managed") {
    return status("external", "外部管理", {
      applied: null,
      listenerHealthy: null,
      message: "ForwardX 只登记订阅信息，不控制此端点运行时",
      lastError: null,
      checkedAt: null,
    });
  }

  const host = input.host;
  const checkedAt = host?.lastHeartbeat ? new Date(host.lastHeartbeat).getTime() : input.localStateUpdatedAt || null;
  if (!host) {
    const message = "未找到托管 Agent 主机";
    return status("unhealthy", "配置异常", { applied: false, listenerHealthy: false, message, lastError: message, checkedAt });
  }

  const revision = Math.max(0, Math.floor(Number(input.hostProtocolRevision || 0)));
  const appliedRevision = Math.max(0, Math.floor(Number(host.agentLastAppliedRevision || 0)));
  const applied = revision > 0 ? appliedRevision >= revision : null;
  const enabled = endpoint.isEnabled === true;
  if (!host.isOnline) {
    return status("offline", "Agent 离线", {
      applied,
      listenerHealthy: null,
      message: applied === false ? "Agent 离线，端点配置尚未应用" : "Agent 离线，无法确认当前监听状态",
      lastError: null,
      checkedAt,
    });
  }
  if (applied === false) {
    return status("pending", enabled ? "等待应用" : "等待停止", {
      applied: false,
      listenerHealthy: null,
      message: enabled ? "配置已保存，等待 Agent 应用" : "停用已保存，等待 Agent 移除监听",
      lastError: null,
      checkedAt,
    });
  }
  if (!enabled) {
    return status("stopped", "已停止", { applied, listenerHealthy: null, message: "Agent 已应用停用配置", lastError: null, checkedAt });
  }

  const protocol = String(endpoint.protocol || "");
  const isMihomo = isMihomoEntryProtocol(protocol);
  const isMieru = protocol === "mieru";
  const listenerStateVersion = isMihomo
    ? AGENT_MIHOMO_LISTENER_STATE_VERSION
    : isMieru
      ? AGENT_MIERU_LISTENER_STATE_VERSION
      : AGENT_PROTOCOL_LISTENER_STATE_VERSION;
  if (!isAgentVersionAtLeast(String(host.agentVersion || ""), listenerStateVersion)) {
    return status("unsupported", "待升级 Agent", {
      applied,
      listenerHealthy: null,
      message: `升级到 Agent v${listenerStateVersion} 后可核对真实监听状态`,
      lastError: null,
      checkedAt,
    });
  }
  if (!input.localState) {
    return status("unknown", "等待状态", { applied, listenerHealthy: null, message: "等待 Agent 上报本地运行态快照", lastError: null, checkedAt });
  }

  const runtimeServiceName = isMihomo ? "forwardx-mihomo" : isMieru ? "forwardx-mita" : "forwardx-runtime";
  const runtimeService = input.localState.services.find((item) => item.name === runtimeServiceName);
  if (runtimeService?.hasWork && !runtimeService.active) {
    const message = runtimeService.message || `${runtimeServiceName} 服务未运行`;
    return status("unhealthy", "运行异常", { applied, listenerHealthy: false, message, lastError: message, checkedAt });
  }

  const config = parseProtocolAccessConfig(endpoint.configJson);
  const listenPort = managedProtocolListenPort(config, Number(endpoint.publicPort || 0));
  const requiredProtocols = isMihomo
    ? [protocol === "hysteria2" ? "udp" : "tcp"] as const
    : isMieru
      ? [protocolConfigText(config, "transport").toLowerCase() === "udp" ? "udp" : "tcp"] as const
      : protocolConfigBool(config, "udp", false) ? ["tcp", "udp"] as const : ["tcp"] as const;
  const runtimeName = isMihomo ? "mihomo" : isMieru ? "mieru" : "gost";
  const missing = requiredProtocols.filter((requiredProtocol) => !input.localState?.listeners.some((listener) => (
    listener.runtime === runtimeName
    && listener.port === listenPort
    && listener.protocol === requiredProtocol
    && listener.ready
  )));
  if (missing.length > 0) {
    const message = `${missing.map((requiredProtocol) => requiredProtocol.toUpperCase()).join("+")} 监听未就绪（端口 ${listenPort}）`;
    return status("unhealthy", "监听异常", { applied, listenerHealthy: false, message, lastError: message, checkedAt });
  }
  return status("healthy", "运行正常", {
    applied,
    listenerHealthy: true,
    message: `${requiredProtocols.map((requiredProtocol) => requiredProtocol.toUpperCase()).join("+")} 监听已就绪（端口 ${listenPort}）`,
    lastError: null,
    checkedAt,
  });
}
