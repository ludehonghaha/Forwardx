import { isAgentVersionAtLeast } from "./agentRouteUtils";
import type { ManagedXrayRuntimePlan } from "./protocolXrayPlan";

export const AGENT_XRAY_RUNTIME_VERSION = "2.2.196";
export const XRAY_RUNTIME_SERVICE_NAME = "forwardx-xray";

type RuntimeListenerState = {
  runtime?: string | null;
  port?: number | null;
  protocol?: string | null;
  ready?: boolean | null;
};

type RuntimeServiceState = {
  name?: string | null;
  hasWork?: boolean | null;
  active?: boolean | null;
};

type LocalRuntimeStateLike = {
  listeners?: RuntimeListenerState[] | null;
  services?: RuntimeServiceState[] | null;
} | null | undefined;

export function agentSupportsManagedXrayRuntime(agentVersion: unknown) {
  return isAgentVersionAtLeast(String(agentVersion || ""), AGENT_XRAY_RUNTIME_VERSION);
}

function xrayListenerReadyOnPort(localState: LocalRuntimeStateLike, port: number) {
  return Array.isArray(localState?.listeners) && localState.listeners.some((listener) => (
    String(listener?.runtime || "").trim().toLowerCase() === "xray"
    && String(listener?.protocol || "").trim().toLowerCase() === "tcp"
    && listener?.ready === true
    && Number(listener?.port || 0) === port
  ));
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

/**
 * Revision-only reconciliation is insufficient immediately after the first
 * handoff heartbeat because applying the Mihomo release may advance the Agent
 * revision before Xray has ever started. Keep the second phase driven by real
 * listener readiness so takeover and later drift repair are deterministic.
 */
export function managedXrayRuntimeNeedsApply(
  plan: ManagedXrayRuntimePlan | null,
  localState: LocalRuntimeStateLike,
) {
  if (!plan) return false;
  return plan.sockets.some((socket) => {
    const port = Number(socket.listenPort || 0);
    return port <= 0 || !xrayListenerReadyOnPort(localState, port);
  });
}

/**
 * Closing the final managed Reality endpoint must also remove stale Xray work.
 * Use either the service hasWork flag or a surviving listener as evidence, so a
 * failed prior stop is retried even after the config revision itself caught up.
 */
export function managedXrayRuntimeNeedsCleanup(
  plan: ManagedXrayRuntimePlan | null,
  localState: LocalRuntimeStateLike,
) {
  if (plan) return false;
  const serviceHasWork = Array.isArray(localState?.services) && localState.services.some((service) => (
    String(service?.name || "").trim() === XRAY_RUNTIME_SERVICE_NAME
    && service?.hasWork === true
  ));
  const listenerExists = Array.isArray(localState?.listeners) && localState.listeners.some((listener) => (
    String(listener?.runtime || "").trim().toLowerCase() === "xray"
    && listener?.ready === true
  ));
  return !!serviceHasWork || !!listenerExists;
}
