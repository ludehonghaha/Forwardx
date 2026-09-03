import assert from "node:assert/strict";
import test from "node:test";
import {
  clearDualPilotTaskStatus,
  completeDualPilotTask,
  enqueueDualPilotTask,
  getDualPilotTaskStatus,
  isDualPilotAction,
  takeDualPilotTasks,
} from "./dualPilotTasks";

test("Dual Pilot accepts only the fixed lifecycle allowlist", () => {
  assert.equal(isDualPilotAction("start"), true);
  assert.equal(isDualPilotAction("stop"), true);
  assert.equal(isDualPilotAction("status"), true);
  assert.equal(isDualPilotAction("validate"), false);
  assert.equal(isDualPilotAction("cleanup"), false);
  assert.equal(isDualPilotAction("start; rm -rf /"), false);
  assert.throws(() => enqueueDualPilotTask(101, "start; rm -rf /"), /不支持的 Dual Pilot 操作/);
});

test("queued task contains no executable path role arguments or shell text", () => {
  clearDualPilotTaskStatus(102);
  const { task } = enqueueDualPilotTask(102, "start");
  assert.deepEqual(Object.keys(task).sort(), ["action", "createdAt", "taskId"]);
  const serialized = JSON.stringify(task);
  assert.doesNotMatch(serialized, /executable|entry|arguments|workingDirectory|shell|role/i);
  const taken = takeDualPilotTasks(102, 1);
  assert.equal(taken.length, 1);
  assert.equal(getDualPilotTaskStatus(102)?.state, "running");
  clearDualPilotTaskStatus(102);
});

test("result must match both task id and action", () => {
  clearDualPilotTaskStatus(103);
  const { task } = enqueueDualPilotTask(103, "status");
  takeDualPilotTasks(103, 1);
  assert.equal(completeDualPilotTask(103, {
    taskId: task.taskId,
    action: "start",
    success: true,
  }), false);
  assert.equal(getDualPilotTaskStatus(103)?.state, "running");
  assert.equal(completeDualPilotTask(103, {
    taskId: task.taskId,
    action: "status",
    success: true,
    output: "server: stopped",
    exitCode: 0,
  }), true);
  const status = getDualPilotTaskStatus(103);
  assert.equal(status?.state, "success");
  assert.equal(status?.output, "server: stopped");
  clearDualPilotTaskStatus(103);
});

test("only one Pilot action can be in flight for a host", () => {
  clearDualPilotTaskStatus(104);
  enqueueDualPilotTask(104, "start");
  assert.throws(() => enqueueDualPilotTask(104, "stop"), /已有 Dual Pilot 操作正在执行/);
  clearDualPilotTaskStatus(104);
});
