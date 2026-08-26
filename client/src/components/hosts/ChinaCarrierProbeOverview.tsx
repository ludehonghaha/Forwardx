import DataSectionLoading from "@/components/DataSectionLoading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Activity, Clock3, RadioTower, Route } from "lucide-react";
import {
  HOST_PROBE_CARRIER_LABELS,
  type HostProbeCarrier,
} from "@shared/hostProbeMetadata";

export type ChinaCarrierProbeOverviewItem = {
  serviceId: number;
  carrier: HostProbeCarrier;
  region?: string | null;
  serviceName: string;
  method: "ping" | "tcping";
  targetIp: string;
  targetPort?: number | null;
  intervalSeconds: number;
  isEnabled: boolean;
  latencyMs?: number | null;
  jitterMs?: number | null;
  packetLossPercent?: number | null;
  successCount?: number | null;
  lossCount?: number | null;
  recordedAt?: string | Date | null;
  isTimeout?: boolean;
  state: "disabled" | "waiting" | "ok" | "timeout" | "stale";
};

export type ChinaCarrierProbeOverviewHost = {
  hostId: number;
  hostName: string;
  isOnline: boolean;
  carriers: Record<HostProbeCarrier, ChinaCarrierProbeOverviewItem[]>;
};

const CARRIER_ORDER: HostProbeCarrier[] = ["cm", "cu", "ct"];

function stateText(item: ChinaCarrierProbeOverviewItem) {
  if (!item.isEnabled || item.state === "disabled") return "已停用";
  if (item.state === "waiting") return "等待探测";
  if (item.state === "stale") return "数据过期";
  if (item.state === "timeout" || item.isTimeout) return "超时";
  return item.latencyMs == null ? "等待探测" : `${Math.round(Number(item.latencyMs))} ms`;
}

function stateClass(item: ChinaCarrierProbeOverviewItem) {
  if (item.state === "timeout") return "border-destructive/30 text-destructive";
  if (item.state === "stale") return "border-amber-500/30 text-amber-500";
  if (item.state === "ok") return "border-emerald-500/30 text-emerald-500";
  return "border-border/60 text-muted-foreground";
}

function recordedAtText(value: ChinaCarrierProbeOverviewItem["recordedAt"]) {
  if (!value) return "--";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "--";
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  return new Date(time).toLocaleString();
}

function targetText(item: ChinaCarrierProbeOverviewItem) {
  return item.method === "tcping"
    ? `${item.targetIp}:${item.targetPort || "-"}`
    : item.targetIp;
}

function ProbeItem({
  item,
  onOpenHistory,
}: {
  item: ChinaCarrierProbeOverviewItem;
  onOpenHistory?: (item: ChinaCarrierProbeOverviewItem) => void;
}) {
  const hasCurrentSample = item.state === "ok" || item.state === "timeout";
  const loss = hasCurrentSample && item.packetLossPercent != null
    ? `${Number(item.packetLossPercent).toFixed(1)}%`
    : "--";
  const jitter = item.state === "ok" && item.jitterMs != null
    ? `${Math.round(Number(item.jitterMs))} ms`
    : "--";
  const samples = hasCurrentSample && item.successCount != null && item.lossCount != null
    ? `成功 ${item.successCount} / 丢失 ${item.lossCount}`
    : "样本 --";
  return (
    <button
      type="button"
      disabled={!onOpenHistory}
      onClick={() => onOpenHistory?.(item)}
      className="w-full rounded-md border border-border/40 bg-background/35 p-2.5 text-left transition-colors enabled:hover:bg-background/60"
      title={onOpenHistory ? "查看 24H 高级探测历史" : undefined}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-xs font-medium" title={item.serviceName}>{item.region || item.serviceName}</span>
            {item.region && item.serviceName !== item.region ? (
              <span className="truncate text-[10px] text-muted-foreground" title={item.serviceName}>{item.serviceName}</span>
            ) : null}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
            <Route className="h-3 w-3 shrink-0" />
            <span className="truncate font-mono" title={targetText(item)}>{item.method.toUpperCase()} · {targetText(item)}</span>
          </div>
        </div>
        <Badge variant="outline" className={`shrink-0 px-1.5 py-0 text-[10px] ${stateClass(item)}`}>
          {stateText(item)}
        </Badge>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5 text-[11px]">
        <div className="rounded bg-muted/30 px-2 py-1.5">
          <span className="block text-[10px] text-muted-foreground">延迟</span>
          <span className="font-semibold tabular-nums">{item.state === "ok" && item.latencyMs != null ? `${Math.round(Number(item.latencyMs))} ms` : "--"}</span>
        </div>
        <div className="rounded bg-muted/30 px-2 py-1.5" title="最近成功探测窗口之间的平均延迟变化，不是 packet-level RFC jitter">
          <span className="block text-[10px] text-muted-foreground">抖动</span>
          <span className="font-semibold tabular-nums">{jitter}</span>
        </div>
        <div className="rounded bg-muted/30 px-2 py-1.5">
          <span className="block text-[10px] text-muted-foreground">丢包</span>
          <span className="font-semibold tabular-nums">{loss}</span>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" />{recordedAtText(item.recordedAt)}</span>
        <span className="tabular-nums">{samples}</span>
      </div>
    </button>
  );
}

