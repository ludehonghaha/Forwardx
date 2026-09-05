import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const installerPath = resolve(repositoryRoot, "scripts/install-dual-pilot-server.sh");
const installer = readFileSync(installerPath, "utf8");

test("server Pilot installer has valid shell syntax", () => {
  execFileSync("bash", ["-n", installerPath], { stdio: "pipe" });
});

test("server Pilot installer never starts the runtime or mutates global networking/services", () => {
  assert.doesNotMatch(installer, /\bsystemctl\b/);
  assert.doesNotMatch(installer, /\biptables\b/);
  assert.doesNotMatch(installer, /\bnft\b/);
  assert.doesNotMatch(installer, /\bip\s+route\b/);
  assert.doesNotMatch(installer, /\bservice\b/);
  assert.doesNotMatch(installer, /\bcurl\b|\bwget\b/);
  assert.doesNotMatch(installer, /server\s+start/);
  assert.match(installer, /server validate/);
});

test("server Pilot installer preserves fixed isolated destinations and production Mita guard", () => {
  assert.match(installer, /\/usr\/local\/lib\/forwardx\/dual-pilot/);
  assert.match(installer, /\/etc\/forwardx\/dual-pilot/);
  assert.match(installer, /\/var\/lib\/forwardx-agent\/dual-pilot/);
  assert.match(installer, /PROTECTED_MITA_PORT="\$\{PROTECTED_MITA_PORT:-11464\}"/);
  assert.match(installer, /refusing to reuse protected production Mita port/);
  assert.match(installer, /tcp_fast_open=true is forbidden/);
  assert.match(installer, /server multipath listener must stay on 127\.0\.0\.1/);
});

test("secret-bearing configs are installed private and no backup copy is created", () => {
  assert.match(installer, /install -m 0600 "\$SERVER_SOURCE"/);
  assert.match(installer, /install -m 0600 "\$MITA_SOURCE"/);
  assert.doesNotMatch(installer, /\.bak|backup|cp\s+.*server-gray|cp\s+.*mita-pilot/i);
});
