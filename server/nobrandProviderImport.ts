import {
  parseProtocolAccessConfig,
  protocolConfigText,
  validateProtocolFeedEntry,
  type ProtocolAccessConfig,
} from "../shared/protocolAccess";
import type { NoBrandProtocolCandidate } from "./nobrandProviderSnapshot";

const PROVIDER_SOURCE_KEY = "_forwardxProviderSource";
const PROVIDER_CANDIDATE_ID_KEY = "_forwardxProviderCandidateId";
const PROVIDER_HOST_ID_KEY = "_forwardxProviderHostId";
const PROVIDER_SOURCE_KIND_KEY = "_forwardxProviderSourceKind";

export type ExistingProtocolEndpointLike = {
  id?: unknown;
  protocol?: unknown;
  publicHost?: unknown;
  publicPort?: unknown;
  configJson?: unknown;
};

export type NoBrandImportDuplicate = {
  candidateId: string;
  endpointId: number | null;
};

export type NoBrandImportPlanItem = {
  candidate: NoBrandProtocolCandidate & { supported: true; protocol: NonNullable<NoBrandProtocolCandidate["protocol"]> };
  config: ProtocolAccessConfig;
};

function normalizedHost(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function endpointId(value: unknown) {
  const id = Math.floor(Number(value));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function candidateIdentity(candidate: NoBrandProtocolCandidate) {
  if (candidate.protocol === "mieru") return protocolConfigText(candidate.config, "username");
  return "";
}

function endpointIdentity(endpoint: ExistingProtocolEndpointLike) {
  if (String(endpoint.protocol || "") !== "mieru") return "";
  return protocolConfigText(parseProtocolAccessConfig(endpoint.configJson), "username");
}

export function withNoBrandImportMetadata(candidate: NoBrandProtocolCandidate, hostId: number) {
  return {
    ...candidate.config,
    [PROVIDER_SOURCE_KEY]: "nobrand",
    [PROVIDER_CANDIDATE_ID_KEY]: candidate.candidateId,
    [PROVIDER_HOST_ID_KEY]: hostId,
    [PROVIDER_SOURCE_KIND_KEY]: candidate.sourceKind,
  } as ProtocolAccessConfig;
}

export function findNoBrandImportDuplicate(
  candidate: NoBrandProtocolCandidate,
  existingEndpoints: ExistingProtocolEndpointLike[],
) {
  for (const endpoint of existingEndpoints) {
    const config = parseProtocolAccessConfig(endpoint.configJson);
    if (
      protocolConfigText(config, PROVIDER_SOURCE_KEY) === "nobrand"
      && protocolConfigText(config, PROVIDER_CANDIDATE_ID_KEY) === candidate.candidateId
    ) {
      return endpoint;
    }
  }

  const identity = candidateIdentity(candidate);
  return existingEndpoints.find((endpoint) => (
    String(endpoint.protocol || "") === String(candidate.protocol || "")
    && normalizedHost(endpoint.publicHost) === normalizedHost(candidate.publicHost)
    && Number(endpoint.publicPort) === candidate.publicPort
    && endpointIdentity(endpoint) === identity
  ));
}

function validateCandidate(candidate: NoBrandProtocolCandidate) {
  if (!candidate.supported || !candidate.protocol) {
    throw new Error(candidate.unsupportedReason || `候选节点 ${candidate.name} 暂不支持导入`);
  }
  const errors = validateProtocolFeedEntry({
    assignmentId: 1,
    endpointId: 1,
    name: candidate.name,
    protocol: candidate.protocol,
    publicHost: candidate.publicHost,
    publicPort: candidate.publicPort,
    endpointConfig: candidate.config,
    credential: {},
  });
  if (errors.length > 0) {
    throw new Error(`候选节点 ${candidate.name} 配置无效：${errors.join("；")}`);
  }
  return candidate as NoBrandImportPlanItem["candidate"];
}

/**
 * Resolve an explicit selection against the latest ephemeral scan result before
 * any database write occurs. Unknown or unsupported selections fail the whole
 * request, while already-imported endpoints are reported as duplicates.
 */
export function planNoBrandCandidateImports(input: {
  hostId: number;
  candidates: NoBrandProtocolCandidate[];
  selectedCandidateIds: string[];
  existingEndpoints: ExistingProtocolEndpointLike[];
}) {
  const hostId = Math.floor(Number(input.hostId));
  if (!Number.isInteger(hostId) || hostId <= 0) throw new Error("NoBrand 导入主机无效");

  const selectedIds = Array.from(new Set(input.selectedCandidateIds.map((value) => String(value || "").trim()).filter(Boolean)));
  if (selectedIds.length === 0) throw new Error("请选择至少一个 NoBrand 候选节点");

  const byId = new Map(input.candidates.map((candidate) => [candidate.candidateId, candidate]));
  const working = [...input.existingEndpoints];
  const create: NoBrandImportPlanItem[] = [];
  const duplicates: NoBrandImportDuplicate[] = [];

  for (const candidateId of selectedIds) {
    const rawCandidate = byId.get(candidateId);
    if (!rawCandidate) throw new Error("候选节点已失效，请重新扫描 NoBrand 后再导入");
    const candidate = validateCandidate(rawCandidate);
    const duplicate = findNoBrandImportDuplicate(candidate, working);
    if (duplicate) {
      duplicates.push({ candidateId, endpointId: endpointId(duplicate.id) });
      continue;
    }

    const config = withNoBrandImportMetadata(candidate, hostId);
    create.push({ candidate, config });
    working.push({
      id: null,
      protocol: candidate.protocol,
      publicHost: candidate.publicHost,
      publicPort: candidate.publicPort,
      configJson: config,
    });
  }

  return { create, duplicates };
}
