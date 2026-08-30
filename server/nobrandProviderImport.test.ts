import assert from "node:assert/strict";
import test from "node:test";
import {
  findNoBrandImportDuplicate,
  planNoBrandCandidateImports,
  withNoBrandImportMetadata,
} from "./nobrandProviderImport";
import type { NoBrandProtocolCandidate } from "./nobrandProviderSnapshot";

function mieruCandidate(overrides: Partial<NoBrandProtocolCandidate> = {}): NoBrandProtocolCandidate {
  return {
    candidateId: "111111111111111111111111",
    source: "nobrand",
    sourceKind: "mieru",
    name: "NoBrand Mieru · alice",
    publicHost: "211.136.162.184",
    publicPort: 22226,
    supported: true,
    protocol: "mieru",
    config: {
      username: "alice",
      password: "mieru-secret",
      transport: "TCP",
      mtu: 1400,
      multiplexing: "MULTIPLEXING_OFF",
      handshakeMode: "HANDSHAKE_NO_WAIT",
      udp: false,
    },
    ...overrides,
  };
}

function hysteria2Candidate(overrides: Partial<NoBrandProtocolCandidate> = {}): NoBrandProtocolCandidate {
  return {
    candidateId: "222222222222222222222222",
    source: "nobrand",
    sourceKind: "hysteria2",
    name: "NoBrand Hysteria2 · 10121",
    publicHost: "109.107.137.246",
    publicPort: 10121,
    supported: true,
    protocol: "hysteria2",
    config: {
      password: "hy2-secret",
      sni: "www.cloudflare.com",
      insecure: true,
      alpn: ["h3"],
      obfsMode: "salamander",
      obfsPassword: "obfs-secret",
    },
    ...overrides,
  };
}

test("imports only explicitly selected supported candidates and stamps provider metadata", () => {
  const plan = planNoBrandCandidateImports({
    hostId: 7,
    candidates: [mieruCandidate(), hysteria2Candidate()],
    selectedCandidateIds: ["222222222222222222222222"],
    existingEndpoints: [],
  });

  assert.equal(plan.create.length, 1);
  assert.equal(plan.duplicates.length, 0);
  assert.equal(plan.create[0]?.candidate.protocol, "hysteria2");
  assert.equal(plan.create[0]?.config._forwardxProviderSource, "nobrand");
  assert.equal(plan.create[0]?.config._forwardxProviderCandidateId, "222222222222222222222222");
  assert.equal(plan.create[0]?.config._forwardxProviderHostId, 7);
  assert.equal(plan.create[0]?.config._forwardxProviderSourceKind, "hysteria2");
});

test("rejects unsupported NoBrand candidates before any write is planned", () => {
  const unsupported = mieruCandidate({
    candidateId: "333333333333333333333333",
    sourceKind: "vless-sudoku",
    name: "NoBrand VLESS Sudoku",
    supported: false,
    protocol: null,
    unsupportedReason: "ordinary TLS VLESS is not Reality",
  });

  assert.throws(() => planNoBrandCandidateImports({
    hostId: 7,
    candidates: [unsupported],
    selectedCandidateIds: [unsupported.candidateId],
    existingEndpoints: [],
  }), /ordinary TLS VLESS is not Reality/);
});

test("rejects stale candidate ids so import always binds to the latest scan", () => {
  assert.throws(() => planNoBrandCandidateImports({
    hostId: 7,
    candidates: [mieruCandidate()],
    selectedCandidateIds: ["aaaaaaaaaaaaaaaaaaaaaaaa"],
    existingEndpoints: [],
  }), /重新扫描 NoBrand/);
});

test("dedupes a previously imported candidate by stable provider metadata", () => {
  const candidate = hysteria2Candidate();
  const metadataConfig = withNoBrandImportMetadata(candidate, 7);
  const plan = planNoBrandCandidateImports({
    hostId: 7,
    candidates: [candidate],
    selectedCandidateIds: [candidate.candidateId],
    existingEndpoints: [{
      id: 91,
      protocol: "hysteria2",
      publicHost: "old.example.invalid",
      publicPort: 49999,
      configJson: JSON.stringify(metadataConfig),
    }],
  });

  assert.equal(plan.create.length, 0);
  assert.deepEqual(plan.duplicates, [{ candidateId: candidate.candidateId, endpointId: 91 }]);
});

test("dedupes manual Mieru endpoints by host, port and username but allows another user", () => {
  const alice = mieruCandidate();
  const existing = [{
    id: 55,
    protocol: "mieru",
    publicHost: "211.136.162.184",
    publicPort: 22226,
    configJson: JSON.stringify({ username: "alice", password: "old-secret" }),
  }];
  assert.equal(findNoBrandImportDuplicate(alice, existing)?.id, 55);

  const bob = mieruCandidate({
    candidateId: "444444444444444444444444",
    name: "NoBrand Mieru · bob",
    config: {
      ...alice.config,
      username: "bob",
      password: "bob-secret",
    },
  });
  const plan = planNoBrandCandidateImports({
    hostId: 7,
    candidates: [bob],
    selectedCandidateIds: [bob.candidateId],
    existingEndpoints: existing,
  });
  assert.equal(plan.create.length, 1);
  assert.equal(plan.duplicates.length, 0);
});

test("repeated candidate ids in one request are imported once", () => {
  const candidate = hysteria2Candidate();
  const plan = planNoBrandCandidateImports({
    hostId: 7,
    candidates: [candidate],
    selectedCandidateIds: [candidate.candidateId, candidate.candidateId],
    existingEndpoints: [],
  });
  assert.equal(plan.create.length, 1);
});
