import assert from "node:assert/strict";
import test from "node:test";
import { buildManagedMieruRuntimePlan, buildManagedProtocolGostServices, type ManagedProtocolEndpointRow } from "./protocolRuntimePlan";

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
