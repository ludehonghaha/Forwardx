import {
  dualAgentDiscoveryRequestSchema,
  dualAgentDiscoveryResponseSchema,
  type DualAgentDiscoveryRequest,
  type DualAgentDiscoveryResponse,
} from "../shared/dualAgentDiscoveryProtocol";
import { compileDualDiscoveryEvidence } from "./dualDiscoveryEvidence";

export function parseDualAgentDiscoveryRequest(input: unknown): DualAgentDiscoveryRequest {
  return dualAgentDiscoveryRequestSchema.parse(input);
}

export function validateDualAgentDiscoveryResponse(
  requestInput: unknown,
  responseInput: unknown,
): DualAgentDiscoveryResponse {
  const request = dualAgentDiscoveryRequestSchema.parse(requestInput);
  const response = dualAgentDiscoveryResponseSchema.parse(responseInput);
  if (response.requestId !== request.requestId) {
    throw new Error("Dual Agent discovery requestId mismatch");
  }
  if (response.targetId !== request.targetId) {
    throw new Error("Dual Agent discovery targetId mismatch");
  }
  if (response.status === "ok") {
    if (response.evidence.targetId !== request.targetId) {
      throw new Error("Dual Agent discovery evidence targetId mismatch");
    }
    if (response.evidence.provenance !== "agent-read-only") {
      throw new Error("Dual Agent discovery response 必须携带 agent-read-only provenance");
    }
  }
  return response;
}

export function compileSuccessfulDualAgentDiscoveryResponse(
  requestInput: unknown,
  responseInput: unknown,
) {
  const response = validateDualAgentDiscoveryResponse(requestInput, responseInput);
  if (response.status !== "ok") {
    throw new Error(`Dual Agent discovery failed: ${response.error.code}: ${response.error.message}`);
  }
  return compileDualDiscoveryEvidence(response.evidence, { expectedTargetId: response.targetId });
}
