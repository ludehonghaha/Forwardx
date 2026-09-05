import crypto from "crypto";

export const dualPilotActions = ["start", "stop", "status"] as const;
export type DualPilotAction = (typeof dualPilotActions)[number];

export type DualPilotTask = {
  taskId: string;
  action: DualPilotAction;
  createdAt: string;
};

export type DualPilotAgentResult = {
  taskId: string;
  action: DualPilotAction;
  success: boolean;
  output?: string;
  error?: string;
  exitCode?: number;
  timedOut?: boolean;
  updatedAt?: string;
};

export type DualPilotTaskStatus = {
  taskId: string;
  action: DualPilotAction;
  state: "queued" | "running" | "success" | "error" | "timeout";
  createdAt: string;
  updatedAt: string;
  output?: string;
  error?: string;
  exitCode?: number;
  timedOut?: boolean;
};

type InternalState = DualPilotTaskStatus & {
  expiresAt: number;
  timer?: NodeJS.Timeout;
};

const TASK_TIMEOUT_MS = 45_000;
const RESULT_RETENTION_MS = 5 * 60 * 1000;
const MAX_RESULT_TEXT = 16 * 1024;
const queues = new Map<number, DualPilotTask[]>();
const states = new Map<number, InternalState>();

function nowIso() {
  return new Date().toISOString();
}

function validHostId(value: unknown) {
  const id = Math.floor(Number(value));
  return Number.isInteger(id) && id > 0 ? id : 0;
}

export function isDualPilotAction(value: unknown): value is DualPilotAction {
  return value === "start" || value === "stop" || value === "status";
}

function boundedText(value: unknown) {
  return String(value || "").slice(0, MAX_RESULT_TEXT);
}

function publicStatus(state: InternalState): DualPilotTaskStatus {
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
  state.state = "timeout";
  state.updatedAt = nowIso();
  state.error = "Agent 未在超时时间内回报 Dual Pilot 结果";
  state.timedOut = true;
  state.expiresAt = Date.now() + RESULT_RETENTION_MS;
  queues.delete(hostId);
}

/**
 * Queue one strictly allowlisted Pilot lifecycle action for one Agent host.
 * The task intentionally contains no executable, path, role, arguments or
 * shell text. Those values are fixed on the Agent side.
 */
export function enqueueDualPilotTask(hostIdInput: number, actionInput: unknown, timeoutMs = TASK_TIMEOUT_MS) {
  pruneExpired();
  const hostId = validHostId(hostIdInput);
  if (!hostId) throw new Error("Dual Pilot 主机无效");
  if (!isDualPilotAction(actionInput)) throw new Error("不支持的 Dual Pilot 操作");

  const current = states.get(hostId);
  if (current && (current.state === "queued" || current.state === "running")) {
    throw new Error("该主机已有 Dual Pilot 操作正在执行");
  }
  if (current?.timer) clearTimeout(current.timer);

  const createdAt = nowIso();
  const task: DualPilotTask = {
    taskId: crypto.randomUUID(),
    action: actionInput,
    createdAt,
  };
  queues.set(hostId, [task]);
  const safeTimeout = Math.max(10_000, Math.min(60_000, Math.floor(Number(timeoutMs) || TASK_TIMEOUT_MS)));
  const timer = setTimeout(() => markTimeout(hostId, task.taskId), safeTimeout);
  timer.unref?.();
  states.set(hostId, {
    taskId: task.taskId,
    action: task.action,
    state: "queued",
    createdAt,
    updatedAt: createdAt,
    expiresAt: Date.now() + safeTimeout + RESULT_RETENTION_MS,
    timer,
  });
  return { task, status: publicStatus(states.get(hostId)!) };
}

export function takeDualPilotTasks(hostIdInput: number, limit = 1) {
  pruneExpired();
  const hostId = validHostId(hostIdInput);
  if (!hostId) return [];
  const queue = queues.get(hostId) || [];
  const takeCount = Math.max(1, Math.min(1, Math.floor(Number(limit) || 1)));
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

export function completeDualPilotTask(hostIdInput: number, input: DualPilotAgentResult) {
  pruneExpired();
  const hostId = validHostId(hostIdInput);
  const state = hostId ? states.get(hostId) : undefined;
  const taskId = String(input?.taskId || "").trim();
  if (!state || !taskId || state.taskId !== taskId || state.action !== input?.action) return false;
  if (state.state === "success" || state.state === "error") return true;
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = undefined;
  }
  state.state = input.success === true ? "success" : "error";
  state.updatedAt = nowIso();
  state.output = input.output ? boundedText(input.output) : undefined;
  state.error = input.success === true ? undefined : boundedText(input.error || "Dual Pilot 操作失败");
  state.exitCode = Number.isInteger(input.exitCode) ? input.exitCode : undefined;
  state.timedOut = input.timedOut === true;
  state.expiresAt = Date.now() + RESULT_RETENTION_MS;
  queues.delete(hostId);
  return true;
}

export function getDualPilotTaskStatus(hostIdInput: number) {
  pruneExpired();
  const hostId = validHostId(hostIdInput);
  const state = hostId ? states.get(hostId) : undefined;
  return state ? publicStatus(state) : null;
}

export function clearDualPilotTaskStatus(hostIdInput: number) {
  const hostId = validHostId(hostIdInput);
  if (!hostId) return false;
  const state = states.get(hostId);
  if (state?.timer) clearTimeout(state.timer);
  queues.delete(hostId);
  return states.delete(hostId);
}
