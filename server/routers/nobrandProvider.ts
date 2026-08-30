import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { pushAgentRefresh } from "../agentEvents";
import {
  clearNoBrandDiscoveryStatus,
  enqueueNoBrandDiscoveryTask,
  getNoBrandDiscoveryStatus,
} from "../nobrandDiscoveryTasks";

const hostInput = z.object({ hostId: z.number().int().positive() });

async function requireHost(hostId: number) {
  const host = await db.getHostById(hostId);
  if (!host) {
    throw new TRPCError({ code: "NOT_FOUND", message: "主机不存在" });
  }
  return host;
}

export const nobrandProviderRouter = router({
  scan: adminProcedure.input(hostInput).mutation(async ({ input }) => {
    const host = await requireHost(input.hostId);
    if (!String((host as any).agentVersion || "").trim()) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "该主机尚未连接 ForwardX Agent" });
    }
    try {
      const { status } = enqueueNoBrandDiscoveryTask(input.hostId);
      pushAgentRefresh(input.hostId, "nobrand-provider-discovery");
      return status;
    } catch (error) {
      throw new TRPCError({
        code: "CONFLICT",
        message: error instanceof Error ? error.message : "NoBrand 扫描任务创建失败",
      });
    }
  }),

  status: adminProcedure.input(hostInput).query(async ({ input }) => {
    await requireHost(input.hostId);
    return getNoBrandDiscoveryStatus(input.hostId);
  }),

  clear: adminProcedure.input(hostInput).mutation(async ({ input }) => {
    await requireHost(input.hostId);
    return { success: clearNoBrandDiscoveryStatus(input.hostId) };
  }),
});
