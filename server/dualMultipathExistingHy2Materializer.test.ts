import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

function writeSyntheticInputs(root: string, privatePort: number) {
  const privateEndpointPath = join(root, "private-endpoint.json");
  const existingHy2Path = join(root, "existing-hy2.json");
  const hy2AuthPath = join(root, "hy2-auth.secret");
  const hy2ObfsPath = join(root, "hy2-obfs.secret");
  const mieruUsernamePath = join(root, "mieru-username.secret");
  const mieruPasswordPath = join(root, "mieru-password.secret");

  writeFileSync(privateEndpointPath, JSON.stringify({
    status: "verified-read-only",
    endpoint: { server: "211.136.162.188", port: privatePort, protocol: "TCP" },
    evidence: {
      snapshotId: "materializer-test-private",
      targetId: "materializer-test-client",
      observedAt: "2026-09-02T16:23:37.000Z",
      discoverySource: "synthetic-test",
    },
  }));
  writeFileSync(existingHy2Path, JSON.stringify({
    status: "verified-read-only",
    externalEndpoint: { server: "87.86.22.221", port: 24618, protocol: "UDP" },
    actualListener: { listen: "0.0.0.0", port: 13666, protocol: "UDP" },
    runtimeOwner: {
      service: "forwardx-mihomo.service",
      process: "forwardx-mihomo",
      networkNamespace: "host",
      configPath: "/etc/forwardx/mihomo/config.yaml",
    },
    mapping: {
      type: "forwardx-runtime-udp-forwarder",
      service: "forwardx-runtime.service",
      externalPort: 24618,
      targetHost: "127.0.0.1",
      targetPort: 13666,
    },
    tls: { serverName: "www.cloudflare.com", insecure: true },
    authSecretRef: "dual.hy2.auth",
    obfs: { type: "salamander", passwordSecretRef: "dual.hy2.obfs-password" },
    evidence: {
      snapshotId: "materializer-test-hy2",
      targetId: "nobrand-dual-current",
      observedAt: "2026-09-02T16:23:37.000Z",
      discoverySource: "forwardx-agent-runtime-read-only",
    },
  }));
  writeFileSync(hy2AuthPath, "synthetic-hy2-auth");
  writeFileSync(hy2ObfsPath, "synthetic-hy2-obfs");
  writeFileSync(mieruUsernamePath, "synthetic-mieru-user");
  writeFileSync(mieruPasswordPath, "synthetic-mieru-password");

  return {
    privateEndpointPath,
    existingHy2Path,
    hy2AuthPath,
    hy2ObfsPath,
    mieruUsernamePath,
    mieruPasswordPath,
  };
}

function materializerArgs(output: string, inputs: ReturnType<typeof writeSyntheticInputs>) {
  return [
    output,
    inputs.privateEndpointPath,
    inputs.existingHy2Path,
    inputs.hy2AuthPath,
    inputs.hy2ObfsPath,
    inputs.mieruUsernamePath,
    inputs.mieruPasswordPath,
  ];
}

test("materializes existing ForwardX HY2 locally without a second server HY2 inbound", () => {
  const root = mkdtempSync(join(tmpdir(), "forwardx-dual-existing-hy2-"));
  const output = join(root, "output");
  const inputs = writeSyntheticInputs(root, 11464);

  execFileSync(process.execPath, [
    "--import",
    "tsx",
    resolve("scripts/materialize-dual-existing-hy2-gray-local.ts"),
    ...materializerArgs(output, inputs),
  ], { cwd: resolve("."), stdio: "pipe" });

  const client = JSON.parse(readFileSync(join(output, "dual-test.json"), "utf8"));
  const server = JSON.parse(readFileSync(join(output, "server-gray.json"), "utf8"));
  const metadataText = readFileSync(join(output, "materialization-metadata.json"), "utf8");
  assert.equal(client.outbounds[1].server_port, 24618);
  assert.equal(client.outbounds[1].password, "synthetic-hy2-auth");
  assert.equal(client.outbounds[1].obfs.password, "synthetic-hy2-obfs");
  assert.match(client.outbounds[2].status_file, /multipath-status\.json$/);
  assert.deepEqual(server.inbounds.map((item: { type: string }) => item.type), ["multipath"]);
  assert.equal(server.inbounds[0].listen, "127.0.0.1");
  assert.equal(server.inbounds[0].listen_port, 39000);
  assert.doesNotMatch(metadataText, /synthetic-hy2-auth|synthetic-hy2-obfs|synthetic-mieru-password/);
  assert.match(metadataText, /"readyForRuntime": false/);
});

