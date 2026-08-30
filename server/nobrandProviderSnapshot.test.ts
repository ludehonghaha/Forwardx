import assert from "node:assert/strict";
import test from "node:test";
import { validateProtocolEndpointConfig } from "../shared/protocolAccess";
import { parseNoBrandProviderSnapshot } from "./nobrandProviderSnapshot";

function snapshot() {
  return {
    registry: {
      schema_version: 3,
      project: "NoBrand-OneClick",
      ownership: "nobrand-v3",
    },
    mieruInstallState: [
      "PROTOCOL=TCP",
      "MTU=1400",
      "MULTIPLEXING=MULTIPLEXING_OFF",
      "HANDSHAKE_MODE=HANDSHAKE_NO_WAIT",
      "TRAFFIC_PATTERN=conservative",
      "ADVERTISE_HOST=stale.example.com",
    ].join("\n"),
    mieruUsers: [
      {
        name: "mobile",
        password: "mieru-secret",
        port: 22226,
        advertise_port: 32226,
        advertise_host: "do-not-use.example.com",
        enabled: true,
      },
      {
        name: "disabled",
        password: "disabled-secret",
        port: 22227,
        enabled: false,
      },
    ],
    snellStates: [
      { listen_port: 13501, psk: "snell-secret", version: 5 },
    ],
    hysteria2State: {
      listen_port: 10121,
      password: "hy2-secret",
      server_name: "www.cloudflare.com",
      obfs_password: "hy2-obfs-secret",
    },
    vlessSudokuState: {
      listen_port: 443,
      steal_domain: "www.microsoft.com",
      users: [
        { uuid: "550e8400-e29b-41d4-a716-446655440000", enable: true, label: "sudoku-a" },
        { uuid: "550e8400-e29b-41d4-a716-446655440001", enable: false, label: "disabled" },
      ],
    },
  };
}

test("parses current NoBrand v3 state into deterministic ForwardX candidates", () => {
  const first = parseNoBrandProviderSnapshot(snapshot(), "109.107.137.246");
  const second = parseNoBrandProviderSnapshot(snapshot(), "109.107.137.246");
  assert.equal(first.length, 4);
  assert.deepEqual(first.map((item) => item.candidateId), second.map((item) => item.candidateId));
  assert.ok(first.every((item) => item.publicHost === "109.107.137.246"));

  const mieru = first.find((item) => item.sourceKind === "mieru");
  assert.ok(mieru);
  assert.equal(mieru.supported, true);
  assert.equal(mieru.protocol, "mieru");
  assert.equal(mieru.publicPort, 32226);
  assert.deepEqual(mieru.config, {
    username: "mobile",
    password: "mieru-secret",
    transport: "TCP",
    multiplexing: "MULTIPLEXING_OFF",
    handshakeMode: "HANDSHAKE_NO_WAIT",
    mtu: 1400,
    udp: false,
    trafficPattern: "conservative",
  });

  const snell = first.find((item) => item.sourceKind === "snell");
  assert.ok(snell);
  assert.equal(snell.protocol, "snell");
  assert.equal(snell.config.password, "snell-secret");

  const hy2 = first.find((item) => item.sourceKind === "hysteria2");
  assert.ok(hy2);
  assert.equal(hy2.protocol, "hysteria2");
  assert.deepEqual(hy2.config.alpn, ["h3"]);

  for (const candidate of first.filter((item) => item.supported)) {
    assert.ok(candidate.protocol);
    assert.deepEqual(validateProtocolEndpointConfig(candidate.protocol!, candidate.config), []);
  }
});

test("marks NoBrand VLESS Sudoku unsupported instead of misclassifying it as Reality", () => {
  const candidates = parseNoBrandProviderSnapshot(snapshot(), "109.107.137.246");
  const sudoku = candidates.find((item) => item.sourceKind === "vless-sudoku");
  assert.ok(sudoku);
  assert.equal(sudoku.supported, false);
  assert.equal(sudoku.protocol, null);
  assert.match(sudoku.unsupportedReason || "", /普通 TLS VLESS/);
  assert.equal(sudoku.config.uuid, "550e8400-e29b-41d4-a716-446655440000");
});

test("rejects snapshots that do not carry the exact NoBrand v3 ownership marker", () => {
  const bad = snapshot();
  bad.registry.ownership = "someone-else";
  assert.throws(
    () => parseNoBrandProviderSnapshot(bad, "109.107.137.246"),
    /ownership marker/,
  );
});

test("uses ForwardX host ingress instead of NoBrand advertise_host", () => {
  const candidates = parseNoBrandProviderSnapshot(snapshot(), "panel-ingress.example.com");
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every((item) => item.publicHost === "panel-ingress.example.com"));
  assert.ok(candidates.every((item) => item.publicHost !== "do-not-use.example.com"));
});
