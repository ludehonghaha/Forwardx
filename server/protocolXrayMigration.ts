import { isAgentVersionAtLeast } from "./agentRouteUtils";
import type { ManagedXrayRuntimePlan } from "./protocolXrayPlan";

export const AGENT_XRAY_RUNTIME_VERSION = "2.2.196";

type RuntimeListenerState = {
  runtime?: string | null;
  port?: number | null;
  protocol?: string | null;
  ready?: boolean | null;
};

type LocalRuntimeStateLike = {
  listeners?: RuntimeListenerState[] | null;
} | null | undefined;

export function agentSupportsManagedXrayRuntime(agentVersion: unknown) {
  return isAgentVersionAtLeast(String(agentVersion || ""), AGENT_XRAY_RUNTIME_VERSION);
}

/**
 * A legacy managed Reality listener belongs to Mihomo until the new Agent has
 * applied the Mihomo plan that excludes Reality. Never start Xray while that
 * listener is still reported ready on the same TCP port; the next heartbeat
 * will observe the released port and can safely hand ownership to Xray.
 */
export function shouldDeferXrayForMihomoRealityHandoff(
  plan: ManagedXrayRuntimePlan | null,
  localState: LocalRuntimeStateLike,
) {
  if (!plan || !Array.isArray(localState?.listeners) || localState.listeners.length === 0) return false;
  const desiredPorts = new Set(plan.sockets.map((socket) => Number(socket.listenPort)).filter((port) => port > 0));
  if (desiredPorts.size === 0) return false;
  return localState.listeners.some((listener) => (
    String(listener?.runtime || "").trim().toLowerCase() === "mihomo"
    && String(listener?.protocol || "").trim().toLowerCase() === "tcp"
    && listener?.ready === true
    && desiredPorts.has(Number(listener?.port || 0))
  ));
}
