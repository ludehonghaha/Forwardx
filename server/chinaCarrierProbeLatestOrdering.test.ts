import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("carrier overview orders by recorded time, uses latest ten jitter samples, and hides timeout zero latency", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "forwardx-carrier-latest-"));
  const databasePath = path.join(directory, "carrier-latest.db");
  const script = String.raw`
    import assert from "node:assert/strict";
    import path from "node:path";
    import { pathToFileURL } from "node:url";

    const moduleUrl = (file) => pathToFileURL(path.join(process.cwd(), file)).href;
    const runtime = await import(moduleUrl("server/dbRuntime.ts"));
    const schema = await import(moduleUrl("server/dbSchema.ts"));
    const probes = await import(moduleUrl("server/repositories/hostProbeServiceRepository.ts"));
    const carrier = await import(moduleUrl("server/repositories/chinaCarrierProbeRepository.ts"));

    await runtime.connectDatabase({ type: "sqlite", sqlite: { path: process.env.FORWARDX_TEST_DB } });
    try {
      await schema.ensureDatabaseSchema();
      await runtime.executeRaw('INSERT INTO "users" ("id", "username", "passwordHash", "role") VALUES (?, ?, ?, ?)', [1, "admin", "x", "admin"]);
      await runtime.executeRaw('INSERT INTO "hosts" ("id", "name", "ip", "userId") VALUES (?, ?, ?, ?)', [1, "host one", "198.51.100.1", 1]);

      const serviceId = await probes.createHostProbeService({
        name: "CM Shanghai",
        method: "ping",
        targetIp: "cm-sh.example.test",
        hostScope: "all",
        intervalSeconds: 60,
        probeKind: "china_carrier",
        carrier: "cm",
        region: "Shanghai",
        userId: 1,
      });
      const jitterServiceId = await probes.createHostProbeService({
        name: "CU Shanghai",
        method: "ping",
        targetIp: "cu-sh.example.test",
        hostScope: "all",
        intervalSeconds: 60,
        probeKind: "china_carrier",
        carrier: "cu",
        region: "Shanghai",
        userId: 1,
      });

      const now = Math.floor(Date.now() / 1000);
      const insertSuccess = (targetServiceId, latencyMs, recordedAt) => runtime.executeRaw(
        'INSERT INTO "host_probe_service_stats" ("serviceId", "hostId", "latencyMs", "isTimeout", "successCount", "lossCount", "packetLossPermille", "recordedAt") VALUES (?, ?, ?, 0, 5, 0, 0, ?)',
        [targetServiceId, 1, latencyMs, recordedAt],
      );

      await insertSuccess(serviceId, 105, now - 10);
      // Simulate a delayed/out-of-order write: larger row id, older observation time.
      await insertSuccess(serviceId, 999, now - 120);

      let overview = await carrier.getChinaCarrierProbeOverview(now * 1000);
      let item = overview.find((host) => host.hostId === 1)?.carriers.cm.find((probe) => probe.serviceId === serviceId);
      assert.ok(item);
      assert.equal(item.latencyMs, 105);
      assert.equal(item.state, "ok");
      assert.equal(Math.floor(item.recordedAt.getTime() / 1000), now - 10);

      // The oldest outlier is the 11th successful sample and must not influence
      // jitter. The latest ten successes rise by exactly 1 ms each, so jitter=1.
      await insertSuccess(jitterServiceId, 1000, now - 110);
      for (let index = 0; index < 10; index += 1) {
        await insertSuccess(jitterServiceId, 100 + index, now - (100 - index * 10));
      }
      overview = await carrier.getChinaCarrierProbeOverview(now * 1000);
      const jitterItem = overview.find((host) => host.hostId === 1)?.carriers.cu.find((probe) => probe.serviceId === jitterServiceId);
      assert.ok(jitterItem);
      assert.equal(jitterItem.latencyMs, 109);
      assert.equal(jitterItem.jitterMs, 1);

      // Agent wire uses 0 as the timeout latency sentinel. Even if such a row reaches
      // storage, the carrier overview contract must expose no numeric timeout latency.
      await runtime.executeRaw(
        'INSERT INTO "host_probe_service_stats" ("serviceId", "hostId", "latencyMs", "isTimeout", "successCount", "lossCount", "packetLossPermille", "recordedAt") VALUES (?, ?, 0, 1, 0, 5, 1000, ?)',
        [serviceId, 1, now],
      );
      overview = await carrier.getChinaCarrierProbeOverview(now * 1000);
      item = overview.find((host) => host.hostId === 1)?.carriers.cm.find((probe) => probe.serviceId === serviceId);
      assert.ok(item);
      assert.equal(item.state, "timeout");
      assert.equal(item.isTimeout, true);
      assert.equal(item.latencyMs, null);
      assert.equal(item.packetLossPercent, 100);
    } finally {
      await runtime.closeDatabase();
    }
  `;

  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_TYPE: "sqlite", FORWARDX_TEST_DB: databasePath },
      encoding: "utf8",
    },
  );

  try {
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
