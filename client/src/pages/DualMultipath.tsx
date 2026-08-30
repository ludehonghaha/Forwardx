import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import DataSectionLoading from "@/components/DataSectionLoading";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  buildDualMultipathDraftFromForm,
  defaultDualMultipathForm,
  dualMultipathFormFromDraft,
  type DualMultipathFormState,
} from "@/lib/dualMultipathForm";
import { trpc } from "@/lib/trpc";
import {
  Cable,
  CheckCircle2,
  Copy,
  Eye,
  Gauge,
  Loader2,
  LockKeyhole,
  Network,
  Save,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

function prettyJson(value: unknown) {
  return value ? JSON.stringify(value, null, 2) : "";
}

function PreviewBlock({ title, value }: { title: string; value: unknown }) {
  const text = prettyJson(value);
  const copy = async () => {
    if (!text) return;
    const ok = await copyTextToClipboard(text);
    ok ? toast.success(`${title}已复制`) : toast.error("复制失败，请手动选择内容");
  };
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{title}</Label>
        <Button type="button" variant="ghost" size="sm" disabled={!text} onClick={copy}>
          <Copy className="mr-1.5 h-3.5 w-3.5" />复制
        </Button>
      </div>
      <Textarea
        readOnly
        value={text}
        placeholder="点击“生成预览”后显示"
        className="min-h-64 resize-y font-mono text-xs leading-5"
        onFocus={(event) => event.currentTarget.select()}
      />
    </div>
  );
}