test("materializes a self-use Pilot with an isolated Mita user and formal threshold policy", () => {
  const root = mkdtempSync(join(tmpdir(), "forwardx-dual-pilot-"));
  const output = join(root, "output");
  const inputs = writeSyntheticInputs(root, 11401);

  execFileSync(process.execPath, [
    "--import",
    "tsx",
    resolve("scripts/materialize-dual-existing-hy2-pilot-local.ts"),
    ...materializerArgs(output, inputs),
  ], { cwd: resolve("."), stdio: "pipe" });

  const client = JSON.parse(readFileSync(join(output, "dual-test.json"), "utf8"));
  const server = JSON.parse(readFileSync(join(output, "server-gray.json"), "utf8"));
  const mita = JSON.parse(readFileSync(join(output, "mita-pilot.json"), "utf8"));
  const metadataText = readFileSync(join(output, "materialization-metadata.json"), "utf8");

  assert.equal(mita.portBindings[0].port, 11401);
  assert.equal(mita.portBindings[0].protocol, "TCP");
  assert.equal(mita.users[0].name, "synthetic-mieru-user");
  assert.equal(mita.users[0].password, "synthetic-mieru-password");
  assert.equal(mita.users[0].allowLoopbackIP, true);
  assert.equal(mita.mtu, 1400);

  assert.equal(client.outbounds[2].tcp_fast_open, false);
  assert.equal(client.outbounds[2].activation_threshold_mbps, 120);
  assert.equal(client.outbounds[2].activation_window, "1s");
  assert.equal("activation_after_bytes" in client.outbounds[2], false);
  assert.equal(server.inbounds[0].tcp_fast_open, false);
  assert.equal("activation_after_bytes" in server.inbounds[0], false);

  assert.match(metadataText, /"pilotMode": "experimental-self-use-only"/);
  assert.match(metadataText, /"readyToDeploy": false/);
  assert.match(metadataText, /"productionReady": false/);
  assert.match(metadataText, /"protectedProductionMitaPort": 11464/);
  assert.doesNotMatch(metadataText, /synthetic-hy2-auth|synthetic-hy2-obfs|synthetic-mieru-password/);
});

test("Pilot materializer rejects the protected production Mita listener before creating output", () => {
  const root = mkdtempSync(join(tmpdir(), "forwardx-dual-pilot-collision-"));
  const output = join(root, "output");
  const inputs = writeSyntheticInputs(root, 11464);

  assert.throws(() => execFileSync(process.execPath, [
    "--import",
    "tsx",
    resolve("scripts/materialize-dual-existing-hy2-pilot-local.ts"),
    ...materializerArgs(output, inputs),
  ], { cwd: resolve("."), stdio: "pipe" }), /Command failed/);
  assert.equal(existsSync(output), false);
});

test("Pilot lifecycle is bounded to owned processes and avoids production mutation commands", () => {
  const launcher = readFileSync(resolve("scripts/run-dual-pilot.sh"), "utf8");
  assert.match(launcher, /MITA_CONFIG_JSON_FILE=/);
  assert.match(launcher, /MITA_UDS_PATH=/);
  assert.match(launcher, /MIERU_CONFIG_JSON_FILE=/);
  assert.match(launcher, /process_start_ticks/);
  assert.match(launcher, /possible PID reuse/);
  assert.match(launcher, /PROTECTED_MITA_PORT/);
  assert.match(launcher, /tcp_fast_open=true is forbidden/);
  assert.doesNotMatch(launcher, /\bsystemctl\b|\bnft\b|\biptables\b|\bip6tables\b|\bip[[:space:]]+route\b/);
});
