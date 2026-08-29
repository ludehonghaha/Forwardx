import assert from "node:assert/strict";
import test from "node:test";
import { validateProtocolFeedEntry } from "../shared/protocolAccess";
import { getDatabaseTableDefs, MIGRATION_TABLES } from "./dbSchema";
import { parseNoBrandProviderSnapshot } from "./nobrandProviderState";

test("protocol access schema is additive and does not duplicate ForwardX network resources", () => {
  const tableNames = new Set(getDatabaseTableDefs().map((table) => table.name));
  for (const name of ["protocol_endpoints", "protocol_user_access", "protocol_feed_tokens"]) {
    assert.equal(tableNames.has(name), true, `${name} must be installed`);
    assert.equal((MIGRATION_TABLES as readonly string[]).includes(name), true, `${name} must migrate`);
  }
  for (const duplicate of ["nodes", "landings", "network_chains", "network_deployments", "tms_users"]) {
    assert.equal(tableNames.has(duplicate), false, `${duplicate} must not be copied into ForwardX`);
  }
});

test("protocol access rows reference existing users, hosts and forward rules", () => {
  const byName = new Map(getDatabaseTableDefs().map((table) => [table.name, table]));
  const endpointColumns = new Set(byName.get("protocol_endpoints")?.columns.map((column) => column.name));
  const accessColumns = new Set(byName.get("protocol_user_access")?.columns.map((column) => column.name));
  assert.equal(endpointColumns.has("hostId"), true);
  assert.equal(endpointColumns.has("forwardRuleId"), true);
  assert.equal(accessColumns.has("userId"), true);
  assert.equal(endpointColumns.has("trafficUsed"), false);
  assert.equal(accessColumns.has("trafficUsed"), false);
});

const nobrandRegistry = {
  schema_version: 3,
  project: "NoBrand-OneClick",
  ownership: "nobrand-v3",
  author: "ike",
};

const mieruInstallState = [
  "SCHEMA_VERSION=3",
  "OWNERSHIP=nobrand-v3",
  "INSTALL_METHOD=nobrand-v3",
  "PROTOCOL=BOTH",
  "MTU=1400",
  "TRAFFIC_PATTERN=off",
  "LOW_ENTROPY_MODE=LOW_ENTROPY_MODE_OFF",
  "MULTIPLEXING=MULTIPLEXING_OFF",
  "HANDSHAKE_MODE=HANDSHAKE_NO_WAIT",
].join("\n");

const mieruUsersState = {
  version: 2,
  deployment_model: "isolated-v2",
  protocol: "BOTH",
  users: [{
    instance_id: "u0123456789abcdef",
    name: "dual-user",
    password: "mieru-secret",
    port: 11464,
    advertise_host: "211.136.162.188",
    advertise_port: 15800,
    enabled: true,
  }],
};

