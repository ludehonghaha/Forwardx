import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  buildManagedMieruRuntimePlan,
  buildManagedMihomoRuntimePlan,
  buildManagedProtocolGostServices,
  type ManagedProtocolEndpointRow,
} from "./protocolRuntimePlan";
import {
  MIHOMO_BIN,
  MIHOMO_CONFIG_PATH,
  MIHOMO_SERVICE_NAME,
  MIHOMO_VERSION,
  ensureMihomoBinaryCmd,
  verifyMihomoRuntimeCmd,
} from "./protocolMihomoRuntime";

function endpoint(overrides: Partial<ManagedProtocolEndpointRow> = {}): ManagedProtocolEndpointRow {
  return {
    id: 7,
    protocol: "shadowsocks",
    runtimeMode: "managed",
    publicPort: 13511,
    configJson: {
      cipher: "chacha20-ietf-poly1305",
      password: "shared-secret",
      udp: false,
    },
    isEnabled: true,
    ...overrides,
  };
}

test("compiles managed Shadowsocks into the existing GOST service list", () => {
  assert.deepEqual(buildManagedProtocolGostServices([endpoint()]), [{
    name: "fwx-protocol-7-tcp",
    addr: ":13511",
    handler: {
      type: "ss",
      auth: { username: "chacha20-ietf-poly1305", password: "shared-secret" },
    },
    listener: { type: "tcp" },
  }]);
});

test("adds independent SSU service without compiling a second runtime", () => {
  const services = buildManagedProtocolGostServices([endpoint({
    configJson: {
      cipher: "aes-256-gcm",
      password: "udp-secret",
      listenPort: 24567,
      udp: true,
    },
  })]);
  assert.deepEqual(services.map((service) => [service.name, service.addr, service.handler.type, service.listener.type]), [
    ["fwx-protocol-7-tcp", ":24567", "ss", "tcp"],
    ["fwx-protocol-7-udp", ":24567", "ssu", "udp"],
  ]);
});

test("keeps external, unsupported and disabled endpoints out of Agent desired state", () => {
  const services = buildManagedProtocolGostServices([
    endpoint({ id: 1, runtimeMode: "external" }),
    endpoint({ id: 2, protocol: "shadowsocks_ssh" }),
    endpoint({ id: 5, protocol: "mieru" }),
    endpoint({ id: 6, protocol: "snell" }),
    endpoint({ id: 3, isEnabled: false }),
    endpoint({ id: 4, configJson: { cipher: "2022-blake3-aes-256-gcm", password: "secret" } }),
  ]);
  assert.deepEqual(services, []);
});

test("compiles one managed Mieru endpoint into one mita server config", () => {
  const plan = buildManagedMieruRuntimePlan([endpoint({
    protocol: "mieru",
    publicPort: 22226,
    configJson: {
      username: "forwardx",
      password: "managed-secret",
      listenPort: 22226,
      transport: "TCP",
      mtu: 1400,
      multiplexing: "MULTIPLEXING_OFF",
      handshakeMode: "HANDSHAKE_NO_WAIT",
      trafficPattern: "client-only",
      udp: true,
    },
  })]);
  assert.deepEqual(plan, {
    endpointId: 7,
    listenPort: 22226,
    transport: "TCP",
    config: {
      portBindings: [{ port: 22226, protocol: "TCP" }],
      users: [{ name: "forwardx", password: "managed-secret" }],
      loggingLevel: "INFO",
      mtu: 1400,
    },
  });
  assert.equal(JSON.stringify(plan).includes("multiplexing"), false);
  assert.equal(JSON.stringify(plan).includes("trafficPattern"), false);
  assert.equal(buildManagedProtocolGostServices([endpoint({ protocol: "mieru" })]).length, 0);
});

test("refuses to compile duplicate or invalid managed Mieru runtimes", () => {
  const valid = endpoint({
    protocol: "mieru",
    configJson: { username: "forwardx", password: "secret", transport: "TCP", mtu: 1400 },
  });
  assert.equal(buildManagedMieruRuntimePlan([valid, { ...valid, id: 8 }]), null);
  assert.equal(buildManagedMieruRuntimePlan([{ ...valid, configJson: { username: "", password: "secret", transport: "TCP", mtu: 1400 } }]), null);
});

