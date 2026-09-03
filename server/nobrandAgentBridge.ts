import { Router, type NextFunction, type Request, type Response } from "express";
import { agentEncryptionMiddleware, getAgentTunneledPath } from "./agentEncryptionMiddleware";
import { getAgentHostIdentityFromRequest } from "./agentAuth";
import {
  completeNoBrandDiscoveryTask,
  takeNoBrandDiscoveryTasks,
  type NoBrandDiscoveryAgentResult,
} from "./nobrandDiscoveryTasks";
import {
  completeDualPilotTask,
  isDualPilotAction,
  takeDualPilotTasks,
  type DualPilotAgentResult,
} from "./dualPilotTasks";

export const nobrandAgentBridgeRouter = Router();

function effectiveAgentPath(req: Request) {
  return getAgentTunneledPath(req) || req.path;
}

function isNoBrandDiscoveryResult(value: unknown): value is NoBrandDiscoveryAgentResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return typeof result.taskId === "string"
    && typeof result.success === "boolean"
    && typeof result.installed === "boolean";
}

function isDualPilotResult(value: unknown): value is DualPilotAgentResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return typeof result.taskId === "string"
    && typeof result.success === "boolean"
    && isDualPilotAction(result.action);
}

function injectDedicatedTasks(res: Response, hostId: number) {
  const originalJson = res.json.bind(res);
  res.json = ((body?: any) => {
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return originalJson(body);
    }
    const noBrandTasks = takeNoBrandDiscoveryTasks(hostId, 1);
    const dualPilotTasks = takeDualPilotTasks(hostId, 1);
    if (noBrandTasks.length === 0 && dualPilotTasks.length === 0) return originalJson(body);
    return originalJson({
      ...body,
      ...(noBrandTasks.length > 0 ? { noBrandDiscoveryTasks: noBrandTasks } : {}),
      ...(dualPilotTasks.length > 0 ? { dualPilotTasks } : {}),
    });
  }) as Response["json"];
}

async function bridgeAgentRequest(req: Request, res: Response, next: NextFunction) {
  try {
    const path = effectiveAgentPath(req);
    const noBrandCandidate = req.body?.nobrandDiscoveryResult;
    const dualPilotCandidate = req.body?.dualPilotResult;

    if (path === "/api/agent/plugin-action-result" && isNoBrandDiscoveryResult(noBrandCandidate)) {
      const host = await getAgentHostIdentityFromRequest(req);
      if (!host) {
        res.status(401).json({ error: "Invalid token" });
        return;
      }
      const accepted = completeNoBrandDiscoveryTask(Number(host.id), noBrandCandidate);
      res.json({ success: true, accepted });
      return;
    }

    if (path === "/api/agent/plugin-action-result" && isDualPilotResult(dualPilotCandidate)) {
      const host = await getAgentHostIdentityFromRequest(req);
      if (!host) {
        res.status(401).json({ error: "Invalid token" });
        return;
      }
      const accepted = completeDualPilotTask(Number(host.id), dualPilotCandidate);
      res.json({ success: true, accepted });
      return;
    }

    if (path === "/api/agent/heartbeat") {
      const host = await getAgentHostIdentityFromRequest(req);
      if (!host) {
        res.status(401).json({ error: "Invalid token" });
        return;
      }
      injectDedicatedTasks(res, Number(host.id));
    }

    next();
  } catch (error) {
    next(error);
  }
}

// The Agent normally tunnels POST traffic through /api/sync. Keep direct paths
// too so transport negotiation/fallback does not change dedicated task behavior.
nobrandAgentBridgeRouter.post("/api/sync", agentEncryptionMiddleware, bridgeAgentRequest);
nobrandAgentBridgeRouter.post("/api/agent/heartbeat", agentEncryptionMiddleware, bridgeAgentRequest);
nobrandAgentBridgeRouter.post("/api/agent/plugin-action-result", agentEncryptionMiddleware, bridgeAgentRequest);
