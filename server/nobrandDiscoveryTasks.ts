import crypto from "crypto";

export type NoBrandDiscoveryTask = {
  taskId: string;
  createdAt: string;
};

export type NoBrandDiscoveryAgentResult = {
  taskId: string;
  success: boolean;
  installed: boolean;
  snapshot?: unknown;
  error?: string;
};

export type NoBrandDiscoveryStatus = {
  taskId: string;
  state: "queued" | "running" | "success" | "error" | "timeout";
  createdAt: string;
  updatedAt: string;
  installed?: boolean;
  snapshot?: unknown;
  error?: string;
};

type InternalState = NoBrandDiscoveryStatus & {
  expiresAt: number;
  timer?: NodeJS.Timeout;
};

const TASK_TIMEOUT_MS = 30_000;
const RESULT_RETENTION_MS = 5 * 60 * 1000;
const queues = new Map<number, NoBrandDiscoveryTask[]>();
const states = new Map<number, InternalState>();

function nowIso() {
  return new Date().toISOString();
}

function validHostId(value: unknown) {
  const id = Math.floor(Number(value));
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function publicStatus(state: InternalState): NoBrandDiscoveryStatus {
  const { expiresAt: _expiresAt, timer: _timer, ...status } = state;
  return { ...status };
}

function pruneExpired(now = Date.now()) {
  for (const [hostId, state] of states) {
    if ((state.state === "success" || state.state === "error" || state.state === "timeout") && state.expiresAt <= now) {
      if (state.timer) clearTimeout(state.timer);
      states.delete(hostId);
    }
  }
}

function markTimeout(hostId: number, taskId: string) {
  const state = states.get(hostId);
  if (!state || state.taskId !== taskId || state.state === "success" || state.state === "error") return;
  const updatedAt = nowIso();
  state.state = "timeout";
  state.updatedAt = updatedAt;
  state.error = "Agent 未在超时时间内回报 NoBrand 扫描结果";
  state.expiresAt = Date.now() + RESULT_RETENTION_MS;
  queues.delete(hostId);
}

/**
 * Create one on-demand, read-only NoBrand discovery request for a host.
 * Discovery results may contain credentials, so state is intentionally
 * ephemeral and never logged or persisted by this module.
 */
export function enqueueNoBrandDiscoveryTask(hostIdInput: number, timeoutMs = TASK_TIMEOUT_MS) {
  pruneExpired();
  const hostId = validHostId(hostIdInput);
  if (!hostId) throw new Error("NoBrand 扫描主机无效");
  const current = states.get(hostId);
  if (current && (current.state === "queued" || current.state === "running")) {
    throw new Error("该主机已有 NoBrand 扫描正在执行");
  }
  if (current?.timer) clearTimeout(current.timer);

  const createdAt = nowIso();
  const task: NoBrandDiscoveryTask = { taskId: crypto.randomUUID(), createdAt };
  queues.set(hostId, [task]);
  const safeTimeout = Math.max(5_000, Math.min(60_000, Math.floor(Number(timeoutMs) || TASK_TIMEOUT_MS)));
  const timer = setTimeout(() => markTimeout(hostId, task.taskId), safeTimeout);
  timer.unref?.();
  states.set(hostId, {
    taskId: task.taskId,
    state: "queued",
    createdAt,
    updatedAt: createdAt,
    expiresAt: Date.now() + safeTimeout + RESULT_RETENTION_MS,
    timer,
  });
  return { task, status: publicStatus(states.get(hostId)!) };
}

export function takeNoBrandDiscoveryTasks(hostIdInput: number, limit = 1) {
  pruneExpired();
  const hostId = validHostId(hostIdInput);
  if (!hostId) return [];
  const queue = queues.get(hostId) || [];
  const takeCount = Math.max(1, Math.min(2, Math.floor(Number(limit) || 1)));
  const tasks = queue.splice(0, takeCount);
  if (queue.length > 0) queues.set(hostId, queue);
  else queues.delete(hostId);
  if (tasks.length > 0) {
    const state = states.get(hostId);
    if (state && state.taskId === tasks[0].taskId && state.state === "queued") {
      state.state = "running";
      state.updatedAt = nowIso();
    }
  }
  return tasks;
}

export function hasQueuedNoBrandDiscoveryTasks(hostIdInput: number) {
  pruneExpired();
  const hostId = validHostId(hostIdInput);
  return !!hostId && (queues.get(hostId)?.length || 0) > 0;
}

export function completeNoBrandDiscoveryTask(hostIdInput: number, input: NoBrandDiscoveryAgentResult) {
  pruneExpired();
  const hostId = validHostId(hostIdInput);
  const state = hostId ? states.get(hostId) : undefined;
  const taskId = String(input?.taskId || "").trim();
  if (!state || !taskId || state.taskId !== taskId) return false;
  if (state.state === "success" || state.state === "error") return true;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = undefined;
  }
  state.state = input.success === true ? "success" : "error";
  state.updatedAt = nowIso();
  state.installed = input.success === true ? input.installed === true : undefined;
  // Keep the raw snapshot only in this short-lived in-memory state. The caller
  // must explicitly import selected nodes; discovery itself never writes DB.
  state.snapshot = input.success === true ? input.snapshot : undefined;
  state.error = input.success === true ? undefined : String(input.error || "NoBrand 扫描失败").slice(0, 1000);
  state.expiresAt = Date.now() + RESULT_RETENTION_MS;
  queues.delete(hostId);
  return true;
}

export function getNoBrandDiscoveryStatus(hostIdInput: number) {
  pruneExpired();
  const hostId = validHostId(hostIdInput);
  const state = hostId ? states.get(hostId) : undefined;
  return state ? publicStatus(state) : null;
}

export function clearNoBrandDiscoveryStatus(hostIdInput: number) {
  const hostId = validHostId(hostIdInput);
  if (!hostId) return false;
  const state = states.get(hostId);
  if (state?.timer) clearTimeout(state.timer);
  queues.delete(hostId);
  return states.delete(hostId);
}
