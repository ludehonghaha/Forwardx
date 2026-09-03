import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const script = resolve("scripts/collect-dual-pilot-evidence.sh");

function fixture(role = "client") {
  const root = mkdtempSync(join(tmpdir(), "forwardx-dual-evidence-"));
  const runtime = join(root, "runtime");
  const config = join(root, "config");
  mkdirSync(runtime, { recursive: true });
  mkdirSync(config, { recursive: true });
  const prefix = role === "server" ? "server-singbox" : "client-singbox";
  writeFileSync(join(runtime, `${prefix}.log`), "normal line\nauth=super-secret\npassword: also-secret\n");
  if (role === "client") {
    writeFileSync(join(runtime, "client-mieru.log"), 'token="do-not-keep"\n');
    writeFileSync(join(config, "multipath-status.json"), JSON.stringify({ logical: { connections: 1 }, secret: "hidden" }));
    writeFileSync(join(config, "dual-test.json"), JSON.stringify({ password: "must-never-copy" }));
  } else {
    writeFileSync(join(runtime, "server-mita.log"), "private_key=never-keep\n");
    writeFileSync(join(config, "mita-pilot.json"), JSON.stringify({ password: "must-never-copy" }));
  }
  return { root, runtime, config };
}

function collect(role) {
  const f = fixture(role);
  const out = execFileSync("bash", [script, role, f.runtime, f.config], { encoding: "utf8" }).trim();
  return { ...f, out };
}

test("collector redacts known secret-shaped log/status fields and never copies configs", () => {
  const { out } = collect("client");
  const singboxLog = readFileSync(join(out, "client-singbox.log"), "utf8");
  const mieruLog = readFileSync(join(out, "client-mieru.log"), "utf8");
  const status = readFileSync(join(out, "multipath-status.json"), "utf8");
  assert.match(singboxLog, /auth=\[REDACTED\]/i);
  assert.match(singboxLog, /password: \[REDACTED\]/i);
  assert.doesNotMatch(singboxLog, /super-secret|also-secret/);
  assert.doesNotMatch(mieruLog, /do-not-keep/);
  assert.doesNotMatch(status, /hidden/);
  assert.throws(() => readFileSync(join(out, "dual-test.json"), "utf8"));
});

test("server collector never copies Mita config or credential material", () => {
  const { out } = collect("server");
  const mitaLog = readFileSync(join(out, "server-mita.log"), "utf8");
  assert.doesNotMatch(mitaLog, /never-keep/);
  assert.throws(() => readFileSync(join(out, "mita-pilot.json"), "utf8"));
});

test("collector source remains read-only toward services and networking", () => {
  const source = readFileSync(script, "utf8");
  for (const forbidden of [
    /\bkill\b/,
    /\bpkill\b/,
    /\bsystemctl\b/,
    /\biptables\b/,
    /\bnft\b/,
    /\bip\s+route\b/,
    /\bip\s+rule\b/,
    /\bservice\s+.*(?:stop|restart|start)\b/,
    /server-gray\.json/,
    /dual-test\.json/,
    /mita-pilot\.json/,
    /mieru-gray\.json/,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});
