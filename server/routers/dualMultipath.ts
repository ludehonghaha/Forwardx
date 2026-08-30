import { TRPCError } from "@trpc/server";
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

const settingsStore: DualMultipathSettingsStore = {
  getSetting: (key) => db.getSetting(key),
  setSetting: (key, value) => db.setSetting(key, value),
};

function badRequest(error: unknown): never {
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: error instanceof Error ? error.message : "Dual multipath 配置无效",
  });
}

/**
 * Dual multipath 目前只提供离线控制面：保存草稿、读取草稿、编译预览
 * 和生成不可执行的 Dry-run 部署计划。本 router 故意不导入
 * agentEvents、runtime lifecycle 或 tunnel mutation。
 */
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
});
