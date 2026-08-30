import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { pushAgentRefresh } from "../agentEvents";
import { hostIngressAddress } from "../hostAddressRuntime";
import { planNoBrandCandidateImports } from "../nobrandProviderImport";
import { parseNoBrandProviderSnapshot } from "../nobrandProviderSnapshot";
import {
  clearNoBrandDiscoveryStatus,
  enqueueNoBrandDiscoveryTask,
  getNoBrandDiscoveryStatus,
} from "../nobrandDiscoveryTasks";

const hostInput = z.object({ hostId: z.number().int().positive() });
const importInput = hostInput.extend({
  candidateIds: z.array(z.string().trim().regex(/^[a-f0-9]{24}$/)).min(1).max(50),
});

async function requireHost(hostId: number) {
  const host = await db.getHostById(hostId);
  if (!host) {
    throw new TRPCError({ code: "NOT_FOUND", message: "主机不存在" });
  }
  return host;
}

async function resolveCandidates(hostId: number) {
  const host = await requireHost(hostId);
  const status = getNoBrandDiscoveryStatus(hostId);
  if (!status || status.state !== "success") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "请先完成 NoBrand 扫描" });
  }
  if (!status.installed || !status.snapshot) {
    return { host, status, candidates: [] };
  }
  const publicHost = hostIngressAddress(host);
  if (!publicHost) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "该主机没有可用于导入节点的公网地址" });
  }
  try {
    return {
      host,
      status,
      candidates: parseNoBrandProviderSnapshot(status.snapshot, publicHost),
    };
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error instanceof Error ? error.message : "NoBrand 扫描结果无法解析",
    });
  }
}

function importPlanOrBadRequest(input: Parameters<typeof planNoBrandCandidateImports>[0]) {
  try {
    return planNoBrandCandidateImports(input);
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error instanceof Error ? error.message : "NoBrand 候选节点无法导入",
    });
  }
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

  candidates: adminProcedure.input(hostInput).query(async ({ input }) => {
    const resolved = await resolveCandidates(input.hostId);
    return resolved.candidates;
  }),

  importCandidates: adminProcedure.input(importInput).mutation(async ({ ctx, input }) => {
    const resolved = await resolveCandidates(input.hostId);
    if (!resolved.status.installed || !resolved.status.snapshot) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "该主机未发现可导入的 NoBrand 安装" });
    }

    const existingEndpoints = await db.listProtocolEndpoints();
    const initialPlan = importPlanOrBadRequest({
      hostId: input.hostId,
      candidates: resolved.candidates,
      selectedCandidateIds: input.candidateIds,
      existingEndpoints,
    });

    const created: Array<{ candidateId: string; endpointId: number; name: string; protocol: string }> = [];
    const duplicates = [...initialPlan.duplicates];

    for (const planned of initialPlan.create) {
      // Re-check immediately before the write so a repeated click or a concurrent
      // import cannot create a second endpoint after the initial plan was built.
      const currentEndpoints = await db.listProtocolEndpoints();
      const livePlan = importPlanOrBadRequest({
        hostId: input.hostId,
        candidates: [planned.candidate],
        selectedCandidateIds: [planned.candidate.candidateId],
        existingEndpoints: currentEndpoints,
      });
      if (livePlan.duplicates.length > 0) {
        duplicates.push(...livePlan.duplicates);
        continue;
      }
      const live = livePlan.create[0];
      if (!live) continue;
      const nextSortOrder = currentEndpoints.reduce(
        (max: number, endpoint: any) => Math.max(max, Number(endpoint?.sortOrder) || 0),
        -1,
      ) + 1;
      const endpoint = await db.createProtocolEndpoint({
        name: live.candidate.name,
        protocol: live.candidate.protocol,
        runtimeMode: "external",
        hostId: null,
        forwardRuleId: null,
        publicHost: live.candidate.publicHost,
        publicPort: live.candidate.publicPort,
        configJson: live.config,
        isEnabled: true,
        sortOrder: nextSortOrder,
        createdByUserId: ctx.user.id,
      } as any);
      const endpointId = Number((endpoint as any)?.id || 0);
      if (!Number.isInteger(endpointId) || endpointId <= 0) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "NoBrand 节点已写入但无法确认端点 ID" });
      }
      created.push({
        candidateId: live.candidate.candidateId,
        endpointId,
        name: live.candidate.name,
        protocol: live.candidate.protocol,
      });
    }

    const duplicateMap = new Map(duplicates.map((duplicate) => [duplicate.candidateId, duplicate]));
    const uniqueDuplicates = Array.from(duplicateMap.values());
    return {
      created,
      duplicates: uniqueDuplicates,
      createdCount: created.length,
      duplicateCount: uniqueDuplicates.length,
    };
  }),

  clear: adminProcedure.input(hostInput).mutation(async ({ input }) => {
    await requireHost(input.hostId);
    return { success: clearNoBrandDiscoveryStatus(input.hostId) };
  }),
});
