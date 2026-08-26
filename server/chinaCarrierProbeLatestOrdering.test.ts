import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("carrier overview chooses latest recordedAt even when an older stat is inserted later", () => {
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

      const now = Math.floor(Date.now() / 1000);
      const insert = (latencyMs, recordedAt) => runtime.executeRaw(
        'INSERT INTO "host_probe_service_stats" ("serviceId", "hostId", "latencyMs", "isTimeout", "successCount", "lossCount", "packetLossPermille", "recordedAt") VALUES (?, ?, ?, 0, 5, 0, 0, ?)',
        [serviceId, 1, latencyMs, recordedAt],
      );

      await insert(105, now - 10);
      // Simulate a delayed/out-of-order write: larger row id, older observation time.
      await insert(999, now - 120);

      const overview = await carrier.getChinaCarrierProbeOverview(now * 1000);
      const item = overview.find((host) => host.hostId === 1)?.carriers.cm.find((probe) => probe.serviceId === serviceId);
      assert.ok(item);
      assert.equal(item.latencyMs, 105);
      assert.equal(item.state, "ok");
      assert.equal(Math.floor(item.recordedAt.getTime() / 1000), now - 10);
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
