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

function mihomoState(
  listeners: Array<{ runtime: string; port: number; protocol: "tcp" | "udp"; ready: boolean }>,
  active = true,
) {
  return {
    rules: [],
    tunnels: [],
    services: [{ name: "forwardx-mihomo", active, hasWork: true }],
    listeners,
  };
}

function xrayState(
  listeners: Array<{ runtime: string; port: number; protocol: "tcp" | "udp"; ready: boolean }>,
  active = true,
) {
  return {
    rules: [],
    tunnels: [],
    services: [{ name: "forwardx-xray", active, hasWork: true }],
    listeners,
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

test("Mihomo entry protocols require Agent 2.2.193 runtime reporting", () => {
  for (const protocol of ["snell", "hysteria2"]) {
    const result = projectProtocolEndpointRuntimeStatus({
      endpoint: endpoint({ protocol }),
      host: host({ agentVersion: "2.2.192", agentLastAppliedRevision: 12 }),
      hostProtocolRevision: 12,
      localState: mihomoState([]),
    });
    assert.equal(result.state, "unsupported", protocol);
    assert.equal(result.listenerHealthy, null, protocol);
    assert.match(result.message, /2\.2\.193/, protocol);
  }
});

test("Reality requires Agent 2.2.196 Xray runtime reporting", () => {
  const result = projectProtocolEndpointRuntimeStatus({
    endpoint: endpoint({ protocol: "vless_reality" }),
    host: host({ agentVersion: "2.2.195", agentLastAppliedRevision: 12 }),
    hostProtocolRevision: 12,
    localState: xrayState([]),
  });
  assert.equal(result.state, "unsupported");
  assert.equal(result.listenerHealthy, null);
  assert.match(result.message, /2\.2\.196/);
});

test("Snell requires a real Mihomo TCP listener", () => {
  const healthy = projectProtocolEndpointRuntimeStatus({
    endpoint: endpoint({ protocol: "snell", configJson: { listenPort: 24567, udp: true } }),
    host: host({ agentVersion: "2.2.193" }),
    hostProtocolRevision: 12,
    localState: mihomoState([{ runtime: "mihomo", port: 24567, protocol: "tcp", ready: true }]),
  });
  assert.equal(healthy.state, "healthy");
  assert.equal(healthy.listenerHealthy, true);
  assert.match(healthy.message, /TCP.*24567/);

  const wrongTransport = projectProtocolEndpointRuntimeStatus({
    endpoint: endpoint({ protocol: "snell", configJson: { listenPort: 24567, udp: true } }),
    host: host({ agentVersion: "2.2.193" }),
    hostProtocolRevision: 12,
    localState: mihomoState([{ runtime: "mihomo", port: 24567, protocol: "udp", ready: true }]),
  });
  assert.equal(wrongTransport.state, "unhealthy");
  assert.match(wrongTransport.lastError || "", /TCP/);
});

test("Reality requires a real Xray TCP listener", () => {
  const healthy = projectProtocolEndpointRuntimeStatus({
    endpoint: endpoint({ protocol: "vless_reality", configJson: { listenPort: 24567, udp: true } }),
    host: host({ agentVersion: "2.2.196" }),
    hostProtocolRevision: 12,
    localState: xrayState([{ runtime: "xray", port: 24567, protocol: "tcp", ready: true }]),
  });
  assert.equal(healthy.state, "healthy");
  assert.equal(healthy.listenerHealthy, true);
  assert.match(healthy.message, /TCP.*24567/);

  const wrongRuntime = projectProtocolEndpointRuntimeStatus({
    endpoint: endpoint({ protocol: "vless_reality", configJson: { listenPort: 24567, udp: true } }),
    host: host({ agentVersion: "2.2.196" }),
    hostProtocolRevision: 12,
    localState: mihomoState([{ runtime: "mihomo", port: 24567, protocol: "tcp", ready: true }]),
  });
  assert.equal(wrongRuntime.state, "unhealthy");
  assert.match(wrongRuntime.lastError || "", /TCP/);
});

test("Hysteria2 requires a real Mihomo UDP listener", () => {
  const healthy = projectProtocolEndpointRuntimeStatus({
    endpoint: endpoint({ protocol: "hysteria2", configJson: { listenPort: 24443 } }),
    host: host({ agentVersion: "2.2.193" }),
    hostProtocolRevision: 12,
    localState: mihomoState([{ runtime: "mihomo", port: 24443, protocol: "udp", ready: true }]),
  });
  assert.equal(healthy.state, "healthy");
  assert.match(healthy.message, /UDP.*24443/);

  const tcpOnly = projectProtocolEndpointRuntimeStatus({
    endpoint: endpoint({ protocol: "hysteria2", configJson: { listenPort: 24443 } }),
    host: host({ agentVersion: "2.2.193" }),
    hostProtocolRevision: 12,
    localState: mihomoState([{ runtime: "mihomo", port: 24443, protocol: "tcp", ready: true }]),
  });
  assert.equal(tcpOnly.state, "unhealthy");
  assert.match(tcpOnly.lastError || "", /UDP/);
});

test("Mihomo service failure is reported as runtime unhealthy", () => {
  const result = projectProtocolEndpointRuntimeStatus({
    endpoint: endpoint({ protocol: "snell", configJson: { listenPort: 13501 } }),
    host: host({ agentVersion: "2.2.193" }),
    hostProtocolRevision: 12,
    localState: mihomoState([{ runtime: "mihomo", port: 13501, protocol: "tcp", ready: false }], false),
  });
  assert.equal(result.state, "unhealthy");
  assert.match(result.lastError || "", /forwardx-mihomo/);
});

test("Xray service failure is reported as Reality runtime unhealthy", () => {
  const result = projectProtocolEndpointRuntimeStatus({
    endpoint: endpoint({ protocol: "vless_reality", configJson: { listenPort: 40006 } }),
    host: host({ agentVersion: "2.2.196" }),
    hostProtocolRevision: 12,
    localState: xrayState([{ runtime: "xray", port: 40006, protocol: "tcp", ready: false }], false),
  });
  assert.equal(result.state, "unhealthy");
  assert.match(result.lastError || "", /forwardx-xray/);
});

test("Reality listener health reconciles failed, recovered, failed, recovered without retaining an active error", () => {
  const input = {
    endpoint: endpoint({ protocol: "vless_reality", configJson: { listenPort: 32676 } }),
    host: host({ agentVersion: "2.2.198" }),
    hostProtocolRevision: 12,
  };
  const project = (ready: boolean) => projectProtocolEndpointRuntimeStatus({
    ...input,
    localState: xrayState([{ runtime: "xray", port: 32676, protocol: "tcp", ready }]),
  });

  const initialFailure = project(false);
  const historicalLastError = initialFailure.lastError;
  assert.equal(initialFailure.state, "unhealthy");
  assert.equal(initialFailure.listenerHealthy, false);
  assert.match(historicalLastError || "", /TCP.*32676/);

  const firstRecovery = project(true);
  assert.equal(firstRecovery.state, "healthy");
  assert.equal(firstRecovery.listenerHealthy, true);
  assert.equal(firstRecovery.lastError, null);
  assert.match(historicalLastError || "", /TCP.*32676/, "historical error may remain outside current health");

  const secondFailure = project(false);
  assert.equal(secondFailure.state, "unhealthy");
  assert.equal(secondFailure.listenerHealthy, false);
  assert.match(secondFailure.lastError || "", /TCP.*32676/);

  const secondRecovery = project(true);
  assert.equal(secondRecovery.state, "healthy");
  assert.equal(secondRecovery.listenerHealthy, true);
  assert.equal(secondRecovery.lastError, null);
  assert.equal(secondRecovery.label, "运行正常");
});

test("managed entry protocols stay pending until the Agent applies their revision", () => {
  const result = projectProtocolEndpointRuntimeStatus({
    endpoint: endpoint({ protocol: "vless_reality" }),
    host: host({ agentVersion: "2.2.196", agentLastAppliedRevision: 11 }),
    hostProtocolRevision: 12,
  });
  assert.equal(result.state, "pending");
  assert.equal(result.applied, false);
});
