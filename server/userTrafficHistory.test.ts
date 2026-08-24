import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("daily user traffic history is exact, idempotent, and preserves older compact rows", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "forwardx-user-traffic-history-"));
  const databasePath = path.join(directory, "traffic-history.db");
  const script = String.raw`
    import assert from "node:assert/strict";
    import path from "node:path";
    import { pathToFileURL } from "node:url";

    const moduleUrl = (file) => pathToFileURL(path.join(process.cwd(), file)).href;
    const runtime = await import(moduleUrl("server/dbRuntime.ts"));
    const schema = await import(moduleUrl("server/dbSchema.ts"));
    const history = await import(moduleUrl("server/userTrafficHistory.ts"));
    const billing = await import(moduleUrl("shared/billingTime.ts"));

    await runtime.connectDatabase({ type: "sqlite", sqlite: { path: process.env.FORWARDX_TEST_DB } });
    await schema.ensureDatabaseSchema();

    await runtime.executeRaw(
      'INSERT INTO "users" ("id", "username", "password", "name", "role", "trafficUsed", "trafficLimit", "accountEnabled") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [1, "admin", "hash", "Admin", "admin", 0, 0, 1],
    );
    await runtime.executeRaw(
      'INSERT INTO "users" ("id", "username", "password", "name", "role", "trafficUsed", "trafficLimit", "accountEnabled") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [2, "alice", "hash", "Alice", "user", 999, 10000, 1],
    );
    await runtime.executeRaw(
      'INSERT INTO "users" ("id", "username", "password", "name", "role", "trafficUsed", "trafficLimit", "accountEnabled") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [3, "bob", "hash", "Bob", "user", 0, 0, 0],
    );

    const now = new Date();
    const today = billing.billingStartOfCalendarDay(now);
    const yesterday = billing.billingStartOfCalendarDay(today.getTime() - 24 * 60 * 60 * 1000);
    const threeDaysAgo = billing.billingStartOfCalendarDay(today.getTime() - 3 * 24 * 60 * 60 * 1000);
    const sec = (value) => Math.floor(value.getTime() / 1000);
    const bucketInsert = 'INSERT INTO "traffic_stat_buckets" ("bucketStart", "bucketMinutes", "userId", "ruleId", "hostId", "bytesIn", "bytesOut", "connections", "updatedAt") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)';

    await runtime.executeRaw(bucketInsert, [sec(yesterday) + 1800, 30, 2, 10, 1, 100, 200, 2, sec(now)]);
    await runtime.executeRaw(bucketInsert, [sec(yesterday) + 3600, 30, 2, 11, 1, 30, 70, 1, sec(now)]);
    await runtime.executeRaw(bucketInsert, [sec(today) + 1800, 30, 2, 10, 1, 40, 60, 3, sec(now)]);
    await runtime.executeRaw(bucketInsert, [sec(today) + 3600, 30, 3, 12, 1, 10, 20, 1, sec(now)]);

    await history.refreshUserTrafficDailyHistory({ force: true, now });
    const first = await history.getUserTrafficDailyHistory(7, now);
    assert.equal(first.users.length, 2, "admin is excluded from per-user history");
    const alice = first.users.find((row) => row.userId === 2);
    const bob = first.users.find((row) => row.userId === 3);
    assert.equal(alice.yesterday, 400);
    assert.equal(alice.today, 100);
    assert.equal(alice.periodTotal, 500);
    assert.equal(alice.trafficUsed, 999);
    assert.equal(alice.trafficLimit, 10000);
    assert.equal(bob.today, 30);
    assert.equal(bob.accountEnabled, false);

    // Re-running the exact rebuild must never double count.
    await history.refreshUserTrafficDailyHistory({ force: true, now });
    const second = await history.getUserTrafficDailyHistory(7, now);
    assert.equal(second.users.find((row) => row.userId === 2).periodTotal, 500);

    // A corrected/additional source bucket is reflected exactly on the next rebuild.
    await runtime.executeRaw(bucketInsert, [sec(today) + 5400, 30, 2, 13, 1, 5, 15, 1, sec(now)]);
    await history.refreshUserTrafficDailyHistory({ force: true, now });
    const corrected = await history.getUserTrafficDailyHistory(7, now);
    assert.equal(corrected.users.find((row) => row.userId === 2).today, 120);

    // Rows older than the two-day recompute window are compact history and survive.
    await runtime.executeRaw(
      'INSERT INTO user_traffic_daily (user_id, day_start, bytes_in, bytes_out, connections, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [2, sec(threeDaysAgo), 7, 13, 1, sec(now)],
    );
    await history.refreshUserTrafficDailyHistory({ force: true, now });
    const withOld = await history.getUserTrafficDailyHistory(7, now);
    const oldKey = historyDayKey(threeDaysAgo);
    const oldDay = withOld.users.find((row) => row.userId === 2).daily.find((row) => row.date === oldKey);
    assert.equal(oldDay.total, 20);

    const tables = await runtime.queryRaw("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_traffic_daily'");
    assert.equal(tables.length, 1);
    await runtime.closeDatabase();

    function historyDayKey(value) {
      const parts = billing.billingCalendarParts(value);
      return parts.year + '-' + String(parts.month).padStart(2, '0') + '-' + String(parts.day).padStart(2, '0');
    }
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