test("NoBrand provider translates trusted v3 Mieru/Snell/HY2 state into external feed-compatible nodes", () => {
  const parsed = parseNoBrandProviderSnapshot({
    registry: nobrandRegistry,
    autoPublicHost: "203.0.113.9",
    mieruInstallState,
    mieruUsers: mieruUsersState,
    snellStates: [{
      protocol: "snell",
      instance_id: "s0123456789abcdef",
      name: "snell-v5",
      version: 5,
      psk: "snell-secret",
      listen_host: "0.0.0.0",
      listen_port: 13501,
      advertise_mode: "auto",
      advertise_host: "",
      advertise_port: "",
      enabled: true,
      quic_proxy_enabled: false,
    }],
    hysteria2State: {
      protocol: "hysteria2",
      auth: "hy2-auth",
      sni: "www.cloudflare.com",
      obfs: "hy2-obfs",
      listen_host: "0.0.0.0",
      listen_port: 50392,
      advertise_mode: "custom",
      advertise_host: "109.107.137.246",
      advertise_port: 10121,
      enabled: true,
    },
    vlessSudokuState: {
      protocol: "vless-sudoku",
    },
  });

  assert.equal(parsed.registryValid, true);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.nodes.length, 4);

  const mieruTcp = parsed.nodes.find((node) => node.sourceKey === "mieru:u0123456789abcdef:tcp");
  const mieruUdp = parsed.nodes.find((node) => node.sourceKey === "mieru:u0123456789abcdef:udp");
  assert.equal(mieruTcp?.publicHost, "211.136.162.188");
  assert.equal(mieruTcp?.publicPort, 15800);
  assert.equal(mieruUdp?.publicPort, 15801);
  assert.equal(mieruTcp?.endpointConfig.transport, "TCP");
  assert.equal(mieruUdp?.endpointConfig.transport, "UDP");
  assert.equal(mieruTcp?.endpointConfig.trafficPattern, "");
  assert.equal(mieruUdp?.endpointConfig.trafficPattern, "");
  assert.deepEqual(mieruTcp?.credential, { username: "dual-user", password: "mieru-secret" });

  const snell = parsed.nodes.find((node) => node.protocol === "snell");
  assert.equal(snell?.publicHost, "203.0.113.9");
  assert.equal(snell?.publicPort, 13501);
  assert.equal(snell?.endpointConfig.version, 5);
  assert.equal(snell?.endpointConfig.udp, false);

  const hy2 = parsed.nodes.find((node) => node.protocol === "hysteria2");
  assert.equal(hy2?.publicHost, "109.107.137.246");
  assert.equal(hy2?.publicPort, 10121);
  assert.equal(hy2?.endpointConfig.sni, "www.cloudflare.com");
  assert.equal(hy2?.endpointConfig.obfsMode, "salamander");
  assert.equal(hy2?.endpointConfig.obfsPassword, "hy2-obfs");
  assert.deepEqual(hy2?.credential, { password: "hy2-auth" });

  for (const [index, node] of parsed.nodes.entries()) {
    assert.deepEqual(validateProtocolFeedEntry({
      assignmentId: index + 1,
      endpointId: index + 1,
      name: node.name,
      protocol: node.protocol,
      publicHost: node.publicHost,
      publicPort: node.publicPort,
      endpointConfig: node.endpointConfig,
      credential: node.credential,
    }), []);
  }

  assert.equal(parsed.skipped.some((item) => item.sourceKey === "vless-sudoku:default"
    && item.reason.includes("不把 VLESS + FinalMask Sudoku 伪装成 Reality")), true);
});

test("NoBrand provider fails closed on unknown ownership and never parses child secrets", () => {
  const parsed = parseNoBrandProviderSnapshot({
    registry: { ...nobrandRegistry, ownership: "legacy" },
    autoPublicHost: "203.0.113.9",
    hysteria2State: {
      protocol: "hysteria2",
      auth: "must-not-import",
      sni: "example.com",
      listen_port: 443,
      advertise_mode: "auto",
    },
  });
  assert.equal(parsed.registryValid, false);
  assert.deepEqual(parsed.nodes, []);
  assert.equal(parsed.errors.length, 1);
});

test("NoBrand provider refuses to guess Mieru settings when v3 install state disagrees with users state", () => {
  const parsed = parseNoBrandProviderSnapshot({
    registry: JSON.stringify(nobrandRegistry),
    autoPublicHost: "203.0.113.9",
    mieruInstallState: mieruInstallState.replace("PROTOCOL=BOTH", "PROTOCOL=TCP"),
    mieruUsers: mieruUsersState,
  });
  assert.deepEqual(parsed.nodes, []);
  assert.equal(parsed.skipped.some((item) => item.sourceKey === "mieru" && item.reason.includes("状态不一致")), true);
});

test("NoBrand provider skips Mieru when traffic-pattern needs an actual Mita export", () => {
  const parsed = parseNoBrandProviderSnapshot({
    registry: nobrandRegistry,
    autoPublicHost: "203.0.113.9",
    mieruInstallState: mieruInstallState.replace("TRAFFIC_PATTERN=off", "TRAFFIC_PATTERN=conservative"),
    mieruUsers: mieruUsersState,
  });
  assert.deepEqual(parsed.nodes, []);
  assert.equal(parsed.skipped.some((item) => item.sourceKey === "mieru" && item.reason.includes("实际导出值")), true);
});

test("NoBrand provider skips Mieru when Low Entropy cannot be expressed losslessly", () => {
  const parsed = parseNoBrandProviderSnapshot({
    registry: nobrandRegistry,
    autoPublicHost: "203.0.113.9",
    mieruInstallState: mieruInstallState.replace("LOW_ENTROPY_MODE=LOW_ENTROPY_MODE_OFF", "LOW_ENTROPY_MODE=LOW_ENTROPY_MODE_56"),
    mieruUsers: mieruUsersState,
  });
  assert.deepEqual(parsed.nodes, []);
  assert.equal(parsed.skipped.some((item) => item.sourceKey === "mieru" && item.reason.includes("Low Entropy")), true);
});