test("compiles Snell Reality and Hysteria2 into one shared Mihomo runtime", () => {
  const plan = buildManagedMihomoRuntimePlan([
    endpoint({
      id: 21,
      protocol: "snell",
      publicPort: 32001,
      configJson: { password: "snell-secret", version: 5, udp: true },
    }),
    endpoint({
      id: 22,
      protocol: "vless_reality",
      publicPort: 32002,
      configJson: {
        uuid: "550e8400-e29b-41d4-a716-446655440000",
        serverName: "www.cloudflare.com",
        realityDest: "www.cloudflare.com:443",
        realityPrivateKey: "private-key-12345678901234567890123456789012",
        realityPublicKey: "public-key-123456789012345678901234567890123",
        shortId: "0011223344556677",
        clientFingerprint: "chrome",
        udp: true,
      },
    }),
    endpoint({
      id: 23,
      protocol: "hysteria2",
      publicPort: 32003,
      configJson: {
        password: "hy2-secret",
        sni: "www.cloudflare.com",
        insecure: true,
        obfsMode: "salamander",
        obfsPassword: "obfs-secret",
      },
    }),
  ]);
  assert.ok(plan);
  assert.deepEqual(plan?.sockets, [
    { endpointId: 21, protocol: "snell", listenPort: 32001, transport: "tcp" },
    { endpointId: 22, protocol: "vless_reality", listenPort: 32002, transport: "tcp" },
    { endpointId: 23, protocol: "hysteria2", listenPort: 32003, transport: "udp" },
  ]);
  assert.equal(plan?.certificates.length, 1);
  assert.equal((plan?.config.listeners as any[]).length, 3);
  assert.equal((plan?.config.listeners as any[])[0]?.type, "snell");
  assert.equal((plan?.config.listeners as any[])[1]?.type, "vless");
  assert.equal((plan?.config.listeners as any[])[2]?.type, "hysteria2");
});

test("rejects duplicate sockets instead of compiling overlapping managed listeners", () => {
  const plan = buildManagedMihomoRuntimePlan([
    endpoint({ id: 31, protocol: "snell", publicPort: 33000, configJson: { password: "a", version: 5 } }),
    endpoint({ id: 32, protocol: "vless_reality", publicPort: 33000, configJson: {
      uuid: "550e8400-e29b-41d4-a716-446655440000",
      serverName: "www.cloudflare.com",
      realityDest: "www.cloudflare.com:443",
      realityPrivateKey: "private-key",
      shortId: "0011",
    } }),
  ]);
  assert.equal(plan, null);
});

test("Mihomo runtime is external to the Agent build and verifies real sockets with startup grace", () => {
  const install = ensureMihomoBinaryCmd();
  const shellSyntax = spawnSync("sh", ["-n", "-c", install], { encoding: "utf8" });
  assert.equal(shellSyntax.status, 0, shellSyntax.stderr || "generated Mihomo install command must parse with /bin/sh");
  assert.match(install, new RegExp(`MetaCubeX/mihomo/releases/download/v${MIHOMO_VERSION}`));
  assert.match(install, /mihomo-linux-amd64-v1-/);
  assert.equal(MIHOMO_BIN, "/usr/local/bin/forwardx-mihomo");
  assert.equal(MIHOMO_SERVICE_NAME, "forwardx-mihomo");
  assert.equal(MIHOMO_CONFIG_PATH, "/etc/forwardx/mihomo/config.yaml");

  const plan = buildManagedMihomoRuntimePlan([
    endpoint({ id: 41, protocol: "snell", publicPort: 34001, configJson: { password: "secret", version: 5 } }),
  ]);
  const verify = verifyMihomoRuntimeCmd(plan);
  const verifySyntax = spawnSync("sh", ["-n", "-c", verify], { encoding: "utf8" });
  assert.equal(verifySyntax.status, 0, verifySyntax.stderr || "generated Mihomo readiness command must parse with /bin/sh");
  assert.match(verify, /systemctl is-active/);
  assert.match(verify, /34001/);
  assert.match(verify, /awk '\{print \$4\}'/);
  assert.match(verify, /mihomo_runtime_ready/);
  assert.match(verify, /attempt=1/);
  assert.match(verify, /\[ \"\$attempt\" -ge 10 \]/);
  assert.match(verify, /sleep 1/);
});
