import assert from "node:assert/strict";
import test from "node:test";
import { projectProtocolEndpointRuntimeStatus } from "./protocolRuntimeStatus";

function endpoint(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    protocol: "shadowsocks",
    runtimeMode: "managed",
    publicPort: 24567,
    configJson: { listenPort: 24567, udp: false },
    isEnabled: true,
    ...overrides,
  };
}

test("checks managed Mieru against the single mita transport listener", () => {
  const result = projectProtocolEndpointRuntimeStatus({
    endpoint: endpoint({
      protocol: "mieru",
      configJson: { listenPort: 22226, transport: "TCP", udp: true },
    }),
    host: host({ agentVersion: "2.2.192" }),
    hostProtocolRevision: 12,
    localState: {
      rules: [],
      tunnels: [],
      services: [{ name: "forwardx-mita", active: true, hasWork: true }],
      listeners: [{ runtime: "mieru", port: 22226, protocol: "tcp", ready: true }],
    },
  });
  assert.equal(result.state, "healthy");
  assert.match(result.message, /TCP.*22226/);
});

test("does not turn Mieru client UDP capability into a second server listener", () => {
  const result = projectProtocolEndpointRuntimeStatus({
    endpoint: endpoint({
      protocol: "mieru",
      configJson: { listenPort: 22226, transport: "TCP", udp: true },
    }),
    host: host({ agentVersion: "2.2.192" }),
    hostProtocolRevision: 12,
    localState: {
      rules: [],
      tunnels: [],
      services: [{ name: "forwardx-mita", active: true, hasWork: true }],
      listeners: [{ runtime: "mieru", port: 22226, protocol: "tcp", ready: true }],
    },
  });
  assert.equal(result.state, "healthy");
});

function host(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    isOnline: true,
    agentVersion: "2.2.191",
    agentLastAppliedRevision: 12,
    lastHeartbeat: new Date("2026-08-22T00:00:00.000Z"),
    ...overrides,
  };
}

function localState(listeners: Array<{ runtime: string; port: number; protocol: "tcp" | "udp"; ready: boolean }>) {
  return {
    rules: [],
    tunnels: [],
    services: [{ name: "forwardx-runtime", active: true, hasWork: true }],
    listeners,
  };
}

test("requires applied revision and real listener readiness before reporting healthy", () => {
  const pending = projectProtocolEndpointRuntimeStatus({
    endpoint: endpoint(),
    host: host({ agentLastAppliedRevision: 11 }),
    hostProtocolRevision: 12,
    localState: localState([{ runtime: "gost", port: 24567, protocol: "tcp", ready: true }]),
  });
  assert.equal(pending.state, "pending");
  assert.equal(pending.applied, false);

  const unhealthy = projectProtocolEndpointRuntimeStatus({
    endpoint: endpoint(),
    host: host(),
    hostProtocolRevision: 12,
    localState: localState([]),
  });
  assert.equal(unhealthy.state, "unhealthy");
  assert.match(unhealthy.lastError || "", /TCP.*24567/);

  const healthy = projectProtocolEndpointRuntimeStatus({
    endpoint: endpoint(),
    host: host(),
    hostProtocolRevision: 12,
    localState: localState([{ runtime: "gost", port: 24567, protocol: "tcp", ready: true }]),
  });
  assert.equal(healthy.state, "healthy");
  assert.equal(healthy.listenerHealthy, true);
});

test("checks TCP and UDP independently for managed Shadowsocks", () => {
  const result = projectProtocolEndpointRuntimeStatus({
    endpoint: endpoint({ configJson: { listenPort: 24567, udp: true } }),
    host: host(),
    hostProtocolRevision: 12,
    localState: localState([
      { runtime: "gost", port: 24567, protocol: "tcp", ready: true },
      { runtime: "gost", port: 24567, protocol: "udp", ready: false },
    ]),
  });
  assert.equal(result.state, "unhealthy");
  assert.match(result.lastError || "", /UDP/);
});

test("distinguishes offline, stopped and old-Agent states without inventing health", () => {
  const offline = projectProtocolEndpointRuntimeStatus({
    endpoint: endpoint(),
    host: host({ isOnline: false }),
    hostProtocolRevision: 12,
  });
  assert.equal(offline.state, "offline");
  assert.equal(offline.listenerHealthy, null);

  const stopped = projectProtocolEndpointRuntimeStatus({
    endpoint: endpoint({ isEnabled: false }),
    host: host(),
    hostProtocolRevision: 12,
  });
  assert.equal(stopped.state, "stopped");

  const unsupported = projectProtocolEndpointRuntimeStatus({
    endpoint: endpoint(),
    host: host({ agentVersion: "2.2.190" }),
    hostProtocolRevision: 12,
  });
  assert.equal(unsupported.state, "unsupported");
  assert.equal(unsupported.listenerHealthy, null);
});

test("keeps external endpoints outside Agent runtime status", () => {
  const result = projectProtocolEndpointRuntimeStatus({
    endpoint: endpoint({ runtimeMode: "external" }),
    hostProtocolRevision: 0,
  });
  assert.equal(result.state, "external");
  assert.equal(result.applied, null);
});