export default function ChinaCarrierProbeOverview({
  rows,
  isLoading = false,
  onCreateCarrier,
  onOpenHistory,
}: {
  rows: ChinaCarrierProbeOverviewHost[];
  isLoading?: boolean;
  onCreateCarrier?: (carrier: HostProbeCarrier) => void;
  onOpenHistory?: (host: ChinaCarrierProbeOverviewHost, item: ChinaCarrierProbeOverviewItem) => void;
}) {
  if (isLoading && rows.length === 0) {
    return <DataSectionLoading label="正在加载三网质量" minHeight="min-h-[220px]" />;
  }

  if (rows.length === 0) {
    return (
      <Card className="border-border/40 bg-card/60 backdrop-blur-md">
        <CardContent className="flex flex-col items-center justify-center px-4 py-16 text-center">
          <RadioTower className="h-8 w-8 text-muted-foreground/60" />
          <p className="mt-3 text-sm font-medium">暂无可展示主机</p>
          <p className="mt-1 text-xs text-muted-foreground">添加并上线 Agent 后可查看三网质量。</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((host) => (
        <Card key={host.hostId} className="border-border/40 bg-card/60 backdrop-blur-md">
          <CardContent className="p-3.5 sm:p-4">
            <div className="mb-3 flex min-w-0 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${host.isOnline ? "bg-emerald-500" : "bg-destructive"}`} />
                <span className="truncate text-sm font-semibold" title={host.hostName}>{host.hostName}</span>
              </div>
              <span className="text-[11px] text-muted-foreground">Agent → 中国运营商目标</span>
            </div>
            <div className="grid gap-2.5 xl:grid-cols-3">
              {CARRIER_ORDER.map((carrier) => {
                const items = host.carriers?.[carrier] || [];
                return (
                  <div key={carrier} className="min-w-0 rounded-md border border-border/40 bg-muted/15 p-2.5">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Activity className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate text-xs font-semibold">{HOST_PROBE_CARRIER_LABELS[carrier]}</span>
                      </div>
                      {onCreateCarrier ? (
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => onCreateCarrier(carrier)}>
                          {items.length > 0 ? "添加目标" : "配置目标"}
                        </Button>
                      ) : null}
                    </div>
                    {items.length > 0 ? (
                      <div className="space-y-2">
                        {items.map((item) => (
                          <ProbeItem
                            key={item.serviceId}
                            item={item}
                            onOpenHistory={onOpenHistory ? (probe) => onOpenHistory(host, probe) : undefined}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-border/50 px-3 text-center text-xs text-muted-foreground">
                        未配置目标
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
