import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { pollingInterval } from "@/lib/polling";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ChinaCarrierProbeOverview, {
  type ChinaCarrierProbeOverviewHost,
  type ChinaCarrierProbeOverviewItem,
} from "@/components/hosts/ChinaCarrierProbeOverview";
import type { HostProbeCarrier } from "@shared/hostProbeMetadata";
import HostProbeServiceManager, {
  type HostProbeServiceViewMode,
} from "@/components/hosts/HostProbeServiceManager";
import HostProbeServiceLatencyDialog from "@/components/hosts/HostProbeServiceLatencyDialog";

type AdvancedProbeSection = "carrier" | "custom";

type AdvancedProbePanelProps = {
  createSignal: number;
  onCreateSignalHandled: () => void;
  viewMode?: HostProbeServiceViewMode;
  onViewModeChange?: (viewMode: HostProbeServiceViewMode) => void;
  hideViewModeToggle?: boolean;
  searchQuery?: string;
  onFilterStatsChange?: (stats: { filtered: number; total: number }) => void;
};

export default function AdvancedProbePanel({
  createSignal,
  onCreateSignalHandled,
  viewMode,
  onViewModeChange,
  hideViewModeToggle = false,
  searchQuery = "",
  onFilterStatsChange,
}: AdvancedProbePanelProps) {
  const [section, setSection] = useState<AdvancedProbeSection>("carrier");
  const [historyHostId, setHistoryHostId] = useState<number | null>(null);
  const [historyServiceId, setHistoryServiceId] = useState<number | null>(null);
  const [carrierCreateSignal, setCarrierCreateSignal] = useState(0);
  const [defaultCarrier, setDefaultCarrier] = useState<HostProbeCarrier | null>(null);
  const { data: hosts = [] } = trpc.hosts.options.useQuery(undefined, { staleTime: 30_000 });
  const { data: services = [] } = trpc.hosts.probeServices.useQuery(undefined, {
    refetchInterval: pollingInterval("slow"),
  });
  const { data: carrierRows = [], isLoading: carrierLoading } = trpc.hosts.chinaCarrierProbeOverview.useQuery(undefined, {
    refetchInterval: pollingInterval("slow"),
  });
  const historyHost = useMemo(
    () => (hosts as any[]).find((host) => Number(host.id) === historyHostId) || null,
    [historyHostId, hosts],
  );

  const historyServices = useMemo(
    () => (services as any[]).filter((service) => Number(service.id) === historyServiceId),
    [historyServiceId, services],
  );

  const openHistory = (host: ChinaCarrierProbeOverviewHost, item: ChinaCarrierProbeOverviewItem) => {
    setHistoryHostId(Number(host.hostId));
    setHistoryServiceId(Number(item.serviceId));
  };

  const createCarrierTarget = (carrier: HostProbeCarrier) => {
    setDefaultCarrier(carrier);
    setCarrierCreateSignal((value) => value + 1);
  };

  return (
    <div className="space-y-4">
      <Tabs value={section} onValueChange={(value) => setSection(value as AdvancedProbeSection)}>
        <TabsList className="grid h-auto w-full max-w-sm grid-cols-2 gap-1 rounded-md bg-muted/50 p-1">
          <TabsTrigger value="carrier">三网质量</TabsTrigger>
          <TabsTrigger value="custom">自定义探测</TabsTrigger>
        </TabsList>
      </Tabs>

      {section === "carrier" ? (
        <div className="space-y-4">
          <div>
            <p className="text-xs text-muted-foreground sm:text-sm">
              Agent 从各主机主动探测中国移动 / 联通 / 电信目标；不同地区和目标始终独立展示，不做跨目标平均。
            </p>
          </div>
          <ChinaCarrierProbeOverview
            rows={carrierRows as ChinaCarrierProbeOverviewHost[]}
            isLoading={carrierLoading}
            onOpenHistory={openHistory}
            onCreateCarrier={createCarrierTarget}
          />
          <div className="border-t border-border/40 pt-4">
            <div className="mb-3">
              <p className="text-sm font-medium">三网目标配置</p>
              <p className="mt-1 text-xs text-muted-foreground">目标由管理员自行配置，不内置或硬编码运营商 IP。</p>
            </div>
            <HostProbeServiceManager
              createSignal={createSignal > 0 ? createSignal : carrierCreateSignal}
              onCreateSignalHandled={() => {
                if (createSignal > 0) onCreateSignalHandled();
                else setCarrierCreateSignal(0);
              }}
              viewMode={viewMode}
              onViewModeChange={onViewModeChange}
              hideViewModeToggle={hideViewModeToggle}
              searchQuery={searchQuery}
              onFilterStatsChange={onFilterStatsChange}
              probeKindFilter="china_carrier"
              defaultProbeKind="china_carrier"
              defaultCarrier={createSignal > 0 ? null : defaultCarrier}
            />
          </div>
        </div>
      ) : (
        <HostProbeServiceManager
          createSignal={createSignal}
          onCreateSignalHandled={onCreateSignalHandled}
          viewMode={viewMode}
          onViewModeChange={onViewModeChange}
          hideViewModeToggle={hideViewModeToggle}
          searchQuery={searchQuery}
          onFilterStatsChange={onFilterStatsChange}
          probeKindFilter="custom"
          defaultProbeKind="custom"
        />
      )}

      <HostProbeServiceLatencyDialog
        open={!!historyHost}
        onOpenChange={(open) => {
          if (!open) {
            setHistoryHostId(null);
            setHistoryServiceId(null);
          }
        }}
        host={historyHost}
        services={historyServices}
      />
    </div>
  );
}
