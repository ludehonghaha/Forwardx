import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import {
  compileDualMultipathPreview,
  dualMultipathDraftSchema,
  loadDualMultipathDraft,
  saveDualMultipathDraft,
  type DualMultipathSettingsStore,
} from "../dualMultipathControlPlane";
import { buildDualMultipathDeploymentPlan } from "../dualMultipathDeploymentPlan";
import {
  enqueueDualPilotTask,
  getDualPilotTaskStatus,
} from "../dualPilotTasks";

const settingsStore: DualMultipathSettingsStore = {
  getSetting: (key) => db.getSetting(key),
  setSetting: (key, value) => db.setSetting(key, value),
};

const dualPilotActionInput = z.object({
  hostId: z.number().int().positive(),
  action: z.enum(["start", "stop", "status"]),
});

const dualPilotStatusInput = z.object({
  hostId: z.number().int().positive(),
});

function badRequest(error: unknown): never {
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: error instanceof Error ? error.message : "Dual multipath 配置无效",
  });
}

async function requireOnlineDualPilotHost(hostId: number) {
  const host = await db.getHostById(hostId);
  if (!host) throw new Error("Dual Pilot 服务端主机不存在");
  if (!(host as any).isOnline) throw new Error("Dual Pilot 服务端 Agent 当前离线");
  return host;
}

export const dualMultipathRouter = router({
  current: adminProcedure.query(async () => {
    try {
      const draft = await loadDualMultipathDraft(settingsStore);
      return { configured: draft !== null, draft };
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "Dual multipath 草稿读取失败",
      });
    }
  }),

  saveDraft: adminProcedure
    .input(dualMultipathDraftSchema)
    .mutation(async ({ input }) => {
      try {
        const draft = await saveDualMultipathDraft(settingsStore, input);
        return {
          success: true as const,
          draft,
          deployment: "none" as const,
        };
      } catch (error) {
        return badRequest(error);
      }
    }),

  // Preview is an explicit on-demand action in the UI. It still performs no
  // writes or runtime work; mutation semantics here only avoid query caching.
  preview: adminProcedure
    .input(dualMultipathDraftSchema)
    .mutation(({ input }) => {
      try {
        return compileDualMultipathPreview(input);
      } catch (error) {
        return badRequest(error);
      }
    }),

  // This is a plan generator only. The result is deliberately fail-closed and
  // contains no executable Agent/runtime action.
  dryRunPlan: adminProcedure
    .input(dualMultipathDraftSchema)
    .mutation(({ input }) => {
      try {
        return buildDualMultipathDeploymentPlan(input);
      } catch (error) {
        return badRequest(error);
      }
    }),

  // Pilot control is intentionally much narrower than the generic Agent/plugin
  // action surface. Only these three lifecycle enums can be queued. Executable,
  // paths, role and arguments are fixed inside the Agent binary. The server
  // independently re-checks host existence and liveness instead of trusting UI.
  pilotAction: adminProcedure
    .input(dualPilotActionInput)
    .mutation(async ({ input }) => {
      try {
        await requireOnlineDualPilotHost(input.hostId);
        return enqueueDualPilotTask(input.hostId, input.action);
      } catch (error) {
        return badRequest(error);
      }
    }),

  pilotActionStatus: adminProcedure
    .input(dualPilotStatusInput)
    .query(({ input }) => ({ status: getDualPilotTaskStatus(input.hostId) })),
});