export default function DualMultipathPage() {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<DualMultipathFormState>(() => defaultDualMultipathForm());
  const currentQuery = trpc.dualMultipath.current.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!currentQuery.data?.draft) return;
    setForm(dualMultipathFormFromDraft(currentQuery.data.draft));
  }, [currentQuery.data?.draft]);

  const previewMutation = trpc.dualMultipath.preview.useMutation({
    onSuccess: () => toast.success("Dual 配置预览已生成，没有下发到任何 Agent"),
    onError: (error) => toast.error(error.message || "Dual 配置预览失败"),
  });
  const planMutation = trpc.dualMultipath.dryRunPlan.useMutation({
    onSuccess: () => toast.success("Dry-run 部署计划已生成；没有执行任何命令"),
    onError: (error) => toast.error(error.message || "Dry-run 部署计划生成失败"),
  });
  const saveMutation = trpc.dualMultipath.saveDraft.useMutation({
    onSuccess: async (result) => {
      setForm(dualMultipathFormFromDraft(result.draft));
      previewMutation.reset();
      planMutation.reset();
      await utils.dualMultipath.current.invalidate();
      toast.success("Dual 草稿已保存；运行环境没有变化");
    },
    onError: (error) => toast.error(error.message || "Dual 草稿保存失败"),
  });

  const patchForm = (patch: Partial<DualMultipathFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
    previewMutation.reset();
    planMutation.reset();
  };

  const buildDraft = () => {
    try {
      return buildDualMultipathDraftFromForm(form);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Dual 配置不完整");
      return null;
    }
  };

  const preview = () => {
    const draft = buildDraft();
    if (!draft) return;
    previewMutation.mutate(draft as any);
  };

  const dryRunPlan = () => {
    const draft = buildDraft();
    if (!draft) return;
    planMutation.mutate(draft as any);
  };

  const save = () => {
    const draft = buildDraft();
    if (!draft) return;
    saveMutation.mutate(draft as any);
  };

  if (currentQuery.isLoading) {
    return (
      <DashboardLayout>
        <DataSectionLoading label="正在加载 Dual 聚合草稿" minHeight="min-h-[320px]" />
      </DashboardLayout>
    );
  }

  const previewData = previewMutation.data;
  const planData = planMutation.data;
  const configured = currentQuery.data?.configured === true;
  const busy = previewMutation.isPending || planMutation.isPending || saveMutation.isPending;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Dual 聚合</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              专线优先，小流量先走低延迟线路；达到阈值后由 multipath 追加直连路径。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="gap-1.5 px-3 py-1.5">
              <Eye className="h-3.5 w-3.5" /> 预览模式
            </Badge>
            <Badge variant={configured ? "outline" : "secondary"} className="gap-1.5 px-3 py-1.5">
              <Save className="h-3.5 w-3.5" /> {configured ? "已有草稿" : "尚未保存"}
            </Badge>
          </div>
        </div>

        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>当前仍是安全灰度阶段</AlertTitle>
          <AlertDescription>
            本页只能保存草稿、生成配置预览和 Dry-run 部署计划；没有“启用/执行”按钮，不会下发 Agent、不会修改 Tunnel，也不会启动 sing-box multipath。
          </AlertDescription>
        </Alert>

        {currentQuery.isError ? (
          <Alert variant="destructive">
            <LockKeyhole className="h-4 w-4" />
            <AlertTitle>读取 Dual 草稿失败</AlertTitle>
            <AlertDescription>{currentQuery.error.message}</AlertDescription>
          </Alert>
        ) : null}

        <Card className="border-border/40 bg-card/60 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Network className="h-4 w-4 text-primary" /> 基本连接
            </CardTitle>
            <CardDescription>这里是两条路径共同连接的 multipath 服务端，不是专线或 HY2 的账号密码。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>配置名称</Label>
                <Input value={form.name} onChange={(event) => patchForm({ name: event.target.value })} placeholder="NoBrand Dual" />
              </div>
              <div className="space-y-2">
                <Label>Multipath 服务端地址</Label>
                <Input value={form.server} onChange={(event) => patchForm({ server: event.target.value })} placeholder="例如 127.0.0.1 或受信内网地址" />
                <p className="text-xs text-muted-foreground">如果两条已认证代理都终止在同一台 Dual，优先使用 127.0.0.1；只有 WireGuard 等受信三层网络才填写对应内网地址。</p>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-[180px_1fr]">
              <div className="space-y-2">
                <Label>服务端端口</Label>
                <Input type="number" min={1} max={65535} value={form.serverPort} onChange={(event) => patchForm({ serverPort: event.target.value })} />
              </div>
              <div className="rounded-lg border border-border/50 bg-muted/20 p-3 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">拓扑固定为 2 路</p>
                <p className="mt-1 text-xs leading-5">leg0 永远是专线并作为首选路径；leg1 永远是普通直连。当前版本故意不允许反过来，避免配置漂移。</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-border/40 bg-card/60 backdrop-blur-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Cable className="h-4 w-4 text-primary" /> leg0 · 专线
                <Badge variant="default">固定首选</Badge>
              </CardTitle>
              <CardDescription>网页、交互和新连接优先使用这条低延迟线路。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Outbound tag</Label>
                <Input value={form.privateOutboundTag} onChange={(event) => patchForm({ privateOutboundTag: event.target.value })} placeholder="dedicated" />
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                <div className="space-y-2">
                  <Label>本地 Mieru SOCKS5 地址</Label>
                  <Input value={form.privateSocksHost} readOnly />
                </div>
                <div className="space-y-2">
                  <Label>端口</Label>
                  <Input type="number" min={1} max={65535} value={form.privateSocksPort} onChange={(event) => patchForm({ privateSocksPort: event.target.value })} />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Username secret ref（可选）</Label>
                  <Input value={form.privateUsernameSecretRef} onChange={(event) => patchForm({ privateUsernameSecretRef: event.target.value })} placeholder="dual.mieru.username" />
                </div>
                <div className="space-y-2">
                  <Label>Password secret ref（可选）</Label>
                  <Input value={form.privatePasswordSecretRef} onChange={(event) => patchForm({ privatePasswordSecretRef: event.target.value })} placeholder="dual.mieru.password" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">这里只保存 `dual.*` 引用，不接收或显示真实 Mieru 凭据；两项要么都填，要么都留空。</p>
              <div className="space-y-2">
                <Label>预计带宽（Mbps）</Label>
                <Input type="number" min={1} value={form.privateBandwidthMbps} onChange={(event) => patchForm({ privateBandwidthMbps: event.target.value })} placeholder="160" />
                <p className="text-xs text-muted-foreground">两条线路带宽要么都填，要么都留空。</p>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/20 p-3">
                <div>
                  <p className="text-sm font-medium">支持 UDP</p>
                  <p className="text-xs text-muted-foreground">关闭后不能把 UDP 固定到专线。</p>
                </div>
                <Switch checked={form.privateSupportsUdp} onCheckedChange={(privateSupportsUdp) => patchForm({ privateSupportsUdp })} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/40 bg-card/60 backdrop-blur-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Gauge className="h-4 w-4 text-primary" /> leg1 · 普通直连
                <Badge variant="outline">大流量追加</Badge>
              </CardTitle>
              <CardDescription>达到启动阈值后参与大流量传输，用便宜带宽补吞吐。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Outbound tag</Label>
                <Input value={form.directOutboundTag} onChange={(event) => patchForm({ directOutboundTag: event.target.value })} placeholder="hy2-public" />
              </div>
              <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
                <div className="space-y-2">
                  <Label>Hysteria2 服务端</Label>
                  <Input value={form.directHy2Server} onChange={(event) => patchForm({ directHy2Server: event.target.value })} placeholder="dual.example.invalid" />
                </div>
                <div className="space-y-2">
                  <Label>端口</Label>
                  <Input type="number" min={1} max={65535} value={form.directHy2ServerPort} onChange={(event) => patchForm({ directHy2ServerPort: event.target.value })} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>TLS server name</Label>
                <Input value={form.directHy2TlsServerName} onChange={(event) => patchForm({ directHy2TlsServerName: event.target.value })} placeholder="dual.example.invalid" />
              </div>
              <div className="space-y-2">
                <Label>Auth secret ref</Label>
                <Input value={form.directHy2AuthSecretRef} onChange={(event) => patchForm({ directHy2AuthSecretRef: event.target.value })} placeholder="dual.hy2.auth" />
                <p className="text-xs text-muted-foreground">预览中的 password 只会显示为 `&lt;secret:dual.hy2.auth&gt;`，不会解析 secret value。</p>
              </div>
              <div className="space-y-2">
                <Label>预计带宽（Mbps）</Label>
                <Input type="number" min={1} value={form.directBandwidthMbps} onChange={(event) => patchForm({ directBandwidthMbps: event.target.value })} placeholder="700" />
                <p className="text-xs text-muted-foreground">这里填估算值即可，后续实机灰度再校准。</p>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/20 p-3">
                <div>
                  <p className="text-sm font-medium">支持 UDP</p>
                  <p className="text-xs text-muted-foreground">例如直连 HY2 路径通常需要 UDP。</p>
                </div>
                <Switch checked={form.directSupportsUdp} onCheckedChange={(directSupportsUdp) => patchForm({ directSupportsUdp })} />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/40 bg-card/60 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Network className="h-4 w-4 text-primary" /> OpenClash 本地 Sidecar
            </CardTitle>
            <CardDescription>OpenClash/Mihomo 只连接本地 SOCKS，不直接解析自定义 multipath outbound。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-[1fr_180px]">
              <div className="space-y-2">
                <Label>监听地址</Label>
                <Input value={form.openClashSocksListen} readOnly />
                <p className="text-xs text-muted-foreground">固定回环监听，禁止对 LAN/WAN 暴露未认证的本地 SOCKS。</p>
              </div>
              <div className="space-y-2">
                <Label>监听端口</Label>
                <Input type="number" min={1} max={65535} value={form.openClashSocksPort} onChange={(event) => patchForm({ openClashSocksPort: event.target.value })} />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/40 bg-card/60 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="h-4 w-4 text-primary" /> 聚合策略
            </CardTitle>
            <CardDescription>先保持少量关键参数，其他上游参数继续使用已验证的保守默认值。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label>启动直连阈值（Mbps）</Label>
                <Input type="number" min={1} value={form.activationThresholdMbps} onChange={(event) => patchForm({ activationThresholdMbps: event.target.value })} />
                <p className="text-xs text-muted-foreground">默认 120 Mbps；低于阈值时优先只用专线。</p>
              </div>
              <div className="space-y-2">
                <Label>统计窗口</Label>
                <Input value={form.activationWindow} onChange={(event) => patchForm({ activationWindow: event.target.value })} placeholder="1s" />
                <p className="text-xs text-muted-foreground">例如 500ms、1s、2s。</p>
              </div>
              <div className="space-y-2">
                <Label>UDP 默认路径</Label>
                <Select value={form.udpLegIndex} onValueChange={(udpLegIndex: "0" | "1") => patchForm({ udpLegIndex })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">专线 leg0（推荐）</SelectItem>
                    <SelectItem value="1">直连 leg1</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/20 p-3">
              <div>
                <p className="text-sm font-medium">TCP Fast Open</p>
                <p className="text-xs text-muted-foreground">当前 PoC 默认开启；固定上游的 multipath inbound/outbound 都支持这个字段。</p>
              </div>
              <Switch checked={form.tcpFastOpen} onCheckedChange={(tcpFastOpen) => patchForm({ tcpFastOpen })} />
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/40 bg-card/60 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Eye className="h-4 w-4 text-primary" /> 保存、预览与 Dry-run
            </CardTitle>
            <CardDescription>Dry-run 只列出部署前置条件和校验步骤，不执行任何命令。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button type="button" variant="outline" onClick={preview} disabled={busy}>
                {previewMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}
                生成预览
              </Button>
              <Button type="button" variant="outline" onClick={dryRunPlan} disabled={busy}>
                {planMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                Dry-run 部署计划
              </Button>
              <Button type="button" onClick={save} disabled={busy}>
                {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                保存草稿
              </Button>
            </div>

            {previewData ? (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>编译预览通过</AlertTitle>
                <AlertDescription>
                  上游固定为 {previewData.upstream.repository} / {previewData.upstream.branch} / {previewData.upstream.protocolGeneration}；安全标记确认 Agent、Runtime、Tunnel 均未启用。
                </AlertDescription>
              </Alert>
            ) : null}

            {planData ? (
              <div className="space-y-4 rounded-lg border border-border/50 bg-muted/10 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">P1 Dry-run 部署计划</p>
                    <p className="mt-1 text-xs text-muted-foreground">计划只读，不包含 Agent 推送、命令执行、systemd、防火墙或 Tunnel 修改。</p>
                  </div>
                  <Badge variant={planData.readyToDeploy ? "default" : "secondary"}>
                    {planData.readyToDeploy ? "可部署" : "仍有阻塞项"}
                  </Badge>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-border/50 bg-background/50 p-3">
                    <p className="text-sm font-medium">计划监听</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {planData.listener.listen}:{planData.listener.port} · TCP Fast Open {planData.listener.tcpFastOpen ? "ON" : "OFF"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">默认回环监听；不允许裸 multipath 端口直接暴露公网。</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-background/50 p-3">
                    <p className="text-sm font-medium">固定上游</p>
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{planData.upstream.commit}</p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-border/50 bg-background/50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">OpenClash 接入</p>
                      <Badge variant="outline">Sidecar</Badge>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">不能把自定义 multipath outbound 当成 Mihomo 普通节点直接导入。计划使用 {planData.clientCompatibility.requiredCore} sidecar 暴露本地 SOCKS，再由 OpenClash 把它当普通本地节点。</p>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-background/50 p-3">
                    <p className="text-sm font-medium">两条载体</p>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">专线可以通过客户端本地 SOCKS 桥接现有代理；公网 leg1 必须使用已认证传输，不能直接连接裸 multipath listener。</p>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>当前阻塞项</Label>
                  <div className="space-y-2">
                    {planData.blockers.map((blocker) => (
                      <div key={blocker} className="flex gap-2 rounded-md border border-border/50 bg-background/50 p-3 text-xs leading-5">
                        <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span>{blocker}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>未来允许执行前的原生校验</Label>
                  {planData.proposedChecks.map((check) => (
                    <div key={check.id} className="space-y-2 rounded-md border border-border/50 bg-background/50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs font-medium">{check.label}</p>
                        <Badge variant="outline">当前不可执行</Badge>
                      </div>
                      <code className="block break-all rounded bg-muted/40 p-2 text-xs">{check.command}</code>
                      <p className="text-xs text-muted-foreground">{check.reason}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="grid gap-4 xl:grid-cols-2">
              <PreviewBlock title="客户端完整 Sidecar 配置（脱敏）" value={previewData?.clientConfig} />
              <PreviewBlock title="服务端 Multipath / Carrier 边界（脱敏）" value={previewData?.serverPreview} />
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
