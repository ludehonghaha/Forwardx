import { z } from "zod";
import { dualPortSchema } from "./dualMultipath";

export const DUAL_DISCOVERY_EVIDENCE_VERSION = 1 as const;

export const dualDiscoveryProvenanceSchema = z.enum(["agent-read-only", "synthetic"]);

const targetIdSchema = z.string().trim().min(1).max(128);
const addressSchema = z.string().trim().min(1).max(255);
const interfaceNameSchema = z.string().trim().min(1).max(64);

const platformObservationSchema = z.object({
  kind: z.literal("platform"),
  kernel: z.string().trim().min(1).max(64),
  architecture: z.string().trim().min(1).max(64),
}).strict();

const interfaceObservationSchema = z.object({
  kind: z.literal("interface"),
  interfaceName: interfaceNameSchema,
  addresses: z.array(addressSchema).min(1),
}).strict();

const defaultRouteObservationSchema = z.object({
  kind: z.literal("default-route"),
  dev: interfaceNameSchema,
  via: addressSchema,
  sourceAddress: addressSchema,
}).strict();

const privateSideObservationSchema = z.object({
  kind: z.literal("private-side"),
  interfaceName: interfaceNameSchema,
  sourceAddress: addressSchema,
}).strict();

const mitaRuntimeObservationSchema = z.object({
  kind: z.literal("mita-runtime"),
  binaryPath: z.string().trim().min(1).max(255).nullable(),
  serviceStatus: z.enum(["active", "inactive", "failed", "unknown"]),
  listener: z.object({
    network: z.literal("tcp"),
    listen: addressSchema,
    port: dualPortSchema,
  }).strict(),
  lifecycle: z.literal("preserve"),
}).strict();

const installedBinariesObservationSchema = z.object({
  kind: z.literal("installed-binaries"),
  singBox: z.boolean(),
  hysteria: z.boolean(),
  standaloneMieru: z.boolean(),
}).strict();

const portProbeObservationSchema = z.object({
  kind: z.literal("port-probe"),
  address: addressSchema,
  protocol: z.enum(["tcp", "udp"]),
  port: dualPortSchema,
  availability: z.enum(["available", "occupied", "unknown"]),
}).strict();

export const dualDiscoveryObservationSchema = z.discriminatedUnion("kind", [
  platformObservationSchema,
  interfaceObservationSchema,
  defaultRouteObservationSchema,
  privateSideObservationSchema,
  mitaRuntimeObservationSchema,
  installedBinariesObservationSchema,
  portProbeObservationSchema,
]);

export const dualDiscoveryEvidenceBundleSchema = z.object({
  version: z.literal(DUAL_DISCOVERY_EVIDENCE_VERSION),
  targetId: targetIdSchema,
  evidenceId: z.string().trim().min(1).max(128),
  provenance: dualDiscoveryProvenanceSchema,
  observations: z.array(dualDiscoveryObservationSchema).min(1),
}).strict();

export type DualDiscoveryProvenance = z.output<typeof dualDiscoveryProvenanceSchema>;
export type DualDiscoveryObservation = z.output<typeof dualDiscoveryObservationSchema>;
export type DualDiscoveryEvidenceBundle = z.output<typeof dualDiscoveryEvidenceBundleSchema>;
export type DualDiscoveryPortProbeObservation = Extract<DualDiscoveryObservation, { kind: "port-probe" }>;
