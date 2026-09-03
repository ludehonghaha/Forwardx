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

type LatestProbePoint = {
  at: number;
  latency: number | null;
  loss: number | null;
  timeout: boolean;
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
  return definition.method === "tcping" ? "TCP 失败" : "Ping 丢包";
}

function probeNoResponseLabel(definition: SeriesDefinition) {
  return definition.method === "tcping" ? "连接失败" : "目标无响应";
}

function latestLatencyLabel(definition: SeriesDefinition, latest?: LatestProbePoint) {
  if (!latest) return "--";
  if (latest.timeout) return probeNoResponseLabel(definition);
  if (latest.latency == null || !Number.isFinite(latest.latency)) return "--";
  return `${Math.round(latest.latency)}ms`;
}

function latencyYMax(definitions: SeriesDefinition[], chartData: any[], scaleMode: "focus" | "full") {
  const values: number[] = [];
  for (const point of chartData) {
    for (const definition of definitions) {
      const latency = Number(point[definition.key]);
      if (Number.isFinite(latency) && latency > 0) values.push(latency);
    }
  }
  if (values.length === 0) return 120;
  const base = scaleMode === "full" ? Math.max(...values) : percentile(values, 0.95) * 1.25;
  return Math.max(120, Math.ceil(base * 1.1 / 10) * 10);
}

