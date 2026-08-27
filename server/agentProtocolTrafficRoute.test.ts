import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("protocol-only Agent traffic route accounts two Reality assignments exactly once", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "forwardx-protocol-traffic-route-"));
  const databasePath = path.join(directory, "protocol-traffic.db");
  const script = String.raw`
    import assert from "node:assert/strict";
    import http from "node:http";
    import path from "node:path";
    import { pathToFileURL } from "node:url";
    import express from "express";

    const url = (file) => pathToFileURL(path.join(process.cwd(), file)).href;
    const runtime = await import(url("server/dbRuntime.ts"));
    const schema = await import(url("server/dbSchema.ts"));
    const reports = await import(url("server/agentReportRoutes.ts"));

    let server;
    try {
      await runtime.connectDatabase({ type: "sqlite", sqlite: { path: process.env.FORWARDX_TEST_DB } });
      await schema.ensureDatabaseSchema();

      await runtime.executeRaw(
        'INSERT INTO "users" ("id", "username", "password", "name", "role", "trafficUsed") VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)',
        [
          1, "protocol-admin", "hash", "Protocol Admin", "admin", 0,
          2, "reality-user-a", "hash", "Reality User A", "user", 0,
          3, "reality-user-b", "hash", "Reality User B", "user", 0,
        ],
      );
      await runtime.executeRaw(
        'INSERT INTO "hosts" ("id", "name", "ip", "hostType", "agentToken", "userId") VALUES (?, ?, ?, ?, ?, ?)',
        [7, "xray-host", "127.0.0.7", "slave", "xray-route-token", 1],
      );
      await runtime.executeRaw(
        'INSERT INTO "protocol_endpoints" ("id", "name", "protocol", "runtimeMode", "hostId", "publicHost", "publicPort", "configJson", "isEnabled") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [22, "Shared Reality", "vless_reality", "managed", 7, "edge.example.test", 27075, "{}", 1],
      );
      await runtime.executeRaw(
        'INSERT INTO "protocol_user_access" ("id", "endpointId", "userId", "credentialJson", "isEnabled") VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)',
        [501, 22, 2, '{"uuid":"11111111-1111-4111-8111-111111111111"}', 1, 502, 22, 3, '{"uuid":"22222222-2222-4222-8222-222222222222"}', 1],
      );

      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        const authorization = String(req.headers.authorization || "");
        req.agentToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
        next();
      });
      reports.registerAgentReportRoutes(app);
      server = http.createServer(app);
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const endpoint = "http://127.0.0.1:" + address.port + "/api/agent/traffic";
      const payload = {
        stats: [],
        protocolStats: [
          { assignmentId: 501, bytesIn: 100, bytesOut: 900 },
          { assignmentId: 502, bytesIn: 200, bytesOut: 1800 },
        ],
        reportId: "xray-two-users-1",
        reportProducerId: "xray-agent-boot-1",
      };

      const post = async () => {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            authorization: "Bearer xray-route-token",
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        return { status: response.status, body: await response.json() };
      };

      const first = await post();
      assert.equal(first.status, 200);
      assert.equal(first.body.success, true);
      assert.notEqual(first.body.duplicate, true);

      const bucketsAfterFirst = await runtime.queryRaw(
        'SELECT assignment_id AS assignmentId, endpoint_id AS endpointId, user_id AS userId, host_id AS hostId, bytes_in AS bytesIn, bytes_out AS bytesOut FROM protocol_user_traffic_buckets ORDER BY assignment_id',
      );
      assert.deepEqual(bucketsAfterFirst, [
        { assignmentId: 501, endpointId: 22, userId: 2, hostId: 7, bytesIn: 100, bytesOut: 900 },
        { assignmentId: 502, endpointId: 22, userId: 3, hostId: 7, bytesIn: 200, bytesOut: 1800 },
      ]);
      assert.deepEqual(
        await runtime.queryRaw('SELECT id, "trafficUsed" AS trafficUsed FROM users WHERE id IN (?, ?) ORDER BY id', [2, 3]),
        [
          { id: 2, trafficUsed: 1000 },
          { id: 3, trafficUsed: 2000 },
        ],
      );

      const duplicate = await post();
      assert.deepEqual(duplicate, { status: 200, body: { success: true, duplicate: true } });
      assert.deepEqual(
        await runtime.queryRaw('SELECT id, "trafficUsed" AS trafficUsed FROM users WHERE id IN (?, ?) ORDER BY id', [2, 3]),
        [
          { id: 2, trafficUsed: 1000 },
          { id: 3, trafficUsed: 2000 },
        ],
      );
      assert.equal(
        Number((await runtime.queryRaw('SELECT COUNT(*) AS count FROM agent_traffic_reports WHERE "hostId" = ? AND "reportId" = ?', [7, "xray-two-users-1"]))[0].count),
        1,
      );
    } finally {
      if (server) await new Promise((resolve) => server.close(resolve));
      await runtime.disconnectDatabase?.();
    }
  `;

  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_TYPE: "sqlite",
      SQLITE_PATH: databasePath,
      FORWARDX_TEST_DB: databasePath,
    },
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(result.status, 0, `child failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
});
