import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import Database from "better-sqlite3";

const root = process.cwd();
const dbPath = path.join(root, ".dev", "forwardx-dev.db");
const apiBase = "http://127.0.0.1:3000";
const DUAL_TOKEN = "d".repeat(64);
const IPV4_ONLY_TOKEN = "4".repeat(64);
const DUAL_ENDPOINT_NAME = "IPv6 gray dual-stack SS";
const IPV4_ONLY_ENDPOINT_NAME = "IPv6 gray IPv4-only SS";

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(400, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(port, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await canConnect(port)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`ForwardX dev panel did not become ready on port ${port}`);
}

function seedGrayProtocolData() {
  const db = new Database(dbPath);
  try {
    const admin = db.prepare("SELECT id FROM users WHERE username = ?").get("dev.admin@forwardx.local");
    const dualUser = db.prepare("SELECT id FROM users WHERE username = ?").get("edge.user@forwardx.local");
    const ipv4OnlyUser = db.prepare("SELECT id FROM users WHERE username = ?").get("billing.pause@forwardx.local");
    const dualHost = db.prepare("SELECT id, ipv6 FROM hosts WHERE name = ?").get("JP exit 02");
    const ipv4OnlyHost = db.prepare("SELECT id, ipv6 FROM hosts WHERE name = ?").get("HK entry 01");

    assert.ok(admin?.id, "dev admin seed missing");
    assert.ok(dualUser?.id, "active dev user seed missing");
    assert.ok(ipv4OnlyUser?.id, "IPv4-only dev user seed missing");
    assert.ok(dualHost?.id, "dual-stack dev host missing");
    assert.equal(String(dualHost.ipv6 || ""), "2001:db8:10::41d", "dual-stack dev host IPv6 changed unexpectedly");
    assert.ok(ipv4OnlyHost?.id, "IPv4-only dev host missing");
    assert.equal(String(ipv4OnlyHost.ipv6 || ""), "", "IPv4-only dev host unexpectedly has IPv6");

    const now = Math.floor(Date.now() / 1000);
    const removeExisting = db.transaction(() => {
      const rows = db.prepare("SELECT id FROM protocol_endpoints WHERE name IN (?, ?)")
        .all(DUAL_ENDPOINT_NAME, IPV4_ONLY_ENDPOINT_NAME);
      for (const row of rows) {
        db.prepare("DELETE FROM protocol_user_access WHERE endpointId = ?").run(row.id);
      }
      db.prepare("DELETE FROM protocol_endpoints WHERE name IN (?, ?)")
        .run(DUAL_ENDPOINT_NAME, IPV4_ONLY_ENDPOINT_NAME);
      db.prepare("DELETE FROM protocol_feed_tokens WHERE userId IN (?, ?)")
        .run(dualUser.id, ipv4OnlyUser.id);
    });
    removeExisting();

    const insertEndpoint = db.prepare(`
      INSERT INTO protocol_endpoints (
        name, protocol, runtimeMode, hostId, forwardRuleId,
        publicHost, publicPort, configJson, isEnabled, sortOrder,
        createdByUserId, createdAt, updatedAt
      ) VALUES (?, 'shadowsocks', 'external', ?, NULL, ?, ?, ?, 1, ?, ?, ?, ?)
    `);
    const insertAccess = db.prepare(`
      INSERT INTO protocol_user_access (
        endpointId, userId, credentialJson, isEnabled, createdAt, updatedAt
      ) VALUES (?, ?, '{}', 1, ?, ?)
    `);
    const insertToken = db.prepare(`
      INSERT INTO protocol_feed_tokens (
        userId, token, isEnabled, lastUsedAt, createdAt, updatedAt
      ) VALUES (?, ?, 1, NULL, ?, ?)
    `);

    const seed = db.transaction(() => {
      const dualEndpoint = insertEndpoint.run(
        DUAL_ENDPOINT_NAME,
        dualHost.id,
        "198.51.100.41",
        18443,
        JSON.stringify({ cipher: "aes-256-gcm", password: "gray-dual-stack-secret", udp: false }),
        910,
        admin.id,
        now,
        now,
      );
      const ipv4OnlyEndpoint = insertEndpoint.run(
        IPV4_ONLY_ENDPOINT_NAME,
        ipv4OnlyHost.id,
        "192.0.2.21",
        18444,
        JSON.stringify({ cipher: "aes-256-gcm", password: "gray-ipv4-only-secret", udp: false }),
        920,
        admin.id,
        now,
        now,
      );
      insertAccess.run(Number(dualEndpoint.lastInsertRowid), dualUser.id, now, now);
      insertAccess.run(Number(ipv4OnlyEndpoint.lastInsertRowid), ipv4OnlyUser.id, now, now);
      insertToken.run(dualUser.id, DUAL_TOKEN, now, now);
      insertToken.run(ipv4OnlyUser.id, IPV4_ONLY_TOKEN, now, now);
    });
    seed();
  } finally {
    db.close();
  }
}

