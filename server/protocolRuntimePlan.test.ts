import assert from "node:assert/strict";
import test from "node:test";
import { buildManagedProtocolGostServices, type ManagedProtocolEndpointRow } from "./protocolRuntimePlan";

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
    endpoint({ id: 3, isEnabled: false }),
    endpoint({ id: 4, configJson: { cipher: "2022-blake3-aes-256-gcm", password: "secret" } }),
  ]);
  assert.deepEqual(services, []);
});
