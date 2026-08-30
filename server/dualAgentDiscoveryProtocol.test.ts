import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  dualAgentDiscoveryRequestSchema,
  dualAgentDiscoveryResponseSchema,
} from "../shared/dualAgentDiscoveryProtocol";
import {
  compileSuccessfulDualAgentDiscoveryResponse,
  parseDualAgentDiscoveryRequest,
  validateDualAgentDiscoveryResponse,
} from "./dualAgentDiscoveryProtocol";

function readFixture(name: string): unknown {
  const path = fileURLToPath(new URL(`../shared/fixtures/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

const requestFixture = readFixture("dual-agent-discovery-request-v1.json");
const responseFixture = readFixture("dual-agent-discovery-response-v1.json");

test("cross-language v1 request fixture is a fixed loopback-only read contract", () => {
  const request = parseDualAgentDiscoveryRequest(requestFixture);
  assert.equal(request.version, 1);
  assert.equal(request.operation, "dual-readonly-discovery");
  assert.equal(request.targetId, "fixture-dual-agent");
  assert.deepEqual(request.portProbes[0], {
    address: "127.0.0.1",
    protocol: "tcp",
    candidates: [24001, 24002],
  });
});

test("matching agent response compiles into target-read-only discovery evidence", () => {
  const response = validateDualAgentDiscoveryResponse(requestFixture, responseFixture);
  assert.equal(response.status, "ok");
  const compiled = compileSuccessfulDualAgentDiscoveryResponse(requestFixture, responseFixture);
  assert.equal(compiled.targetId, "fixture-dual-agent");
  assert.equal(compiled.targetEvidence.source, "target-read-only");
  assert.equal(compiled.snapshot.status, "verified-read-only");
  if (compiled.snapshot.status !== "verified-read-only") throw new Error("expected verified snapshot");
  assert.equal(compiled.snapshot.publicSide.interfaceName, "ens3");
  assert.equal(compiled.snapshot.privateSide.interfaceName, "ens8");
  assert.equal(compiled.snapshot.existingPrivateCarrier.listener.port, 22464);
});

test("requestId and targetId are cryptographically-transport-independent binding fields and must match", () => {
  const response = dualAgentDiscoveryResponseSchema.parse(responseFixture);
  assert.throws(
    () => validateDualAgentDiscoveryResponse(requestFixture, { ...response, requestId: "other-request" }),
    /requestId mismatch/,
  );
  assert.throws(
    () => validateDualAgentDiscoveryResponse(requestFixture, { ...response, targetId: "other-target" }),
    /targetId mismatch/,
  );
  if (response.status !== "ok") throw new Error("expected ok response fixture");
  assert.throws(
    () => validateDualAgentDiscoveryResponse(requestFixture, {
      ...response,
      evidence: { ...response.evidence, targetId: "other-target" },
    }),
    /evidence targetId mismatch/,
  );
});

test("real Agent response cannot relabel synthetic evidence as accepted discovery", () => {
  const response = dualAgentDiscoveryResponseSchema.parse(responseFixture);
  if (response.status !== "ok") throw new Error("expected ok response fixture");
  assert.throws(
    () => validateDualAgentDiscoveryResponse(requestFixture, {
      ...response,
      evidence: { ...response.evidence, provenance: "synthetic" },
    }),
    /agent-read-only provenance/,
  );
});

test("request schema rejects arbitrary executor fields, non-loopback probes and duplicate candidates", () => {
  const request = dualAgentDiscoveryRequestSchema.parse(requestFixture);
  assert.throws(() => dualAgentDiscoveryRequestSchema.parse({ ...request, command: "ip route" }));
  assert.throws(() => dualAgentDiscoveryRequestSchema.parse({
    ...request,
    portProbes: [{ address: "0.0.0.0", protocol: "tcp", candidates: [24001] }],
  }));
  assert.throws(() => dualAgentDiscoveryRequestSchema.parse({
    ...request,
    portProbes: [{ address: "127.0.0.1", protocol: "tcp", candidates: [24001, 24001] }],
  }), /candidate port/);
});

test("failed response is validated but cannot enter the evidence compiler", () => {
  const request = dualAgentDiscoveryRequestSchema.parse(requestFixture);
  const failed = {
    version: 1 as const,
    operation: "dual-readonly-discovery" as const,
    requestId: request.requestId,
    targetId: request.targetId,
    status: "failed" as const,
    error: { code: "collection-failed" as const, message: "read-only collection unavailable" },
  };
  assert.equal(validateDualAgentDiscoveryResponse(request, failed).status, "failed");
  assert.throws(() => compileSuccessfulDualAgentDiscoveryResponse(request, failed), /collection-failed/);
});

test("protocol implementation exposes no arbitrary shell surface and introduces no any", () => {
  const sharedSource = readFileSync(fileURLToPath(new URL("../shared/dualAgentDiscoveryProtocol.ts", import.meta.url)), "utf8");
  const serverSource = readFileSync(fileURLToPath(new URL("./dualAgentDiscoveryProtocol.ts", import.meta.url)), "utf8");
  for (const source of [sharedSource, serverSource]) {
    assert.doesNotMatch(source, /\bany\b/);
    assert.doesNotMatch(source, /\b(command|shell|script|cwd|environment)\s*:/i);
    assert.doesNotMatch(source, /exec\s*\(|spawn\s*\(/i);
  }
});
