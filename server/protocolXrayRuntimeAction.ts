import {
  restartManagedServiceIfConfigChangedCmd,
  shQuote,
  stopManagedServiceCmd,
  writeManagedServiceCmd,
} from "./agentActionCommands";
import type { ManagedXrayRuntimePlan } from "./protocolXrayPlan";
import {
  XRAY_BIN,
  XRAY_CONFIG_DIR,
  XRAY_CONFIG_PATH,
  XRAY_SERVICE_NAME,
  ensureXrayBinaryCmd,
  verifyXrayRuntimeCmd,
  xrayServiceUnit,
} from "./protocolXrayRuntime";

export const XRAY_RUNTIME_FORWARD_TYPE = "xray-runtime-sync";

export type ManagedXrayRuntimeSyncAction = {
  statusType: "runtime";
  ruleId: 0;
  tunnelId: 0;
  op: "apply";
  forwardType: typeof XRAY_RUNTIME_FORWARD_TYPE;
  sourcePort: 0;
  targetIp: "";
  targetPort: 0;
  protocol: "tcp";
  knownRunning: false;
  forceRuntimeSync: true;
  preCommands: string[];
  commands: string[];
  managedConfigs: Array<{
    path: string;
    contentBase64: string;
    format: "json";
    mode: number;
    validateCommand: string;
    serviceName: string;
  }>;
};

/**
 * Build the desired-state action for ForwardX's dedicated Xray Reality runtime.
 *
 * This is deliberately a pure builder so the heartbeat route only needs to
 * decide when to enqueue it. The Agent already executes preCommands before
 * managedConfigs, allowing the pinned Xray binary to be installed before the
 * staged config is validated with `xray run -test`.
 */
export function buildManagedXrayRuntimeSyncAction(
  plan: ManagedXrayRuntimePlan | null,
): ManagedXrayRuntimeSyncAction {
  const preCommands = plan ? [ensureXrayBinaryCmd()] : [];
  const commands = [
    `mkdir -p ${shQuote(XRAY_CONFIG_DIR)}`,
    writeManagedServiceCmd(XRAY_SERVICE_NAME, xrayServiceUnit()),
  ];

  if (plan) {
    commands.push(
      restartManagedServiceIfConfigChangedCmd(XRAY_SERVICE_NAME, XRAY_CONFIG_PATH),
      verifyXrayRuntimeCmd(plan),
    );
  } else {
    commands.push(stopManagedServiceCmd(XRAY_SERVICE_NAME));
  }

  const managedConfigs: ManagedXrayRuntimeSyncAction["managedConfigs"] = plan ? [{
    path: XRAY_CONFIG_PATH,
    contentBase64: Buffer.from(JSON.stringify(plan.config, null, 2), "utf8").toString("base64"),
    format: "json",
    mode: 0o600,
    validateCommand: `${shQuote(XRAY_BIN)} run -test -c {{path}}`,
    serviceName: XRAY_SERVICE_NAME,
  }] : [];

  return {
    statusType: "runtime",
    ruleId: 0,
    tunnelId: 0,
    op: "apply",
    forwardType: XRAY_RUNTIME_FORWARD_TYPE,
    sourcePort: 0,
    targetIp: "",
    targetPort: 0,
    protocol: "tcp",
    knownRunning: false,
    forceRuntimeSync: true,
    preCommands,
    commands,
    managedConfigs,
  };
}
