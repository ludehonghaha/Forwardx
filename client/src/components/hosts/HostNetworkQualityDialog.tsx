import { useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { Loader2 } from "lucide-react";
import {
  DEFAULT_LATENCY_TIME_RANGE_HOURS,
  HOST_NETWORK_QUALITY_TIME_RANGE_OPTIONS,
  latencyTimeRangeLabel,
  LatencyTimeRangeSelect,
  type LatencyTimeRangeHours,
} from "@/components/LatencyTimeRangeSelect";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { getLatencyYAxisTicks } from "@/lib/latencyChart";
import { pollingInterval } from "@/lib/polling";

function formatTime(value: string | number | Date) {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatFullTime(value: string | number | Date) {
  const date = new Date(value);
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${formatTime(date)}`;
}

function NetworkQualityTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload || {};
  return (
    <div className="pointer-events-none min-w-[190px] rounded-md border border-border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1.5 text-muted-foreground">{point.fullLabel || label}</p>
      <div className="flex items-center justify-between gap-5">
        <span>延迟</span>
        <span className="font-semibold tabular-nums">{point.latencyMs == null ? "--" : `${point.latencyMs}ms`}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-5">
        <span>抖动</span>
        <span className="font-semibold tabular-nums">{point.jitterMs == null ? "--" : `${point.jitterMs}ms`}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-5">
        <span>丢包率</span>
        <span className="font-semibold tabular-nums">{point.packetLossPercent == null ? "--" : `${Number(point.packetLossPercent).toFixed(1)}%`}</span>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">成功 {point.successCount ?? 0} / 失败 {point.lossCount ?? 0}</p>
    </div>
  );
}

export default function HostNetworkQualityDialog({
  open,
  onOpenChange,
  host,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  host: any | null;
}) {
  const hostId = Number(host?.id || 0);
  const [timeRangeHours, setTimeRangeHours] = useState<LatencyTimeRangeHours>(DEFAULT_LATENCY_TIME_RANGE_HOURS);
  const { data = [], isLoading } = trpc.hosts.networkQualitySeries.useQuery(
    { hostId, hours: timeRangeHours },
    { enabled: open && hostId > 0, refetchInterval: pollingInterval("slow", open) },
  );
  const chart = useMemo(() => (data as any[]).map((row) => {
    const at = new Date(row.recordedAt).getTime();
    return {
      ...row,
      at,
      label: formatTime(at),
      fullLabel: formatFullTime(at),
      latencyMs: row.latencyMs == null ? null : Number(row.latencyMs),
      jitterMs: row.jitterMs == null ? null : Number(row.jitterMs),
      packetLossPercent: row.packetLossPercent == null ? null : Number(row.packetLossPercent),
    };
  }).filter((row) => Number.isFinite(row.at)), [data]);
  const chartTimeDomain = useMemo<[number, number]>(() => {
    const end = Date.now();
    const rangeMs = Math.max(0.5, Number(timeRangeHours) || DEFAULT_LATENCY_TIME_RANGE_HOURS) * 60 * 60 * 1000;
    return [end - rangeMs, end];
  }, [data, timeRangeHours]);
  const latencyMax = useMemo(() => {
    const max = Math.max(
      0,
      ...chart.map((point) => Math.max(Number(point.latencyMs) || 0, Number(point.jitterMs) || 0)),
    );
    return max > 0 ? Math.ceil(max * 1.2) : 120;
  }, [chart]);
  const latencyTicks = useMemo(() => getLatencyYAxisTicks(latencyMax), [latencyMax]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[96svh] w-[calc(100vw-0.75rem)] max-w-[95vw] flex-col gap-3 overflow-hidden p-3 sm:max-w-5xl sm:p-6">
        <DialogHeader>
          <div className="flex flex-col gap-2 pr-9 sm:flex-row sm:items-start sm:justify-between sm:pr-10">
            <div className="min-w-0">
              <DialogTitle>主机网络质量</DialogTitle>
              <DialogDescription>{host?.name ? `${host.name} 最近 ${latencyTimeRangeLabel(timeRangeHours)} Agent → Panel 网络质量（延迟 / 抖动 / 丢包）` : `最近 ${latencyTimeRangeLabel(timeRangeHours)} Agent → Panel 网络质量（延迟 / 抖动 / 丢包）`}</DialogDescription>
            </div>
            <LatencyTimeRangeSelect value={timeRangeHours} onChange={setTimeRangeHours} options={HOST_NETWORK_QUALITY_TIME_RANGE_OPTIONS} />
          </div>
        </DialogHeader>
        <div className="h-[48svh] min-h-[240px] w-full sm:h-80">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在加载图表</div>
          ) : chart.length === 0 ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">正在采集主机网络质量，通常 30–60 秒后出现数据</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="at" type="number" scale="time" domain={chartTimeDomain} tick={{ fontSize: 10 }} tickFormatter={(value) => formatTime(Number(value))} minTickGap={46} />
                <YAxis yAxisId="latency" tick={{ fontSize: 10 }} tickFormatter={(value) => `${value}ms`} width={52} domain={[0, latencyMax]} ticks={latencyTicks} allowDecimals={false} />
                <YAxis yAxisId="loss" orientation="right" tick={{ fontSize: 10 }} tickFormatter={(value) => `${value}%`} width={42} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} allowDecimals={false} />
                <RTooltip content={<NetworkQualityTooltip />} cursor={{ stroke: "var(--color-muted-foreground)", strokeDasharray: "3 3" }} />
                <Area yAxisId="loss" type="monotone" dataKey="packetLossPercent" name="丢包率" stroke="#dc2626" fill="#dc2626" fillOpacity={0.12} strokeWidth={1.1} dot={false} connectNulls={false} isAnimationActive={false} />
                <Line yAxisId="latency" type="monotone" dataKey="latencyMs" name="延迟" stroke="var(--color-primary)" strokeWidth={1.35} dot={false} connectNulls={false} activeDot={{ r: 3 }} isAnimationActive={false} />
                <Line yAxisId="latency" type="monotone" dataKey="jitterMs" name="抖动" stroke="#d97706" strokeWidth={1.15} strokeDasharray="4 3" dot={false} connectNulls={false} activeDot={{ r: 2.5 }} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
