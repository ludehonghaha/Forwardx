import type { DualTargetDiscoverySnapshot } from "./dualMultipath";

export type DualCarrierAdapterSafety = {
  commandExecution: false;
  packageInstall: false;
  serviceMutation: false;
  firewallMutation: false;
  routeMutation: false;
};

export type DualCarrierValidation = {
  valid: boolean;
  blockers: readonly string[];
};

export type DualCarrierRenderedPreview = {
  format: "redacted-json";
  value: unknown;
};

export type DualCarrierDryRunResult<TDiscovery, TPlan> = {
  mode: "dry-run";
  discovery: TDiscovery;
  plan: TPlan;
  validation: DualCarrierValidation;
  rendered: DualCarrierRenderedPreview;
  safety: DualCarrierAdapterSafety;
};

/**
 * Pure/offline carrier adapter contract.
 *
 * Implementations may interpret already-collected discovery facts, but this
 * contract intentionally has no shell/SSH/systemd/firewall execution surface.
 */
export interface DualCarrierAdapter<TInput, TDiscovery, TPlan> {
  readonly kind: "mieru" | "hysteria2";
  discover(input: TInput): TDiscovery;
  plan(input: TInput, discovery: TDiscovery): TPlan;
  validate(plan: TPlan): DualCarrierValidation;
  render(plan: TPlan): DualCarrierRenderedPreview;
  dryRun(input: TInput): DualCarrierDryRunResult<TDiscovery, TPlan>;
}

export type DualCarrierTargetContext = {
  targetDiscovery: DualTargetDiscoverySnapshot;
  multipathTarget: {
    host: "127.0.0.1";
    port: number;
  };
};