async function responseText(pathname, expectedStatus = 200) {
  const response = await fetch(`${apiBase}${pathname}`, { redirect: "error" });
  const text = await response.text();
  assert.equal(response.status, expectedStatus, `${pathname} returned ${response.status}: ${text}`);
  return text;
}

function decodeUriFeed(body) {
  return Buffer.from(body.trim(), "base64").toString("utf8");
}

async function verifyGrayFeeds() {
  const defaultFeed = decodeUriFeed(await responseText(`/api/v1/access-feed/${DUAL_TOKEN}`));
  assert.match(defaultFeed, /@198\.51\.100\.41:18443#/);

  const ipv4Feed = decodeUriFeed(await responseText(`/api/v1/access-feed/${DUAL_TOKEN}?ipVersion=4`));
  assert.match(ipv4Feed, /@198\.51\.100\.41:18443#/);

  const ipv6Feed = decodeUriFeed(await responseText(`/api/v1/access-feed/${DUAL_TOKEN}?ipVersion=6`));
  assert.match(ipv6Feed, /@\[2001:db8:10::41d\]:18443#/);
  assert.doesNotMatch(ipv6Feed, /198\.51\.100\.41/);

  const mihomoIpv6 = await responseText(`/api/v1/access-feed/${DUAL_TOKEN}/mihomo?ipVersion=6`);
  assert.match(mihomoIpv6, /server: "2001:db8:10::41d"/);
  assert.match(mihomoIpv6, /port: 18443/);

  const noIpv6 = await responseText(`/api/v1/access-feed/${IPV4_ONLY_TOKEN}?ipVersion=6`, 422);
  assert.match(noIpv6, /没有可用 IPv6 地址/);

  const invalidVersion = await responseText(`/api/v1/access-feed/${DUAL_TOKEN}?ipVersion=5`, 400);
  assert.match(invalidVersion, /ipVersion 必须是 4 或 6/);
}

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(command, ["dev:panel"], {
  cwd: root,
  env: {
    ...process.env,
    FORWARDX_DEV_SERVER_PORT: "3000",
    FORWARDX_DEV_CLIENT_PORT: "5173",
    HOST: "127.0.0.1",
  },
  stdio: ["ignore", "pipe", "pipe"],
  shell: process.platform === "win32",
});

let logs = "";
child.stdout.on("data", (chunk) => {
  const text = String(chunk);
  logs += text;
  process.stdout.write(text);
});
child.stderr.on("data", (chunk) => {
  const text = String(chunk);
  logs += text;
  process.stderr.write(text);
});

try {
  await waitForPort(3000);
  seedGrayProtocolData();
  await verifyGrayFeeds();
  console.log("\n[IPv6 Gray] PASS");
  console.log("- default feed remains IPv4");
  console.log("- explicit ipVersion=4 remains IPv4");
  console.log("- explicit ipVersion=6 uses hosts.ipv6 with bracketed URI literal");
  console.log("- Mihomo IPv6 server field uses the IPv6 host");
  console.log("- IPv4-only endpoint returns 422 instead of falling back");
  console.log("- invalid ipVersion returns 400");
} catch (error) {
  console.error("\n[IPv6 Gray] FAIL");
  console.error(error);
  if (logs) console.error("\n[IPv6 Gray] dev-panel log tail:\n" + logs.slice(-5000));
  process.exitCode = 1;
} finally {
  if (!child.killed) child.kill("SIGTERM");
}
