import { parseProtocolAccessConfig } from "../shared/protocolAccess";

const PROTOCOL_TRAFFIC_BRIDGE_CONFIG_KEY = "_forwardxTrafficBridge";

function positiveInteger(value: unknown) {
  const number = Math.floor(Number(value));
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function dbEnabled(value: unknown, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === 1 || value === "1" || String(value).trim().toLowerCase() === "true";
}

export function isTrustedProtocolTrafficBridgeRuntimeRule(input: {
  rule: any;
  endpoint: any;
  assignments: Array<{ userId?: unknown; isEnabled?: unknown }>;
}) {
  const rule = input.rule;
  const endpoint = input.endpoint;
  const ruleId = positiveInteger(rule?.id);
  if (!ruleId || endpoint?.runtimeMode !== "managed" || !dbEnabled(endpoint?.isEnabled, true)) return false;
  if (positiveInteger(endpoint?.forwardRuleId) !== ruleId) return false;

  const config = parseProtocolAccessConfig(endpoint?.configJson);
  const raw = config[PROTOCOL_TRAFFIC_BRIDGE_CONFIG_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const marker = raw as Record<string, unknown>;
  const ownerUserId = positiveInteger(marker.ownerUserId);
  const publicPort = positiveInteger(marker.publicPort);
  const listenPort = positiveInteger(marker.listenPort);
  if (Number(marker.version) !== 1 || marker.managed !== true) return false;
  if (positiveInteger(marker.ruleId) !== ruleId || !ownerUserId || !publicPort || !listenPort) return false;
  if (publicPort !== positiveInteger(endpoint?.publicPort)) return false;

  const enabledUserIds = Array.from(new Set((input.assignments || [])
    .filter((assignment) => dbEnabled(assignment?.isEnabled, true))
    .map((assignment) => positiveInteger(assignment?.userId))
    .filter((userId) => userId > 0)));
  if (enabledUserIds.length !== 1 || enabledUserIds[0] !== ownerUserId) return false;

  return positiveInteger(rule?.userId) === ownerUserId
    && positiveInteger(rule?.hostId) === positiveInteger(endpoint?.hostId)
    && Number(rule?.sourcePort) === publicPort
    && String(rule?.targetIp || "") === "127.0.0.1"
    && Number(rule?.targetPort) === listenPort
    && !dbEnabled(rule?.pendingDelete, false);
}
