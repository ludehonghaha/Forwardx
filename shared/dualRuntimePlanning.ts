import { z } from "zod";
import { dualPortSchema } from "./dualMultipath";

export const dualEvidenceSourceSchema = z.enum([
  "none",
  "target-read-only",
  "repository-ci",
  "synthetic",
]);

export const dualEvidenceCheckSchema = z.object({
  status: z.enum(["unverified", "verified"]),
  source: dualEvidenceSourceSchema,
  targetId: z.string().trim().min(1).max(128).nullable(),
}).strict().superRefine((evidence, ctx) => {
  if (evidence.status === "verified" && evidence.source === "none") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["source"], message: "verified evidence 必须声明来源" });
  }
  if (evidence.status === "verified" && evidence.targetId === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["targetId"], message: "verified evidence 必须绑定 targetId" });
  }
});

export const dualArtifactRequirementSchema = z.object({
  component: z.string().trim().min(1).max(128),
  platform: z.string().trim().min(1).max(64),
  arch: z.string().trim().min(1).max(64),
  version: z.string().trim().min(1).max(128).nullable(),
  source: z.string().trim().min(1).max(512).nullable(),
  sha256: z.string().trim().regex(/^[a-f0-9]{64}$/i, "SHA256 必须是 64 位十六进制").nullable(),
  verificationStatus: z.enum(["unresolved", "pinned", "verified"]),
}).strict().superRefine((artifact, ctx) => {
  if (artifact.verificationStatus !== "unresolved" && (!artifact.version || !artifact.source || !artifact.sha256)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["verificationStatus"],
      message: "pinned/verified artifact 必须同时包含 exact version、source 和 SHA256",
    });
  }
});

export const dualPortProbeEvidenceSchema = z.object({
  targetId: z.string().trim().min(1).max(128),
  address: z.string().trim().min(1).max(255),
  protocol: z.enum(["tcp", "udp"]),
  port: dualPortSchema,
  availability: z.enum(["available", "occupied", "unknown"]),
  source: z.enum(["target-read-only", "synthetic"]),
}).strict();

export const dualAutoPortPlanSchema = z.union([
  z.object({
    portStrategy: z.literal("auto"),
    status: z.literal("resolved"),
    port: dualPortSchema,
    evidence: dualPortProbeEvidenceSchema,
  }).strict(),
  z.object({
    portStrategy: z.literal("auto"),
    status: z.literal("unresolved"),
    port: z.null(),
    checked: z.array(dualPortProbeEvidenceSchema),
    reason: z.enum(["no-candidates", "no-confirmed-available-port"]),
  }).strict(),
]);

export const dualReadinessBlockerCodeSchema = z.enum([
  "TARGET_DISCOVERY_UNVERIFIED",
  "CLIENT_PORTS_UNRESOLVED",
  "PRIVATE_CARRIER_DISCOVERY_UNVERIFIED",
  "HY2_RUNTIME_CONFIG_UNRESOLVED",
  "SERVER_ARTIFACT_UNPINNED",
  "CLIENT_ARTIFACT_UNPINNED",
  "MIHOMO_CONFIG_UNVALIDATED",
  "SING_BOX_CONFIG_UNVALIDATED",
  "PRIVATE_CARRIER_REACHABILITY_UNVERIFIED",
  "DIRECT_CARRIER_REACHABILITY_UNVERIFIED",
  "SECRET_RESOLUTION_UNVERIFIED",
  "GRAY_LIFECYCLE_UNVERIFIED",
  "ROLLBACK_PLAN_UNVERIFIED",
]);

export const dualReadinessCategorySchema = z.enum([
  "discovery",
  "ports",
  "runtime",
  "artifact",
  "validation",
  "reachability",
  "secrets",
  "lifecycle",
]);

export const dualReadinessBlockerSchema = z.object({
  code: dualReadinessBlockerCodeSchema,
  category: dualReadinessCategorySchema,
  message: z.string().trim().min(1).max(512),
}).strict();

export const dualDeploymentEvidenceSchema = z.object({
  targetId: z.string().trim().min(1).max(128),
  clientPorts: dualEvidenceCheckSchema,
  privateCarrierDiscovery: dualEvidenceCheckSchema,
  hy2RuntimeConfig: dualEvidenceCheckSchema,
  mihomoConfigValidation: dualEvidenceCheckSchema,
  singBoxConfigValidation: dualEvidenceCheckSchema,
  privateCarrierReachability: dualEvidenceCheckSchema,
  directCarrierReachability: dualEvidenceCheckSchema,
  secretResolution: dualEvidenceCheckSchema,
  grayLifecycle: dualEvidenceCheckSchema,
  rollbackPlan: dualEvidenceCheckSchema,
  artifacts: z.object({
    client: dualArtifactRequirementSchema,
    server: dualArtifactRequirementSchema,
  }).strict(),
}).strict();

export const dualDeploymentReadinessSchema = z.object({
  status: z.enum(["blocked", "ready"]),
  readyToDeploy: z.boolean(),
  targetId: z.string().trim().min(1).max(128),
  blockers: z.array(dualReadinessBlockerSchema),
  artifactRequirements: z.object({
    client: dualArtifactRequirementSchema,
    server: dualArtifactRequirementSchema,
  }).strict(),
}).strict();

export type DualEvidenceCheck = z.output<typeof dualEvidenceCheckSchema>;
export type DualArtifactRequirement = z.output<typeof dualArtifactRequirementSchema>;
export type DualPortProbeEvidence = z.output<typeof dualPortProbeEvidenceSchema>;
export type DualAutoPortPlan = z.output<typeof dualAutoPortPlanSchema>;
export type DualReadinessBlocker = z.output<typeof dualReadinessBlockerSchema>;
export type DualDeploymentEvidence = z.output<typeof dualDeploymentEvidenceSchema>;
export type DualDeploymentReadiness = z.output<typeof dualDeploymentReadinessSchema>;
