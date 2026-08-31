import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const buildScript = readFileSync(new URL("../scripts/build-dual-windows-sidecar.sh", import.meta.url), "utf8");
const launcher = buildScript.match(/cat > "\$OUTPUT_DIR\/run-forwardx-dual-gray\.ps1" <<'EOF'\n([\s\S]*?)\nEOF/)?.[1];
if (!launcher) throw new Error("Windows Gray PowerShell launcher template not found");

test("checks both loopback ports before starting either managed child", () => {
  const check24180 = launcher.indexOf("Assert-LoopbackPortFree 24180");
  const check24181 = launcher.indexOf("Assert-LoopbackPortFree 24181");
  const startMieru = launcher.indexOf("$mieruProcess = Start-GrayChild");
  assert.ok(check24180 >= 0 && check24181 > check24180 && startMieru > check24181);
});

test("starts official Mieru first, waits for 24181, then starts multipath", () => {
  const startMieru = launcher.indexOf("$mieruProcess = Start-GrayChild");
  const waitMieru = launcher.indexOf("Wait-LoopbackReady $mieruProcess 24181");
  const startMultipath = launcher.indexOf("$multipathProcess = Start-GrayChild");
  assert.ok(startMieru >= 0 && waitMieru > startMieru && startMultipath > waitMieru);
  assert.match(launcher, /MIERU_CONFIG_JSON_FILE/);
});

test("cleans only the two managed process ids on failure, Ctrl+C or exit", () => {
  assert.match(launcher, /finally \{[\s\S]*Stop-GrayChild \$multipathProcess[\s\S]*Stop-GrayChild \$mieruProcess/);
  assert.match(launcher, /Stop-Process -Id \$Process\.Id/);
  assert.doesNotMatch(launcher, /Stop-Process\s+-Name|taskkill|7890|clash/i);
});

test("does not modify global Mieru config or Windows network state", () => {
  assert.match(launcher, /EnvironmentVariables\[\$entry\.Key\]/);
  assert.doesNotMatch(launcher, /setx|netsh|New-NetFirewallRule|Set-NetIPInterface|system proxy/i);
});
