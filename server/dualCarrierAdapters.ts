import type {
  DualCarrierAdapter,
  DualCarrierAdapterSafety,
  DualCarrierDryRunResult,
  DualCarrierRenderedPreview,
  DualCarrierValidation,
  DualCarrierTargetContext,
} from "../shared/dualCarrierAdapter";
import type { DualMultipathDraftV3, DualTargetDiscoverySnapshot } from "../shared/dualMultipath";

const OFFLINE_SAFETY: DualCarrierAdapterSafety = {
  commandExecution: false,
  packageInstall: false,
  serviceMutation: false,
  firewallMutation: false,
  routeMutation: false,
};

export type DualExternalEntry = {
  host: string;
  port: number;
};

export type MieruCarrierAdapterInput = DualCarrierTargetContext & {
  externalEntry?: DualExternalEntry | null;
};

export type MieruCarrierDiscovery = {
  status: "unresolved" | "partial" | "resolved";
  localListener: {
    network: "tcp";
    listen: string;
    port: number;
    lifecycle: "preserve";
  } | null;
  externalEntry: DualExternalEntry | null;
};

export type MieruCarrierPlan = MieruCarrierDiscovery & {
  kind: "mieru";
  mode: "dry-run";
  multipathTarget: DualCarrierTargetContext["multipathTarget"];
  blockers: readonly string[];
};

function discoverMieru(input: MieruCarrierAdapterInput): MieruCarrierDiscovery {
  const discovery = input.targetDiscovery;
  const localListener = discovery.status === "verified-read-only"
    ? {
        network: discovery.existingPrivateCarrier.listener.network,
        listen: discovery.existingPrivateCarrier.listener.listen,
        port: discovery.existingPrivateCarrier.listener.port,
        lifecycle: discovery.existingPrivateCarrier.lifecycle,
      }
    : null;
  const externalEntry = input.externalEntry ?? null;
  return {
    status: localListener && externalEntry ? "resolved" : localListener || externalEntry ? "partial" : "unresolved",
    localListener,
    externalEntry,
  };
}

function planMieru(input: MieruCarrierAdapterInput, discovery: MieruCarrierDiscovery): MieruCarrierPlan {
  const blockers = [
    ...(discovery.localListener ? [] : ["Mieru server local listener 尚未从 target discovery 得到验证"]),
    ...(discovery.externalEntry ? [] : ["NoBrand external/mobile entry 尚未提供；不能把本机 listener 当作客户端入口"]),
  ];
  return {
    kind: "mieru",
    mode: "dry-run",
    status: blockers.length === 0 ? "resolved" : discovery.status,
    localListener: discovery.localListener,
    externalEntry: discovery.externalEntry,
    multipathTarget: input.multipathTarget,
    blockers,
  };
}

function validateMieru(plan: MieruCarrierPlan): DualCarrierValidation {
  return { valid: plan.blockers.length === 0, blockers: plan.blockers };
}

function renderMieru(plan: MieruCarrierPlan): DualCarrierRenderedPreview {
  return {
    format: "redacted-json",
    value: {
      kind: plan.kind,
      status: plan.status,
      localListener: plan.localListener,
      externalEntry: plan.externalEntry,
      multipathTarget: plan.multipathTarget,
      credentials: "<secret-ref-only>",
    },
  };
}

function dryRunMieru(input: MieruCarrierAdapterInput): DualCarrierDryRunResult<MieruCarrierDiscovery, MieruCarrierPlan> {
  const discovery = discoverMieru(input);
  const plan = planMieru(input, discovery);
  return {
    mode: "dry-run",
    discovery,
    plan,
    validation: validateMieru(plan),
    rendered: renderMieru(plan),
    safety: OFFLINE_SAFETY,
  };
}

export const mieruCarrierAdapter: DualCarrierAdapter<MieruCarrierAdapterInput, MieruCarrierDiscovery, MieruCarrierPlan> = {
  kind: "mieru",
  discover: discoverMieru,
  plan: planMieru,
  validate: validateMieru,
  render: renderMieru,
  dryRun: dryRunMieru,
};

export type Hysteria2CarrierAdapterInput = {
  draft: DualMultipathDraftV3;
};

export type Hysteria2CarrierDiscovery = {
  bind: {
    interfaceName: string;
    sourceAddress: string;
  } | null;
  endpoint: {
    server: string;
    port: number;
    tlsServerName: string;
  } | null;
};

export type Hysteria2CarrierPlan = Hysteria2CarrierDiscovery & {
  kind: "hysteria2";
  mode: "dry-run";
  authSecretRef: string;
  blockers: readonly string[];
};

function discoverPublicBind(discovery: DualTargetDiscoverySnapshot) {
  return discovery.status === "verified-read-only"
    ? { interfaceName: discovery.publicSide.interfaceName, sourceAddress: discovery.publicSide.sourceAddress }
    : null;
}

function discoverHysteria2(input: Hysteria2CarrierAdapterInput): Hysteria2CarrierDiscovery {
  const carrier = input.draft.directCarrier;
  return {
    bind: discoverPublicBind(input.draft.targetDiscovery),
    endpoint: carrier.status === "resolved" && carrier.serverPort !== null && carrier.tls.serverName !== null
      ? { server: carrier.server, port: carrier.serverPort, tlsServerName: carrier.tls.serverName }
      : null,
  };
}

function planHysteria2(input: Hysteria2CarrierAdapterInput, discovery: Hysteria2CarrierDiscovery): Hysteria2CarrierPlan {
  const blockers = [
    ...(discovery.bind ? [] : ["Hysteria2 public bind 尚未从 target discovery 得到验证"]),
    ...(discovery.endpoint ? [] : ["Hysteria2 endpoint/TLS 尚未解析"]),
  ];
  return {
    kind: "hysteria2",
    mode: "dry-run",
    bind: discovery.bind,
    endpoint: discovery.endpoint,
    authSecretRef: input.draft.directCarrier.authSecretRef,
    blockers,
  };
}

function validateHysteria2(plan: Hysteria2CarrierPlan): DualCarrierValidation {
  return { valid: plan.blockers.length === 0, blockers: plan.blockers };
}

function renderHysteria2(plan: Hysteria2CarrierPlan): DualCarrierRenderedPreview {
  return {
    format: "redacted-json",
    value: {
      kind: plan.kind,
      bind: plan.bind,
      endpoint: plan.endpoint,
      auth: `<secret:${plan.authSecretRef}>`,
    },
  };
}

function dryRunHysteria2(input: Hysteria2CarrierAdapterInput): DualCarrierDryRunResult<Hysteria2CarrierDiscovery, Hysteria2CarrierPlan> {
  const discovery = discoverHysteria2(input);
  const plan = planHysteria2(input, discovery);
  return {
    mode: "dry-run",
    discovery,
    plan,
    validation: validateHysteria2(plan),
    rendered: renderHysteria2(plan),
    safety: OFFLINE_SAFETY,
  };
}

export const hysteria2CarrierAdapter: DualCarrierAdapter<Hysteria2CarrierAdapterInput, Hysteria2CarrierDiscovery, Hysteria2CarrierPlan> = {
  kind: "hysteria2",
  discover: discoverHysteria2,
  plan: planHysteria2,
  validate: validateHysteria2,
  render: renderHysteria2,
  dryRun: dryRunHysteria2,
};
