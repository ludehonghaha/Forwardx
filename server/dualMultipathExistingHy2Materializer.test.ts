import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("materializes existing ForwardX HY2 locally without a second server HY2 inbound", () => {
  const root = mkdtempSync(join(tmpdir(), "forwardx-dual-existing-hy2-"));
  const output = join(root, "output");
  const privateEndpointPath = join(root, "private-endpoint.json");
  const existingHy2Path = join(root, "existing-hy2.json");
  const hy2AuthPath = join(root, "hy2-auth.secret");
  const hy2ObfsPath = join(root, "hy2-obfs.secret");
  const mieruUsernamePath = join(root, "mieru-username.secret");
  const mieruPasswordPath = join(root, "mieru-password.secret");

  writeFileSync(privateEndpointPath, JSON.stringify({
    status: "verified-read-only",
    endpoint: { server: "211.136.162.188", port: 11464, protocol: "TCP" },
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

  execFileSync(process.execPath, [
    "--import",
    "tsx",
    resolve("scripts/materialize-dual-existing-hy2-gray-local.ts"),
    output,
    privateEndpointPath,
    existingHy2Path,
    hy2AuthPath,
    hy2ObfsPath,
    mieruUsernamePath,
    mieruPasswordPath,
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
