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
  method: "ping" | "tcping";
  targetIp: string;
  targetPort: number | null;
  carrier: ChinaCarrierKey;
  region: string;
  color: string;
};

type TooltipMetric = "latency" | "loss";

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

function percentile(values: number[], ratio: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function formatProbeTarget(definition: SeriesDefinition) {
  const targetIp = definition.targetIp || "--";
  if (definition.method !== "tcping" || !definition.targetPort) return targetIp;
  const host = targetIp.includes(":") && !targetIp.startsWith("[") ? `[${targetIp}]` : targetIp;
  return `${host}:${definition.targetPort}`;
}

function probeFailureLabel(definition: SeriesDefinition) {
  return definition.method === "tcping" ? "TCP 连接失败" : "Ping 丢包";
}

function probeTimeoutLabel(definition: SeriesDefinition) {
  return definition.method === "tcping" ? "TCP 连接超时" : "目标超时";
}

function probeNoResponseLabel(definition: SeriesDefinition) {
  return definition.method === "tcping" ? "TCP 连接失败" : "目标无响应";
}

function CarrierHistoryTooltip({ active, payload, definitions, metric }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload || {};
  const at = Number(point.at || 0);

  return (
    <div className="max-w-[390px] rounded-md border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur">
      <p className="mb-2 text-xs text-muted-foreground">{formatFullTime(at)}</p>
      <div className="space-y-1.5">
        {(definitions as SeriesDefinition[]).map((definition) => {
          const latency = point[definition.key];
          const loss = point[definition.lossKey];
          const timeout = point[definition.timeoutKey] === true;
          const lossNumber = Number(loss);
          const noResponse = timeout && Number.isFinite(lossNumber) && lossNumber >= 100;
          const hasLatency = latency != null && Number.isFinite(Number(latency));
          const hasLoss = loss != null && Number.isFinite(lossNumber);
          const target = formatProbeTarget(definition);
          const failureLabel = probeFailureLabel(definition);

          if (metric === "latency" && !hasLatency && !timeout && !hasLoss) return null;
          if (metric === "loss" && !hasLoss && !timeout) return null;

          return (
            <div key={definition.key} className="flex min-w-0 items-start justify-between gap-4 text-xs">
              <span className="flex min-w-0 items-start gap-1.5">
                <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: definition.color }} />
                <span className="min-w-0">
                  <span className="block truncate" title={`${definition.hostName} · ${definition.serviceName}`}>
                    {definition.hostName} · {CHINA_CARRIER_LABELS[definition.carrier]}
                  </span>
                  <span className="block truncate text-[10px] text-muted-foreground" title={target}>
                    目标 {target}
                  </span>
                </span>
              </span>
              <span className="shrink-0 text-right font-medium tabular-nums">
                {metric === "latency" ? (
                  <>
                    <span className={cn(noResponse || timeout ? "text-destructive" : "")}>
                      {noResponse
                        ? probeNoResponseLabel(definition)
                        : timeout
                          ? probeTimeoutLabel(definition)
                          : hasLatency
                            ? `${Math.round(Number(latency))}ms`
                            : "--"}
                    </span>
                    <span className={cn("ml-2", hasLoss && lossNumber > 0 ? "text-destructive" : "text-muted-foreground")}>
                      {failureLabel} {hasLoss ? `${lossNumber.toFixed(1)}%` : "--"}
                    </span>
                  </>
                ) : (
                  <span className={cn(hasLoss && lossNumber > 0 ? "text-destructive" : "")}>
                    {noResponse
                      ? `${probeNoResponseLabel(definition)} · 100%`
                      : hasLoss
                        ? `${failureLabel} ${lossNumber.toFixed(1)}%`
                        : timeout
                          ? probeTimeoutLabel(definition)
                          : "--"}
                  </span>
                )}
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
  const [showLossChart, setShowLossChart] = useState(true);
  const [scaleMode, setScaleMode] = useState<"focus" | "full">("focus");

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

  const definitions = useMemo<SeriesDefinition[]>(() => {
    const rows = filteredServices.flatMap((item) => (hosts as any[])
      .filter((host) => hostProbeServiceAppliesToHost(item.service, Number(host.id)))
      .map((host) => ({
        serviceId: item.serviceId,
        hostId: Number(host.id),
        hostName: String(host.name || `#${host.id}`),
        serviceName: String(item.service.name || CHINA_CARRIER_LABELS[item.carrier]),
        method: item.service.method === "tcping" ? "tcping" as const : "ping" as const,
        targetIp: String(item.service.targetIp || ""),
        targetPort: item.service.method === "tcping" && Number(item.service.targetPort) > 0 ? Number(item.service.targetPort) : null,
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

  const latencyValues = useMemo(() => {
    const values: number[] = [];
    for (const point of chartData) {
      for (const definition of definitions) {
        const latency = Number(point[definition.key]);
        if (Number.isFinite(latency) && latency > 0) values.push(latency);
      }
    }
    return values;
  }, [chartData, definitions]);

  const fullYMax = useMemo(() => {
    const max = latencyValues.length > 0 ? Math.max(...latencyValues) : 0;
    return max > 0 ? Math.max(120, Math.ceil(max * 1.1 / 10) * 10) : 120;
  }, [latencyValues]);

  const focusYMax = useMemo(() => {
    const p95 = percentile(latencyValues, 0.95);
    return p95 > 0 ? Math.max(120, Math.ceil(p95 * 1.25 / 10) * 10) : 120;
  }, [latencyValues]);

  const yMax = scaleMode === "full" ? fullYMax : focusYMax;

  if (carrierServices.length === 0) return null;

  return (
    <Card className="border-border/40 bg-card/60 backdrop-blur-md">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">三网目标探测 · RTT / 探测失败率</p>
              <Badge variant="outline" className="text-[10px]">Agent 高级探测</Badge>
              <Badge variant="outline" className="text-[10px]">Ping / TCPing</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              展示 VPS 到固定 CT/CU/CM 探测目标的 Ping / TCPing 结果；Ping 丢包与 TCP 连接失败是不同指标，单目标异常不等于整个运营商网络异常。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="secondary">24h</Badge>
            <Badge variant="outline">5 分钟聚合</Badge>
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

            <span className="ml-0 mr-1 text-xs font-medium text-muted-foreground sm:ml-3">RTT 量程</span>
            <Button size="sm" variant={scaleMode === "focus" ? "secondary" : "outline"} className="h-8 px-3 text-xs" onClick={() => setScaleMode("focus")}>聚焦正常</Button>
            <Button size="sm" variant={scaleMode === "full" ? "secondary" : "outline"} className="h-8 px-3 text-xs" onClick={() => setScaleMode("full")}>完整尖峰</Button>

            <span className="ml-0 mr-1 text-xs font-medium text-muted-foreground sm:ml-3">探测失败率</span>
            <Button size="sm" variant={showLossChart ? "secondary" : "outline"} className="h-8 px-3 text-xs" onClick={() => setShowLossChart((value) => !value)}>{showLossChart ? "显示" : "隐藏"}</Button>
          </div>
        </div>

        <div>
          <div className="mb-2 text-center text-sm font-medium">最近 24 小时 RTT · {scaleMode === "focus" ? "P95 聚焦量程" : "完整量程"}</div>
          {isLoading ? (
            <div className="flex min-h-[320px] items-center justify-center"><DataSectionLoading label="正在加载探测历史" /></div>
          ) : definitions.length === 0 ? (
            <div className="flex min-h-[260px] items-center justify-center text-sm text-muted-foreground">当前筛选没有可用探测线路</div>
          ) : chartData.length === 0 ? (
            <div className="flex min-h-[260px] flex-col items-center justify-center text-sm text-muted-foreground">
              <p>探测服务已配置，正在等待历史样本。</p>
              <p className="mt-1 text-xs text-muted-foreground/70">Agent 上报后这里会自动出现 RTT 与探测失败率趋势。</p>
            </div>
          ) : (
            <div className="h-[300px] w-full">
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
                  <YAxis domain={[0, yMax]} allowDataOverflow width={48} tick={{ fontSize: 11 }} unit="ms" />
                  <RechartsTooltip content={<CarrierHistoryTooltip definitions={definitions} metric="latency" />} />
                  {definitions.map((definition) => (
                    <Line
                      key={definition.key}
                      type="linear"
                      dataKey={definition.key}
                      name={`${definition.hostName} · ${CHINA_CARRIER_LABELS[definition.carrier]}`}
                      stroke={definition.color}
                      strokeWidth={1.7}
                      connectNulls
                      isAnimationActive={false}
                      dot={false}
                      activeDot={{ r: 3.5 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          {chartData.length > 0 && (
            <p className="mt-1 text-center text-[11px] text-muted-foreground">
              RTT 图跨过失败窗口连接趋势；Ping 丢包与 TCP 连接失败统一在下方按失败率展示，避免折线被大量断点切碎。
            </p>
          )}
        </div>

        {showLossChart && chartData.length > 0 && definitions.length > 0 && (
          <div className="border-t border-border/40 pt-4">
            <div className="mb-2 text-center text-sm font-medium">目标探测失败率 · 0–100%</div>
            <div className="h-[190px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis
                    dataKey="at"
                    type="number"
                    domain={["dataMin", "dataMax"]}
                    tickFormatter={(value) => formatAxisTime(Number(value))}
                    tick={{ fontSize: 11 }}
                    minTickGap={48}
                  />
                  <YAxis domain={[0, 100]} width={44} tick={{ fontSize: 11 }} unit="%" />
                  <RechartsTooltip content={<CarrierHistoryTooltip definitions={definitions} metric="loss" />} />
                  {definitions.map((definition) => (
                    <Line
                      key={definition.lossKey}
                      type="linear"
                      dataKey={definition.lossKey}
                      name={`${definition.hostName} · ${CHINA_CARRIER_LABELS[definition.carrier]} · ${definition.method === "tcping" ? "TCP 连接失败率" : "Ping 丢包率"}`}
                      stroke={definition.color}
                      strokeWidth={1.5}
                      connectNulls
                      isAnimationActive={false}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 text-center text-[11px] text-muted-foreground">
              Ping 服务显示 Ping 丢包率，TCPing 服务显示 TCP 连接失败率；100% 仅表示该固定目标在采样窗内对应探测全部失败，不直接代表运营商整体线路质量。
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-border/40 pt-3 text-xs text-muted-foreground">
          {definitions.map((definition) => {
            const target = formatProbeTarget(definition);
            return (
              <span key={definition.key} className="flex min-w-0 items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: definition.color }} />
                <span className="truncate" title={`${definition.hostName} · ${definition.serviceName} · ${definition.method.toUpperCase()} · ${target}`}>
                  {definition.hostName} · {definition.region} {CHINA_CARRIER_LABELS[definition.carrier]}
                </span>
              </span>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
