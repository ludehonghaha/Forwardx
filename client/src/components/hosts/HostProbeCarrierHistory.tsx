import DataSectionLoading from "@/components/DataSectionLoading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { pollingInterval } from "@/lib/polling";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CHINA_CARRIER_LABELS,
  detectChinaCarrierProbe,
  hostProbeServiceAppliesToHost,
  inferChinaCarrierProbeRegion,
  type ChinaCarrierKey,
} from "./hostProbeCarrierHistory";

const CARRIER_ORDER: ChinaCarrierKey[] = ["ct", "cu", "cm"];
const SERIES_COLORS = [
  "#2563eb",
  "#16a34a",
  "#9333ea",
  "#0891b2",
  "#d97706",
  "#db2777",
  "#0f766e",
  "#4f46e5",
  "#65a30d",
];

type SeriesDefinition = {
  key: string;
  lossKey: string;
  timeoutKey: string;
  serviceId: number;
  hostId: number;
  hostName: string;
  serviceName: string;
  carrier: ChinaCarrierKey;
  region: string;
  color: string;
};

function carrierOrder(carrier: ChinaCarrierKey) {
  const index = CARRIER_ORDER.indexOf(carrier);
  return index < 0 ? CARRIER_ORDER.length : index;
}

function formatAxisTime(value: number) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatFullTime(value: number) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${formatAxisTime(value)}`;
}

function CarrierHistoryTooltip({ active, payload, definitions }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload || {};
  const at = Number(point.at || 0);
  return (
    <div className="max-w-[360px] rounded-md border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur">
      <p className="mb-2 text-xs text-muted-foreground">{formatFullTime(at)}</p>
      <div className="space-y-1.5">
        {(definitions as SeriesDefinition[]).map((definition) => {
          const latency = point[definition.key];
          const loss = point[definition.lossKey];
          const timeout = point[definition.timeoutKey] === true;
          if (latency == null && loss == null && !timeout) return null;
          return (
            <div key={definition.key} className="flex min-w-0 items-center justify-between gap-4 text-xs">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: definition.color }} />
                <span className="truncate" title={`${definition.hostName} · ${definition.serviceName}`}>
                  {definition.hostName} · {CHINA_CARRIER_LABELS[definition.carrier]}
                </span>
              </span>
              <span className="shrink-0 font-medium tabular-nums">
                {timeout ? <span className="text-destructive">超时</span> : latency == null ? "--" : `${Math.round(Number(latency))}ms`}
                <span className={cn("ml-2", Number(loss) > 0 ? "text-destructive" : "text-muted-foreground")}>
                  丢包 {loss == null ? "--" : `${Number(loss).toFixed(1)}%`}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function HostProbeCarrierHistory() {
  const [regionFilter, setRegionFilter] = useState("all");
  const [carrierFilter, setCarrierFilter] = useState<"all" | ChinaCarrierKey>("all");
  const [drawLoss, setDrawLoss] = useState(true);
  const { data: hosts = [] } = trpc.hosts.options.useQuery(undefined, { staleTime: 30_000 });
  const { data: services = [] } = trpc.hosts.probeServices.useQuery(undefined, {
    refetchInterval: pollingInterval("slow"),
  });

  const carrierServices = useMemo(() => (services as any[])
    .map((service) => {
      const carrier = detectChinaCarrierProbe(service);
      if (!carrier) return null;
      return {
        service,
        serviceId: Number(service.id),
        carrier,
        region: inferChinaCarrierProbeRegion(service),
      };
    })
    .filter(Boolean) as Array<{ service: any; serviceId: number; carrier: ChinaCarrierKey; region: string }>, [services]);

  const serviceIds = useMemo(
    () => carrierServices.map((item) => item.serviceId).filter((id) => Number.isInteger(id) && id > 0),
    [carrierServices],
  );
  const { data: series = [], isLoading } = trpc.hosts.probeServiceSeries.useQuery(
    { serviceIds, hours: 24 },
    {
      enabled: serviceIds.length > 0,
      refetchInterval: pollingInterval("slow"),
    },
  );

  const regions = useMemo(
    () => Array.from(new Set(carrierServices.map((item) => item.region))).sort((a, b) => a.localeCompare(b, "zh-CN")),
    [carrierServices],
  );

  const filteredServices = useMemo(
    () => carrierServices.filter((item) => (
      (regionFilter === "all" || item.region === regionFilter)
      && (carrierFilter === "all" || item.carrier === carrierFilter)
    )),
    [carrierFilter, carrierServices, regionFilter],
  );

  const hostsById = useMemo(() => new Map((hosts as any[]).map((host) => [Number(host.id), host])), [hosts]);
  const definitions = useMemo<SeriesDefinition[]>(() => {
    const rows = filteredServices.flatMap((item) => (hosts as any[])
      .filter((host) => hostProbeServiceAppliesToHost(item.service, Number(host.id)))
      .map((host) => ({
        serviceId: item.serviceId,
        hostId: Number(host.id),
        hostName: String(host.name || `#${host.id}`),
        serviceName: String(item.service.name || CHINA_CARRIER_LABELS[item.carrier]),
        carrier: item.carrier,
        region: item.region,
      })));
    const unique = new Map<string, Omit<SeriesDefinition, "key" | "lossKey" | "timeoutKey" | "color">>();
    for (const row of rows) unique.set(`${row.serviceId}:${row.hostId}`, row);
    return Array.from(unique.values())
      .sort((a, b) => a.hostName.localeCompare(b.hostName, "zh-CN") || carrierOrder(a.carrier) - carrierOrder(b.carrier) || a.serviceId - b.serviceId)
      .map((row, index) => ({
        ...row,
        key: `probe_${row.serviceId}_${row.hostId}`,
        lossKey: `probe_${row.serviceId}_${row.hostId}_loss`,
        timeoutKey: `probe_${row.serviceId}_${row.hostId}_timeout`,
        color: SERIES_COLORS[index % SERIES_COLORS.length],
      }));
  }, [filteredServices, hosts]);

  const definitionByPair = useMemo(
    () => new Map(definitions.map((definition) => [`${definition.serviceId}:${definition.hostId}`, definition])),
    [definitions],
  );

  const chartData = useMemo(() => {
    const byTime = new Map<number, any>();
    for (const row of series as any[]) {
      const definition = definitionByPair.get(`${Number(row.serviceId)}:${Number(row.hostId)}`);
      if (!definition) continue;
      const at = new Date(row.recordedAt).getTime();
      if (!Number.isFinite(at)) continue;
      const point = byTime.get(at) || { at };
      point[definition.key] = row.isTimeout ? null : row.latencyMs == null ? null : Number(row.latencyMs);
      point[definition.lossKey] = row.packetLossPercent == null ? null : Number(row.packetLossPercent);
      point[definition.timeoutKey] = !!row.isTimeout;
      byTime.set(at, point);
    }
    return Array.from(byTime.values()).sort((a, b) => a.at - b.at);
  }, [definitionByPair, series]);

  const yMax = useMemo(() => {
    let max = 0;
    for (const point of chartData) {
      for (const definition of definitions) {
        const latency = Number(point[definition.key]);
        if (Number.isFinite(latency) && latency > max) max = latency;
      }
    }
    return max > 0 ? Math.max(120, Math.ceil(max * 1.15)) : 120;
  }, [chartData, definitions]);

  if (carrierServices.length === 0) return null;

  return (
    <Card className="border-border/40 bg-card/60 backdrop-blur-md">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">三网延迟 / 丢包趋势</p>
              <Badge variant="outline" className="text-[10px]">Agent 高级探测</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">复用现有 Ping 探测历史，不改变 Agent 协议；按主机和运营商分别展示，不跨线路平均。</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary">24h</Badge>
            <Badge variant="outline">标准采样</Badge>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border border-border/40 bg-background/25 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-medium text-muted-foreground">地区</span>
            <Button size="sm" variant={regionFilter === "all" ? "secondary" : "outline"} className="h-8 px-3 text-xs" onClick={() => setRegionFilter("all")}>全部</Button>
            {regions.map((region) => (
              <Button key={region} size="sm" variant={regionFilter === region ? "secondary" : "outline"} className="h-8 px-3 text-xs" onClick={() => setRegionFilter(region)}>{region}</Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-medium text-muted-foreground">网络</span>
            <Button size="sm" variant={carrierFilter === "all" ? "secondary" : "outline"} className="h-8 px-3 text-xs" onClick={() => setCarrierFilter("all")}>全部</Button>
            {CARRIER_ORDER.map((carrier) => (
              <Button key={carrier} size="sm" variant={carrierFilter === carrier ? "secondary" : "outline"} className="h-8 px-3 text-xs" onClick={() => setCarrierFilter(carrier)}>{CHINA_CARRIER_LABELS[carrier]}</Button>
            ))}
            <span className="ml-0 mr-1 text-xs font-medium text-muted-foreground sm:ml-3">丢包</span>
            <Button size="sm" variant={drawLoss ? "secondary" : "outline"} className="h-8 px-3 text-xs" onClick={() => setDrawLoss((value) => !value)}>{drawLoss ? "绘制" : "隐藏"}</Button>
          </div>
        </div>

        <div>
          <div className="mb-2 text-center text-sm font-medium">最近 24 小时三网延时对比 · 标准</div>
          {isLoading ? (
            <div className="flex min-h-[320px] items-center justify-center"><DataSectionLoading label="正在加载探测历史" /></div>
          ) : definitions.length === 0 ? (
            <div className="flex min-h-[260px] items-center justify-center text-sm text-muted-foreground">当前筛选没有可用探测线路</div>
          ) : chartData.length === 0 ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center text-sm text-muted-foreground">
              <p>探测服务已配置，正在等待历史样本。</p>
              <p className="mt-1 text-xs text-muted-foreground/70">Agent 上报后这里会自动出现 RTT 与丢包趋势。</p>
            </div>
          ) : (
            <div className="h-[340px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.24} />
                  <XAxis
                    dataKey="at"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={(value) => formatAxisTime(Number(value))}
                    tick={{ fontSize: 11 }}
                    minTickGap={48}
                  />
                  <YAxis domain={[0, yMax]} width={42} tick={{ fontSize: 11 }} unit="ms" />
                  <RechartsTooltip content={<CarrierHistoryTooltip definitions={definitions} />} />
                  {definitions.map((definition) => (
                    <Line
                      key={definition.key}
                      type="linear"
                      dataKey={definition.key}
                      name={`${definition.hostName} · ${CHINA_CARRIER_LABELS[definition.carrier]}`}
                      stroke={definition.color}
                      strokeWidth={1.7}
                      connectNulls={false}
                      isAnimationActive={false}
                      dot={(props: any) => {
                        const loss = Number(props?.payload?.[definition.lossKey]);
                        if (!drawLoss || !Number.isFinite(loss) || loss <= 0) return <g />;
                        return <circle cx={props.cx} cy={props.cy} r={2.6} fill="#ef4444" stroke="#fff" strokeWidth={0.7} />;
                      }}
                      activeDot={{ r: 3.5 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-border/40 pt-3 text-xs text-muted-foreground">
          {definitions.map((definition) => (
            <span key={definition.key} className="flex min-w-0 items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: definition.color }} />
              <span className="truncate" title={`${definition.hostName} · ${definition.serviceName}`}>
                {definition.hostName} · {definition.region} {CHINA_CARRIER_LABELS[definition.carrier]}
              </span>
            </span>
          ))}
          {drawLoss && <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red-500" />红点 = 该采样窗存在丢包</span>}
        </div>
      </CardContent>
    </Card>
  );
}
