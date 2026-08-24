import { useMemo, useState } from "react";
import { BarChart3, CalendarDays, RefreshCw, Users } from "lucide-react";
import { useLocation } from "wouter";
import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import DataSectionLoading from "@/components/DataSectionLoading";
import { trpc } from "@/lib/trpc";

function formatBytes(value: unknown) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 4).toFixed(2)} TB`;
}

function shortDate(value: string) {
  const parts = value.split("-");
  return parts.length === 3 ? `${parts[1]}/${parts[2]}` : value;
}

function StatCard({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

export default function UserTrafficHistoryPage() {
  const [, navigate] = useLocation();
  const [days, setDays] = useState<7 | 14 | 31>(7);
  const query = trpc.userTrafficHistory.daily.useQuery(
    { days },
    { refetchOnWindowFocus: false },
  );

  const rows = useMemo(() => (query.data?.users || []) as any[], [query.data]);
  const totalToday = useMemo(() => rows.reduce((sum, row) => sum + Number(row.today || 0), 0), [rows]);
  const totalPeriod = useMemo(() => rows.reduce((sum, row) => sum + Number(row.periodTotal || 0), 0), [rows]);
  const activeToday = useMemo(() => rows.filter((row) => Number(row.today || 0) > 0).length, [rows]);

  return (
    <DashboardLayout>
      <div className="space-y-5 p-3 sm:p-4 lg:p-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-semibold">用户每日流量</h1>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              按 Asia/Shanghai 计费日汇总，每 5 分钟刷新；日汇总保留 62 天，页面最多查看最近 31 天。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-border p-1">
              {([7, 14, 31] as const).map((range) => (
                <Button
                  key={range}
                  size="sm"
                  variant={days === range ? "default" : "ghost"}
                  className="h-7 px-3"
                  onClick={() => setDays(range)}
                >
                  {range} 天
                </Button>
              ))}
            </div>
            <Button size="sm" variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />刷新
            </Button>
            <Button size="sm" variant="outline" onClick={() => navigate("/users")}>返回用户管理</Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard title="今日总流量" value={formatBytes(totalToday)} hint={`${activeToday} 个用户今日有流量`} />
          <StatCard title={`${days} 天总流量`} value={formatBytes(totalPeriod)} hint="所有普通用户合计" />
          <StatCard title="统计用户" value={String(rows.length)} hint="管理员账号不计入列表" />
        </div>

        {query.isLoading && !query.data ? (
          <DataSectionLoading />
        ) : query.isError ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-destructive">
              加载用户流量历史失败：{query.error?.message || "未知错误"}
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <Card>
            <CardContent className="p-10 text-center text-sm text-muted-foreground">暂无普通用户流量数据</CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {rows.map((user) => {
              const daily = Array.isArray(user.daily) ? user.daily : [];
              const maxDaily = Math.max(0, ...daily.map((item: any) => Number(item.total || 0)));
              const quota = Number(user.trafficLimit || 0);
              return (
                <Card key={user.userId}>
                  <CardHeader className="pb-3">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Users className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <CardTitle className="truncate text-base">{user.name || user.username || `用户 #${user.userId}`}</CardTitle>
                            <Badge variant={user.accountEnabled ? "secondary" : "outline"}>{user.accountEnabled ? "启用" : "停用"}</Badge>
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">{user.username} · ID {user.userId}</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-x-5 gap-y-2 text-right text-xs sm:gap-x-8">
                        <div><div className="text-muted-foreground">今天</div><div className="mt-1 font-semibold tabular-nums">{formatBytes(user.today)}</div></div>
                        <div><div className="text-muted-foreground">昨天</div><div className="mt-1 font-semibold tabular-nums">{formatBytes(user.yesterday)}</div></div>
                        <div><div className="text-muted-foreground">{days} 天</div><div className="mt-1 font-semibold tabular-nums">{formatBytes(user.periodTotal)}</div></div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    <div className="overflow-x-auto pb-1">
                      <div className="flex h-28 min-w-max items-end gap-1.5 rounded-lg border border-border/70 bg-muted/20 px-3 pb-2 pt-3">
                        {daily.map((item: any) => {
                          const total = Number(item.total || 0);
                          const height = maxDaily > 0 ? Math.max(total > 0 ? 4 : 1, Math.round((total / maxDaily) * 62)) : 1;
                          return (
                            <div key={item.date} className="flex w-11 flex-col items-center justify-end gap-1" title={`${item.date} · ${formatBytes(total)} · 入 ${formatBytes(item.bytesIn)} / 出 ${formatBytes(item.bytesOut)}`}>
                              <div className="max-w-11 truncate text-[9px] tabular-nums text-muted-foreground">{total > 0 ? formatBytes(total) : "0"}</div>
                              <div className="w-4 rounded-t bg-primary/70" style={{ height: `${height}px` }} />
                              <div className="text-[9px] text-muted-foreground">{shortDate(item.date)}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border/60 pt-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />当前周期已用 <strong className="font-medium text-foreground">{formatBytes(user.trafficUsed)}</strong></span>
                      <span>套餐额度 <strong className="font-medium text-foreground">{quota > 0 ? formatBytes(quota) : "不限量"}</strong></span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {query.data?.generatedAt ? (
          <div className="text-right text-xs text-muted-foreground">最后生成：{new Date(query.data.generatedAt).toLocaleString("zh-CN")}</div>
        ) : null}
      </div>
    </DashboardLayout>
  );
}
