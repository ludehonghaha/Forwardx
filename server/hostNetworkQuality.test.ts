import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("host network quality stores RTT, loss, no-data and time aggregation without fabricating legacy loss", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "forwardx-host-network-quality-"));
  const databasePath = path.join(directory, "quality.db");
  const script = String.raw`
    import assert from "node:assert/strict";
    import path from "node:path";
    import { pathToFileURL } from "node:url";

    const moduleUrl = (file) => pathToFileURL(path.join(process.cwd(), file)).href;
    const runtime = await import(moduleUrl("server/dbRuntime.ts"));
    const schema = await import(moduleUrl("server/dbSchema.ts"));
    const quality = await import(moduleUrl("server/repositories/hostNetworkQualityRepository.ts"));
    const services = await import(moduleUrl("server/repositories/hostProbeServiceRepository.ts"));
    const agentDtos = await import(moduleUrl("shared/agentDtos.ts"));

    await runtime.connectDatabase({ type: "sqlite", sqlite: { path: process.env.FORWARDX_TEST_DB } });
    await runtime.executeRaw('CREATE TABLE host_probe_service_stats (id INTEGER PRIMARY KEY AUTOINCREMENT, serviceId INTEGER NOT NULL, hostId INTEGER NOT NULL, latencyMs INTEGER, isTimeout INTEGER NOT NULL DEFAULT 0, recordedAt INTEGER NOT NULL)');
    await schema.ensureDatabaseSchema();

    const serviceColumns = await runtime.queryRaw('PRAGMA table_info("host_probe_service_stats")');
    assert.ok(serviceColumns.some((column) => column.name === "successCount"));
    assert.ok(serviceColumns.some((column) => column.name === "lossCount"));
    assert.ok(serviceColumns.some((column) => column.name === "packetLossPermille"));
    const qualityTables = await runtime.queryRaw("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'host_network_quality_stats'");
    assert.equal(qualityTables.length, 1);

    const now = Math.floor(Date.now() / 1000);
    const base = Math.floor(now / 60) * 60;
    const insert = (sql, values) => runtime.executeRaw(sql, values);
    await insert('INSERT INTO "host_network_quality_stats" ("hostId", "latencyMs", "successCount", "lossCount", "packetLossPermille", "recordedAt") VALUES (?, ?, ?, ?, ?, ?)', [1, 20, 5, 0, 0, base - 120]);
    await insert('INSERT INTO "host_network_quality_stats" ("hostId", "latencyMs", "successCount", "lossCount", "packetLossPermille", "recordedAt") VALUES (?, ?, ?, ?, ?, ?)', [1, 40, 3, 2, 400, base - 110]);
    await insert('INSERT INTO "host_network_quality_stats" ("hostId", "latencyMs", "successCount", "lossCount", "packetLossPermille", "recordedAt") VALUES (?, ?, ?, ?, ?, ?)', [1, null, 0, 5, 1000, base - 60]);
    await insert('INSERT INTO "host_network_quality_stats" ("hostId", "latencyMs", "successCount", "lossCount", "packetLossPermille", "recordedAt") VALUES (?, ?, ?, ?, ?, ?)', [2, 15, 5, 0, 0, base - 30]);

    assert.deepEqual(await quality.getHostNetworkQualitySeries({ hostId: 99, hours: 1 }), [], "no-data remains empty");
    const series = await quality.getHostNetworkQualitySeries({ hostId: 1, hours: 1 });
    assert.equal(series.length, 2);
    assert.equal(series[0].latencyMs, 28, "latency is weighted by successful samples");
    assert.equal(series[0].successCount, 8);
    assert.equal(series[0].lossCount, 2);
    assert.equal(series[0].packetLossPercent, 20.0);
    assert.equal(series[1].latencyMs, null);
    assert.equal(series[1].packetLossPercent, 100.0);
    const latest = await quality.getLatestHostNetworkQualityStats([1, 2, 99]);
    assert.equal(latest.find((row) => row.hostId === 1)?.latencyMs, null);
    assert.equal(latest.find((row) => row.hostId === 1)?.packetLossPercent, 100.0);
    assert.equal(latest.find((row) => row.hostId === 2)?.packetLossPercent, 0.0);
    assert.equal(quality.normalizeHostNetworkQualityWindow({ hostId: 1, successCount: 0, lossCount: 0 }), null);
    assert.equal(quality.normalizeHostNetworkQualityWindow({ hostId: 1, successCount: 1, lossCount: 0, latencyMs: null }), null);
    assert.equal(agentDtos.isAgentHostNetworkQualityResult({ latencyMs: 20, successCount: 5, lossCount: 0, packetLossPercent: 0 }), true);
    assert.equal(agentDtos.isAgentHostNetworkQualityResult({ latencyMs: 20, successCount: 3, lossCount: 2, packetLossPercent: 40 }), true);
    assert.equal(agentDtos.isAgentHostNetworkQualityResult({ latencyMs: null, successCount: 0, lossCount: 5, packetLossPercent: 100 }), true);
    assert.equal(agentDtos.isAgentHostNetworkQualityResult({ latencyMs: null, successCount: 0, lossCount: 0 }), false, "no-data is not a loss report");

    await insert('INSERT INTO "host_probe_service_stats" ("serviceId", "hostId", "latencyMs", "isTimeout", "successCount", "lossCount", "packetLossPermille", "recordedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [10, 1, 30, 0, 3, 2, 400, base - 120]);
    await insert('INSERT INTO "host_probe_service_stats" ("serviceId", "hostId", "latencyMs", "isTimeout", "recordedAt") VALUES (?, ?, ?, ?, ?)', [10, 1, 50, 0, base - 110]);
    await insert('INSERT INTO "host_probe_service_stats" ("serviceId", "hostId", "latencyMs", "isTimeout", "successCount", "lossCount", "packetLossPermille", "recordedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [11, 1, null, 1, 0, 1, 1000, base - 60]);
    await insert('INSERT INTO "host_probe_service_stats" ("serviceId", "hostId", "latencyMs", "isTimeout", "recordedAt") VALUES (?, ?, ?, ?, ?)', [12, 1, null, 1, base - 60]);
    const serviceSeries = await services.getHostProbeServiceSeries({ serviceIds: [10, 11, 12], hostId: 1, hours: 1 });
    assert.equal(serviceSeries.find((row) => row.serviceId === 10)?.packetLossPercent, 40.0);
    assert.equal(serviceSeries.find((row) => row.serviceId === 11)?.packetLossPercent, 100.0);
    assert.equal(serviceSeries.find((row) => row.serviceId === 12)?.packetLossPercent, null, "legacy timeout without counts is no loss data");

    await runtime.closeDatabase();
  `;

  try {
    const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_TYPE: "sqlite",
        FORWARDX_TEST_DB: databasePath,
        FORWARDX_LOG_DIR: path.join(directory, "logs"),
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
