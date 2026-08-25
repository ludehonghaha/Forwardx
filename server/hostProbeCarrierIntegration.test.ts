import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("carrier probe schema upgrades legacy services and preserves the old Agent task wire shape", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "forwardx-carrier-probes-"));
  const databasePath = path.join(directory, "carrier-probes.db");
  const script = String.raw`
    import assert from "node:assert/strict";
    import path from "node:path";
    import { pathToFileURL } from "node:url";

    const moduleUrl = (file) => pathToFileURL(path.join(process.cwd(), file)).href;
    const runtime = await import(moduleUrl("server/dbRuntime.ts"));
    const schema = await import(moduleUrl("server/dbSchema.ts"));
    await runtime.connectDatabase({ type: "sqlite", sqlite: { path: process.env.FORWARDX_TEST_DB } });

    try {
      // Reproduce the pre-P0-2A table shape before ensureDatabaseSchema() runs.
      await runtime.executeRaw(
        'CREATE TABLE "host_probe_services" (' +
          '"id" INTEGER PRIMARY KEY AUTOINCREMENT,' +
          '"name" TEXT NOT NULL,' +
          '"method" TEXT NOT NULL DEFAULT \'tcping\',' +
          '"targetIp" TEXT NOT NULL,' +
          '"targetPort" INTEGER,' +
          '"hostScope" TEXT NOT NULL DEFAULT \'all\',' +
          '"hostIds" TEXT,' +
          '"excludeHostIds" TEXT,' +
          '"intervalSeconds" INTEGER NOT NULL DEFAULT 30,' +
          '"isEnabled" INTEGER NOT NULL DEFAULT 1,' +
          '"sortOrder" INTEGER NOT NULL DEFAULT 0,' +
          '"userId" INTEGER NOT NULL,' +
          '"createdAt" INTEGER NOT NULL DEFAULT (unixepoch()),' +
          '"updatedAt" INTEGER NOT NULL DEFAULT (unixepoch())' +
        ')',
      );
      await runtime.executeRaw(
        'INSERT INTO "host_probe_services" ("name", "method", "targetIp", "targetPort", "hostScope", "intervalSeconds", "isEnabled", "userId") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ["legacy custom", "tcping", "legacy.example.test", 443, "all", 30, 1, 1],
      );

      await schema.ensureDatabaseSchema();

      const probeColumns = await runtime.queryRaw('PRAGMA table_info("host_probe_services")');
      const probeColumnNames = new Set(probeColumns.map((column) => String(column.name)));
      for (const required of ["probeKind", "carrier", "region"]) {
        assert.ok(probeColumnNames.has(required), "missing upgraded column " + required);
      }

      const statsIndexes = await runtime.queryRaw('PRAGMA index_list("host_probe_service_stats")');
      let foundPairIndex = false;
      for (const index of statsIndexes) {
        const info = await runtime.queryRaw('PRAGMA index_info("' + String(index.name).replaceAll('"', '""') + '")');
        const columns = info.map((item) => String(item.name));
        if (columns.join("|") === "serviceId|hostId|recordedAt") foundPairIndex = true;
      }
      assert.equal(foundPairIndex, true, "missing serviceId+hostId+recordedAt probe stats index");

      const probes = await import(moduleUrl("server/repositories/hostProbeServiceRepository.ts"));
      const carrier = await import(moduleUrl("server/repositories/chinaCarrierProbeRepository.ts"));

      const legacy = (await probes.getHostProbeServices()).find((service) => service.name === "legacy custom");
      assert.ok(legacy);
      assert.equal(legacy.probeKind, "custom");
      assert.equal(legacy.carrier, null);
      assert.equal(legacy.region, null);

      await runtime.executeRaw('INSERT INTO "hosts" ("id", "name", "ip", "userId") VALUES (?, ?, ?, ?)', [1, "host one", "198.51.100.1", 1]);
      await runtime.executeRaw('INSERT INTO "hosts" ("id", "name", "ip", "userId") VALUES (?, ?, ?, ?)', [2, "host two", "198.51.100.2", 1]);

      const shanghaiId = await probes.createHostProbeService({
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
      const guangzhouId = await probes.createHostProbeService({
        name: "CM Guangzhou",
        method: "tcping",
        targetIp: "cm-gz.example.test",
        targetPort: 443,
        hostScope: "all",
        intervalSeconds: 60,
        probeKind: "china_carrier",
        carrier: "cm",
        region: "Guangzhou",
        userId: 1,
      });
      const telecomId = await probes.createHostProbeService({
        name: "CT Beijing",
        method: "ping",
        targetIp: "ct-bj.example.test",
        hostScope: "specific",
        hostIds: [1],
        intervalSeconds: 60,
        probeKind: "china_carrier",
        carrier: "ct",
        region: "Beijing",
        userId: 1,
      });

      const shanghai = await probes.getHostProbeServiceById(shanghaiId);
      assert.equal(shanghai.probeKind, "china_carrier");
      assert.equal(shanghai.carrier, "cm");
      assert.equal(shanghai.region, "Shanghai");

      const tasks = await probes.getHostProbeTasksForHost(1);
      const shanghaiTask = tasks.find((task) => Number(task.serviceId) === shanghaiId);
      assert.deepEqual(shanghaiTask, {
        serviceId: shanghaiId,
        method: "ping",
        targetIp: "cm-sh.example.test",
        targetPort: 0,
        intervalSeconds: 60,
      });
      assert.deepEqual(Object.keys(shanghaiTask).sort(), ["intervalSeconds", "method", "serviceId", "targetIp", "targetPort"]);
      assert.equal("probeKind" in shanghaiTask, false);
      assert.equal("carrier" in shanghaiTask, false);
      assert.equal("region" in shanghaiTask, false);

      const hostTwoTasks = await probes.getHostProbeTasksForHost(2);
      assert.equal(hostTwoTasks.some((task) => Number(task.serviceId) === telecomId), false, "specific host scope leaked to another host");

      const now = Math.floor(Date.now() / 1000);
      const addStat = (serviceId, hostId, latencyMs, isTimeout, successCount, lossCount, packetLossPermille, recordedAt) => runtime.executeRaw(
        'INSERT INTO "host_probe_service_stats" ("serviceId", "hostId", "latencyMs", "isTimeout", "successCount", "lossCount", "packetLossPermille", "recordedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [serviceId, hostId, latencyMs, isTimeout ? 1 : 0, successCount, lossCount, packetLossPermille, recordedAt],
      );

      await addStat(shanghaiId, 1, 100, false, 5, 0, 0, now - 90);
      await addStat(shanghaiId, 1, 110, false, 5, 0, 0, now - 60);
      await addStat(shanghaiId, 1, 105, false, 5, 0, 0, now - 30);
      await addStat(shanghaiId, 2, 200, false, 5, 0, 0, now - 60);
      await addStat(shanghaiId, 2, 210, false, 5, 0, 0, now - 30);
      await addStat(guangzhouId, 1, null, true, 0, 5, 1000, now - 20);

      const overview = await carrier.getChinaCarrierProbeOverview(now * 1000);
      const hostOne = overview.find((host) => host.hostId === 1);
      const hostTwo = overview.find((host) => host.hostId === 2);
      assert.ok(hostOne);
      assert.ok(hostTwo);

      assert.equal(hostOne.carriers.cm.length, 2, "same carrier targets were aggregated or lost");
      const shanghaiOne = hostOne.carriers.cm.find((item) => item.serviceId === shanghaiId);
      const guangzhouOne = hostOne.carriers.cm.find((item) => item.serviceId === guangzhouId);
      assert.ok(shanghaiOne);
      assert.ok(guangzhouOne);
      assert.equal(shanghaiOne.latencyMs, 105);
      assert.equal(shanghaiOne.jitterMs, 8);
      assert.equal(shanghaiOne.packetLossPercent, 0);
      assert.equal(shanghaiOne.state, "ok");
      assert.equal(guangzhouOne.latencyMs, null, "timeout must not be represented as 0 ms");
      assert.equal(guangzhouOne.jitterMs, null);
      assert.equal(guangzhouOne.packetLossPercent, 100);
      assert.equal(guangzhouOne.state, "timeout");

      const shanghaiTwo = hostTwo.carriers.cm.find((item) => item.serviceId === shanghaiId);
      assert.ok(shanghaiTwo);
      assert.equal(shanghaiTwo.latencyMs, 210, "latest data crossed host boundaries");
      assert.equal(shanghaiTwo.jitterMs, 10);
      assert.equal(hostTwo.carriers.ct.length, 0, "carrier service host scope leaked into overview");
    } finally {
      await runtime.closeDatabase();
    }
  `;

  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", script],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_TYPE: "sqlite",
        FORWARDX_TEST_DB: databasePath,
      },
      encoding: "utf8",
    },
  );

  try {
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
