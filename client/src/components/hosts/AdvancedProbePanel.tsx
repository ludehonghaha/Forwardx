import { useMemo, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { pollingInterval } from "@/lib/polling";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ChinaCarrierProbeOverview, {
  type ChinaCarrierProbeOverviewHost,
  type ChinaCarrierProbeOverviewItem,
} from "@/components/hosts/ChinaCarrierProbeOverview";
import type { HostProbeCarrier } from "@shared/hostProbeMetadata";
import { CHINA_CARRIER_RECOMMENDED_DEFAULTS } from "@shared/chinaCarrierProbeDefaults";
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
  const trpcUtils = trpc.useUtils();
  const [section, setSection] = useState<AdvancedProbeSection>("carrier");
  const [historyHostId, setHistoryHostId] = useState<number | null>(null);
  const [historyServiceId, setHistoryServiceId] = useState<number | null>(null);
  const [carrierCreateSignal, setCarrierCreateSignal] = useState(0);
  const [defaultCarrier, setDefaultCarrier] = useState<HostProbeCarrier | null>(null);
  const [defaultHostId, setDefaultHostId] = useState<number | null>(null);
  const { data: hosts = [] } = trpc.hosts.options.useQuery(undefined, { staleTime: 30_000 });
  const { data: services = [] } = trpc.hosts.probeServices.useQuery(undefined, {
    refetchInterval: pollingInterval("slow"),
  });
  const { data: carrierRows = [], isLoading: carrierLoading } = trpc.hosts.chinaCarrierProbeOverview.useQuery(undefined, {
    refetchInterval: pollingInterval("slow"),
  });
  const createRecommendedMutation = trpc.hosts.createProbeService.useMutation();
  const defaultCarrierFormValues = useMemo(() => {
    if (!defaultCarrier) return undefined;
    const preset = CHINA_CARRIER_RECOMMENDED_DEFAULTS[defaultCarrier];
    return {
      name: preset.serviceName,
      method: preset.method,
      targetIp: preset.targetIp,
      region: preset.region,
      intervalSeconds: preset.intervalSeconds,
    };
  }, [defaultCarrier]);
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

  const createCarrierTarget = (host: ChinaCarrierProbeOverviewHost, carrier: HostProbeCarrier) => {
    setDefaultHostId(Number(host.hostId));
    setDefaultCarrier(carrier);
    setCarrierCreateSignal((value) => value + 1);
  };

  const createRecommendedTargets = async (host: ChinaCarrierProbeOverviewHost) => {
    const carriers = (["cm", "cu", "ct"] as HostProbeCarrier[]).filter(
      (carrier) => (host.carriers?.[carrier] || []).length === 0,
    );
    if (carriers.length === 0) {
      toast.info(`${host.hostName} 已配置三网目标`);
      return;
    }
    try {
      for (const carrier of carriers) {
        const preset = CHINA_CARRIER_RECOMMENDED_DEFAULTS[carrier];
        await createRecommendedMutation.mutateAsync({
          name: preset.serviceName,
          method: preset.method,
          targetIp: preset.targetIp,
          targetPort: null,
          probeKind: "china_carrier",
          carrier,
          region: preset.region,
          hostScope: "specific",
          hostIds: [Number(host.hostId)],
          excludeHostIds: [],
          intervalSeconds: preset.intervalSeconds,
          isEnabled: true,
        });
      }
      await Promise.all([
        trpcUtils.hosts.probeServices.invalidate(),
        trpcUtils.hosts.chinaCarrierProbeOverview.invalidate(),
      ]);
      toast.success(`已为 ${host.hostName} ${carriers.length === 3 ? "配置" : "补齐"}推荐三网目标`);
    } catch (error: any) {
      await Promise.all([
        trpcUtils.hosts.probeServices.invalidate(),
        trpcUtils.hosts.chinaCarrierProbeOverview.invalidate(),
      ]);
      toast.error(error?.message || "推荐三网目标创建失败");
    }
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
            onCreateDefaults={createRecommendedTargets}
          />
          <div className="border-t border-border/40 pt-4">
            <div className="mb-3">
              <p className="text-sm font-medium">三网目标配置</p>
              <p className="mt-1 text-xs text-muted-foreground">提供上海三网推荐默认值，可一键生成；服务名、地区、目标 IP、周期和主机范围创建后仍可编辑覆盖。</p>
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
              defaultHostId={createSignal > 0 ? null : defaultHostId}
              defaultFormValues={createSignal > 0 ? undefined : defaultCarrierFormValues}
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