function CompareTooltip({ active, payload, definitions }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload || {};
  const at = Number(point.at || 0);

  return (
    <div className="max-w-[340px] rounded-md border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur">
      <p className="mb-2 text-xs text-muted-foreground">{formatFullTime(at)}</p>
      <div className="space-y-1.5">
        {(definitions as SeriesDefinition[]).map((definition) => {
          const latency = point[definition.key];
          const loss = point[definition.lossKey];
          const timeout = point[definition.timeoutKey] === true;
          const hasLatency = latency != null && Number.isFinite(Number(latency));
          const hasLoss = loss != null && Number.isFinite(Number(loss));
          if (!hasLatency && !hasLoss && !timeout) return null;

          return (
            <div key={definition.key} className="flex items-center justify-between gap-4 text-xs">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: definition.color }} />
                <span className="truncate">{definition.hostName}</span>
              </span>
              <span className="shrink-0 text-right font-medium tabular-nums">
                <span className={cn(timeout ? "text-destructive" : "")}>
                  {timeout ? probeNoResponseLabel(definition) : hasLatency ? `${Math.round(Number(latency))}ms` : "--"}
                </span>
                <span className={cn("ml-2", hasLoss && Number(loss) > 0 ? "text-destructive" : "text-muted-foreground")}>
                  {probeFailureLabel(definition)} {hasLoss ? `${Number(loss).toFixed(1)}%` : "--"}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CarrierBadge({ carrier }: { carrier: ChinaCarrierKey }) {
  return <Badge variant="secondary">{CHINA_CARRIER_LABELS[carrier]}</Badge>;
}

export default function HostProbeCarrierHistory() {
  const [regionFilter, setRegionFilter] = useState("all");
  const [selectedHostIds, setSelectedHostIds] = useState<number[]>([]);
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
    () => carrierServices.filter((item) => regionFilter === "all" || item.region === regionFilter),
    [carrierServices, regionFilter],
  );

  const hostColorById = useMemo(() => {
    const hostIds = Array.from(new Set((hosts as any[]).map((host) => Number(host.id))))
      .filter((id) => Number.isInteger(id) && id > 0)
      .sort((a, b) => a - b);
    return new Map(hostIds.map((hostId, index) => [hostId, SERIES_COLORS[index % SERIES_COLORS.length]]));
  }, [hosts]);

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
        color: hostColorById.get(Number(host.id)) || SERIES_COLORS[0],
      })));

    const unique = new Map<string, Omit<SeriesDefinition, "key" | "lossKey" | "timeoutKey">>();
    for (const row of rows) unique.set(`${row.serviceId}:${row.hostId}`, row);

    return Array.from(unique.values())
      .sort((a, b) => carrierOrder(a.carrier) - carrierOrder(b.carrier) || a.hostName.localeCompare(b.hostName, "zh-CN") || a.serviceId - b.serviceId)
      .map((row) => ({
        ...row,
        key: `probe_${row.serviceId}_${row.hostId}`,
        lossKey: `probe_${row.serviceId}_${row.hostId}_loss`,
        timeoutKey: `probe_${row.serviceId}_${row.hostId}_timeout`,
      }));
  }, [filteredServices, hostColorById, hosts]);

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

  const latestByDefinition = useMemo(() => {
    const latest = new Map<string, LatestProbePoint>();
    for (const row of series as any[]) {
      const definition = definitionByPair.get(`${Number(row.serviceId)}:${Number(row.hostId)}`);
      if (!definition) continue;
      const at = new Date(row.recordedAt).getTime();
      if (!Number.isFinite(at)) continue;
      const current = latest.get(definition.key);
      if (current && current.at >= at) continue;
      latest.set(definition.key, {
        at,
        latency: row.isTimeout || row.latencyMs == null ? null : Number(row.latencyMs),
        loss: row.packetLossPercent == null ? null : Number(row.packetLossPercent),
        timeout: !!row.isTimeout,
      });
    }
    return latest;
  }, [definitionByPair, series]);

  const definitionsByCarrier = useMemo(() => {
    const grouped = new Map<ChinaCarrierKey, SeriesDefinition[]>();
    for (const carrier of CARRIER_ORDER) grouped.set(carrier, []);
    for (const definition of definitions) grouped.get(definition.carrier)?.push(definition);
    return grouped;
  }, [definitions]);

  const selectedHostNames = useMemo(() => selectedHostIds.map((hostId) => {
    const host = (hosts as any[]).find((item) => Number(item.id) === hostId);
    return String(host?.name || `#${hostId}`);
  }), [hosts, selectedHostIds]);

  const toggleHostSelection = (hostId: number) => {
    setSelectedHostIds((current) => {
      if (current.includes(hostId)) return current.filter((id) => id !== hostId);
      if (current.length >= 2) return current;
      return [...current, hostId];
    });
  };

  if (carrierServices.length === 0) return null;

  return (
    <Card className="border-border/40 bg-card/60 backdrop-blur-md">
      <CardContent className="space-y-5 p-4 sm:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">三网目标探测</p>
              <Badge variant="outline" className="text-[10px]">24h</Badge>
              <Badge variant="outline" className="text-[10px]">5 分钟聚合</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              电信、联通、移动分开展示，每台服务器只保留自己的当前状态和小趋势；需要横向比较时最多选择两台服务器。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">RTT 量程</span>
            <Button size="sm" variant={scaleMode === "focus" ? "secondary" : "outline"} className="h-8 px-3 text-xs" onClick={() => setScaleMode("focus")}>聚焦正常</Button>
            <Button size="sm" variant={scaleMode === "full" ? "secondary" : "outline"} className="h-8 px-3 text-xs" onClick={() => setScaleMode("full")}>完整尖峰</Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/40 bg-background/25 p-3">
          <span className="mr-1 text-xs font-medium text-muted-foreground">地区</span>
          <Button size="sm" variant={regionFilter === "all" ? "secondary" : "outline"} className="h-8 px-3 text-xs" onClick={() => setRegionFilter("all")}>全部</Button>
          {regions.map((region) => (
            <Button key={region} size="sm" variant={regionFilter === region ? "secondary" : "outline"} className="h-8 px-3 text-xs" onClick={() => setRegionFilter(region)}>{region}</Button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex min-h-[260px] items-center justify-center"><DataSectionLoading label="正在加载探测历史" /></div>
        ) : definitions.length === 0 ? (
          <div className="flex min-h-[220px] items-center justify-center text-sm text-muted-foreground">当前地区没有可用三网探测线路</div>
        ) : (
          <div className="space-y-4">
            {CARRIER_ORDER.map((carrier) => {
              const carrierDefinitions = definitionsByCarrier.get(carrier) || [];
              if (carrierDefinitions.length === 0) return null;
              const firstDefinition = carrierDefinitions[0];
              const target = formatProbeTarget(firstDefinition);
              const methodLabel = firstDefinition.method === "tcping" ? "TCPing" : "Ping";

              return (
                <section key={carrier} className="rounded-xl border border-border/40 bg-background/20 p-3 sm:p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <CarrierBadge carrier={carrier} />
                      <span className="text-sm font-semibold">{CHINA_CARRIER_LABELS[carrier]}探测</span>
                      <span className="text-xs text-muted-foreground">{methodLabel} · {target}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{carrierDefinitions.length} 台服务器</span>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {carrierDefinitions.map((definition) => {
                      const latest = latestByDefinition.get(definition.key);
                      const selected = selectedHostIds.includes(definition.hostId);
                      const selectionLocked = selectedHostIds.length >= 2 && !selected;
                      const sparkData = chartData
                        .filter((point) => point[definition.key] != null && Number.isFinite(Number(point[definition.key])))
                        .map((point) => ({ at: point.at, latency: Number(point[definition.key]) }));
                      const loss = latest?.loss;

                      return (
                        <div key={definition.key} className={cn(
                          "rounded-lg border bg-card/50 p-3 transition-colors",
                          selected ? "border-primary/60 bg-primary/5" : "border-border/40",
                        )}>
                          <div className="flex min-w-0 items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex min-w-0 items-center gap-2">
                                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: definition.color }} />
                                <p className="truncate text-sm font-medium" title={definition.hostName}>{definition.hostName}</p>
                              </div>
                              <p className="mt-1 truncate text-[10px] text-muted-foreground" title={`${definition.method.toUpperCase()} ${formatProbeTarget(definition)}`}>
                                {definition.region} · {definition.method.toUpperCase()} · {formatProbeTarget(definition)}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant={selected ? "secondary" : "outline"}
                              className="h-7 shrink-0 px-2 text-[11px]"
                              disabled={selectionLocked}
                              onClick={() => toggleHostSelection(definition.hostId)}
                            >
                              {selected ? "已选择" : "加入对比"}
                            </Button>
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <div className="rounded-md bg-background/45 px-2.5 py-2">
                              <p className="text-[10px] text-muted-foreground">当前 RTT</p>
                              <p className={cn("mt-0.5 text-base font-semibold tabular-nums", latest?.timeout ? "text-destructive" : "")}>
                                {latestLatencyLabel(definition, latest)}
                              </p>
                            </div>
                            <div className="rounded-md bg-background/45 px-2.5 py-2">
                              <p className="text-[10px] text-muted-foreground">{probeFailureLabel(definition)}</p>
                              <p className={cn("mt-0.5 text-base font-semibold tabular-nums", loss != null && loss > 0 ? "text-destructive" : "")}>
                                {loss == null || !Number.isFinite(loss) ? "--" : `${loss.toFixed(1)}%`}
                              </p>
                            </div>
                          </div>

                          <div className="mt-2 h-[54px] w-full">
                            {sparkData.length === 0 ? (
                              <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">等待趋势样本</div>
                            ) : (
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={sparkData} margin={{ top: 3, right: 2, bottom: 3, left: 2 }}>
                                  <Line type="linear" dataKey="latency" stroke={definition.color} strokeWidth={1.6} dot={false} isAnimationActive={false} />
                                </LineChart>
                              </ResponsiveContainer>
                            )}
                          </div>

                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {latest ? `最近样本 ${formatFullTime(latest.at)}` : "暂无最近样本"}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}

        <section className="rounded-xl border border-border/50 bg-card/35 p-3 sm:p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold">双机总对比</p>
                <Badge variant="outline" className="text-[10px]">最多 2 台</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedHostIds.length === 0
                  ? "从上面的任意运营商卡片选择服务器；同一台服务器只占一个对比名额。"
                  : selectedHostIds.length === 1
                    ? `已选择 ${selectedHostNames[0]}，再选择 1 台即可进行横向对比。`
                    : `正在对比 ${selectedHostNames.join("  vs  ")}。`}
              </p>
            </div>
            {selectedHostIds.length > 0 && (
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setSelectedHostIds([])}>清空选择</Button>
            )}
          </div>

          {selectedHostIds.length === 0 ? (
            <div className="mt-3 flex min-h-[110px] items-center justify-center rounded-lg border border-dashed border-border/50 text-sm text-muted-foreground">
              选择服务器后，这里只显示被选中的三网曲线，不再把所有主机叠在一起。
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              {CARRIER_ORDER.map((carrier) => {
                const compareDefinitions = (definitionsByCarrier.get(carrier) || [])
                  .filter((definition) => selectedHostIds.includes(definition.hostId));
                if (compareDefinitions.length === 0) return null;
                const yMax = latencyYMax(compareDefinitions, chartData, scaleMode);

                return (
                  <div key={carrier} className="rounded-lg border border-border/40 bg-background/20 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <CarrierBadge carrier={carrier} />
                        <span className="text-xs text-muted-foreground">24h RTT 对比</span>
                      </div>
                      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                        {compareDefinitions.map((definition) => {
                          const latest = latestByDefinition.get(definition.key);
                          const loss = latest?.loss;
                          return (
                            <span key={definition.key} className="flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-full" style={{ background: definition.color }} />
                              <span>{definition.hostName}</span>
                              <span className="font-medium text-foreground">{latestLatencyLabel(definition, latest)}</span>
                              <span className={cn(loss != null && loss > 0 ? "text-destructive" : "")}>{probeFailureLabel(definition)} {loss == null ? "--" : `${loss.toFixed(1)}%`}</span>
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    <div className="h-[210px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                          <XAxis
                            dataKey="at"
                            type="number"
                            domain={["dataMin", "dataMax"]}
                            tickFormatter={(value) => formatAxisTime(Number(value))}
                            tick={{ fontSize: 10 }}
                            minTickGap={54}
                          />
                          <YAxis domain={[0, yMax]} allowDataOverflow width={46} tick={{ fontSize: 10 }} unit="ms" />
                          <RechartsTooltip content={<CompareTooltip definitions={compareDefinitions} />} />
                          {compareDefinitions.map((definition) => (
                            <Line
                              key={definition.key}
                              type="linear"
                              dataKey={definition.key}
                              name={definition.hostName}
                              stroke={definition.color}
                              strokeWidth={1.8}
                              connectNulls
                              isAnimationActive={false}
                              dot={false}
                              activeDot={{ r: 3.5 }}
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <p className="text-[11px] text-muted-foreground">
          Ping 服务显示 Ping 丢包率，TCPing 服务显示 TCP 连接失败率；固定目标异常只代表该目标探测结果，不直接等同于整个运营商网络故障。
        </p>
      </CardContent>
    </Card>
  );
}
