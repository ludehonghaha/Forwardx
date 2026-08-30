import { z } from "zod";
import { dualDiscoveryEvidenceBundleSchema } from "./dualDiscoveryEvidence";
import { dualPortSchema } from "./dualMultipath";

export const DUAL_AGENT_DISCOVERY_PROTOCOL_VERSION = 1 as const;
export const DUAL_AGENT_DISCOVERY_OPERATION = "dual-readonly-discovery" as const;

const identifierSchema = z.string().trim().min(1).max(128);
const loopbackAddressSchema = z.literal("127.0.0.1");

const candidatePortsSchema = z.array(dualPortSchema).min(1).max(128).superRefine((ports, ctx) => {
  const seen = new Set<number>();
  for (let index = 0; index < ports.length; index += 1) {
    if (seen.has(ports[index])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: "candidate port 不允许重复",
      });
    }
    seen.add(ports[index]);
  }
});

export const dualAgentDiscoveryRequestSchema = z.object({
  version: z.literal(DUAL_AGENT_DISCOVERY_PROTOCOL_VERSION),
  operation: z.literal(DUAL_AGENT_DISCOVERY_OPERATION),
  requestId: identifierSchema,
  targetId: identifierSchema,
  portProbes: z.array(z.object({
    address: loopbackAddressSchema,
    protocol: z.literal("tcp"),
    candidates: candidatePortsSchema,
  }).strict()).max(8),
}).strict();

const responseBase = {
  version: z.literal(DUAL_AGENT_DISCOVERY_PROTOCOL_VERSION),
  operation: z.literal(DUAL_AGENT_DISCOVERY_OPERATION),
  requestId: identifierSchema,
  targetId: identifierSchema,
};

export const dualAgentDiscoveryResponseSchema = z.discriminatedUnion("status", [
  z.object({
    ...responseBase,
    status: z.literal("ok"),
    evidence: dualDiscoveryEvidenceBundleSchema,
  }).strict(),
  z.object({
    ...responseBase,
    status: z.literal("failed"),
    error: z.object({
      code: z.enum(["invalid-request", "unsupported", "collection-failed"]),
      message: z.string().trim().min(1).max(512),
    }).strict(),
  }).strict(),
]);

export type DualAgentDiscoveryRequest = z.output<typeof dualAgentDiscoveryRequestSchema>;
export type DualAgentDiscoveryResponse = z.output<typeof dualAgentDiscoveryResponseSchema>;
