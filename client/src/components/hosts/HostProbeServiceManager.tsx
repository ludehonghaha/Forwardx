import type { ComponentProps } from "react";
import BaseHostProbeServiceManager from "./HostProbeServiceManagerBase";
import HostProbeCarrierHistory from "./HostProbeCarrierHistory";

export type { HostProbeServiceViewMode } from "./HostProbeServiceManagerBase";

type HostProbeServiceManagerProps = ComponentProps<typeof BaseHostProbeServiceManager>;

export default function HostProbeServiceManager(props: HostProbeServiceManagerProps) {
  return (
    <div className="space-y-4">
      <HostProbeCarrierHistory />
      <BaseHostProbeServiceManager {...props} />
    </div>
  );
}
