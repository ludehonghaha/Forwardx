import { useEffect, useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import DataSectionLoading from "@/components/DataSectionLoading";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  buildDualMultipathDraftFromForm,
  defaultDualMultipathForm,
  dualMultipathFormFromDraft,
  type DualMultipathFormState,
} from "@/lib/dualMultipathForm";
import { trpc } from "@/lib/trpc";
import { Cable, CheckCircle2, Copy, Eye, Gauge, Loader2, LockKeyhole, Network, Play, Save, Server, ShieldCheck, Square, TerminalSquare } from "lucide-react";
import { toast } from "sonner";

type PilotHostOption = {
  id: number;
  name: string;
  isOnline: boolean;
  ip?: string | null;
  ipv4?: string | null;
  ipv6?: string | null;
};

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
      <Textarea readOnly value={text} placeholder="点击“生成诊断预览”后显示" className="min-h-64 resize-y font-mono text-xs leading-5" />
    </div>
  );
}

function StatusRow({ label, protocol, status, detail }: { label: string; protocol: string; status: string; detail: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/50 bg-muted/15 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <p className="font-medium">{label}</p>
          <Badge variant="outline">{protocol}</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </div>
      <Badge variant="secondary">{status}</Badge>
    </div>
  );
}

function pilotStateLabel(state: string | undefined) {
  if (state === "queued") return "等待 Agent";
  if (state === "running") return "执行中";
  if (state === "success") return "操作成功";
  if (state === "error") return "操作失败";
  if (state === "timeout") return "Agent 超时";
  return "尚未检查";
}

export default function DualMultipathPage() {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<DualMultipathFormState>(() => defaultDualMultipathForm());
  const [pilotServerHostId, setPilotServerHostId] = useState(0);
  const currentQuery = trpc.dualMultipath.current.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const hostsQuery = trpc.hosts.listAll.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });
  const pilotHosts = (hostsQuery.data || []) as PilotHostOption[];
  const pilotStatusQuery = trpc.dualMultipath.pilotActionStatus.useQuery(
    { hostId: pilotServerHostId || 1 },
    {
      enabled: pilotServerHostId > 0,
      retry: false,
      refetchOnWindowFocus: false,
      refetchInterval: pilotServerHostId > 0 ? 2000 : false,
    },
  );

  useEffect(() => {
    if (currentQuery.data?.draft) setForm(dualMultipathFormFromDraft(currentQuery.data.draft));
  }, [currentQuery.data?.draft]);

  const previewMutation = trpc.dualMultipath.preview.useMutation({
    onSuccess: () => toast.success("离线诊断预览已生成，没有下发到任何 Agent"),
    onError: (error) => toast.error(error.message || "Dual 预览失败"),
  });
  const planMutation = trpc.dualMultipath.dryRunPlan.useMutation({
    onSuccess: () => toast.success("Dry-run 已生成；没有执行任何命令"),
    onError: (error) => toast.error(error.message || "Dry-run 生成失败"),
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
  const pilotActionMutation = trpc.dualMultipath.pilotAction.useMutation({
    onSuccess: async (result) => {
      await pilotStatusQuery.refetch();
      toast.success(`Dual Pilot ${result.task.action} 已进入 Agent 专用任务队列`);
    },
    onError: (error) => toast.error(error.message || "Dual Pilot 操作失败"),
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
  const submit = (kind: "preview" | "plan" | "save") => {
    const draft = buildDraft();
    if (!draft) return;
    if (kind === "preview") previewMutation.mutate(draft);
    if (kind === "plan") planMutation.mutate(draft);
    if (kind === "save") saveMutation.mutate(draft);
  };

  const runPilotAction = (action: "start" | "stop" | "status") => {
    if (!pilotServerHostId) {
      toast.error("请先明确选择 7CM Dual 服务端 Agent");
      return;
    }
    const selectedHost = pilotHosts.find((host) => Number(host.id) === pilotServerHostId);
    if (!selectedHost) {
      toast.error("选择的服务端主机不存在");
      return;
    }
    if (!selectedHost.isOnline) {
      toast.error("该 Agent 当前离线，未下发 Pilot 操作");
      return;
    }
    pilotActionMutation.mutate({ hostId: pilotServerHostId, action });
  };

  if (currentQuery.isLoading) {
    return <DashboardLayout><DataSectionLoading label="正在加载 Dual 聚合草稿" minHeight="min-h-[320px]" /></DashboardLayout>;
  }

  const previewData = previewMutation.data;
  const planData = planMutation.data;
  const configured = currentQuery.data?.configured === true;
  const busy = previewMutation.isPending || planMutation.isPending || saveMutation.isPending;
  const privateBridge = form.infrastructure.privateCarrierBridge;
  const privateStatus = privateBridge.type === "mihomo-dedicated-listener"
    ? privateBridge.target.discovery.status === "verified-read-only"
      && privateBridge.listener.portPlanning.status === "planned-read-only"
      ? "已就绪"
      : "等待自动发现 / 规划"
    : privateBridge.type === "forwardx-managed-mieru-sidecar"
      ? privateBridge.listener.portPlanning.status === "planned-read-only" ? "等待凭据注入" : "等待自动规划"
      : privateBridge.endpointDiscovery.status === "verified-read-only" ? "已就绪" : "等待发现 endpoint";
  const directStatus = form.infrastructure.directCarrier?.status === "resolved" ? "已就绪" : "运行时未配置";
  const ingressPort = form.infrastructure.openClashIngressAdapter.portPlanning.port;
  const privatePort = privateBridge.type === "external-local-socks5" ? null : privateBridge.listener.portPlanning.port;
  const privateProxy = privateBridge.type === "mihomo-dedicated-listener" ? privateBridge.target.discovery.proxyRef : null;
  const serverTarget = form.infrastructure.serverTargetDiscovery;
  const clientTarget = form.infrastructure.clientTarget;
  const clientTargetLabel = clientTarget.status === "unresolved"
    ? "未绑定"
    : clientTarget.ref.kind === "forwardx-host"
      ? `ForwardX Host #${clientTarget.ref.hostId}`
      : clientTarget.ref.targetKey;
  const clientSnapshotId = form.infrastructure.openClashIngressAdapter.portPlanning.status === "planned-read-only"
    ? form.infrastructure.openClashIngressAdapter.portPlanning.evidence.snapshotId
    : privateBridge.type === "mihomo-dedicated-listener" && privateBridge.target.discovery.status === "verified-read-only"
      ? privateBridge.target.discovery.evidence.snapshotId
      : null;
  const pilotStatus = pilotStatusQuery.data?.status;
  const selectedPilotHost = pilotHosts.find((host) => Number(host.id) === pilotServerHostId);
  const pilotBusy = pilotActionMutation.isPending || pilotStatus?.state === "queued" || pilotStatus?.state === "running";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Dual 聚合</h1>
            <p className="mt-1 text-sm text-muted-foreground">一个聚合节点：小流量优先专线，大流量自动追加直连。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="gap-1.5"><Eye className="h-3.5 w-3.5" />诊断预览</Badge>
            <Badge variant="secondary">Pilot 实验</Badge>
            <Badge variant={configured ? "outline" : "secondary"}>{configured ? "已有草稿" : "尚未保存"}</Badge>
          </div>
        </div>

        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>生产部署门禁仍然关闭</AlertTitle>
          <AlertDescription>草稿、预览和 Dry-run 不修改运行环境。下方 Pilot 控制只有在你明确选择服务端 Agent 后才会下发固定 start / stop / status；它只管理独立 Pilot runtime，不允许修改生产 Mita、HY2、systemd、防火墙或路由。</AlertDescription>
        </Alert>

        {currentQuery.isError ? (
          <Alert variant="destructive"><LockKeyhole className="h-4 w-4" /><AlertTitle>读取草稿失败</AlertTitle><AlertDescription>{currentQuery.error.message}</AlertDescription></Alert>
        ) : null}

        <Card className="border-border/40 bg-card/60 backdrop-blur-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Network className="h-4 w-4 text-primary" />Dual 线路</CardTitle>
            <CardDescription>底层 bridge、listener、端口和 secret reference 由 ForwardX 管理，不作为日常设置。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>名称</Label>
              <Input value={form.name} onChange={(event) => patchForm({ name: event.target.value })} />
            </div>
            <StatusRow label="专线" protocol="Mieru" status={privateStatus} detail="首选路径；ForwardX 独立管理官方 Mieru client sidecar，不依赖 Clash Mi。" />
            <StatusRow label="直连" protocol="Hysteria2" status={directStatus} detail="达到阈值后追加；后续固定走 Dual 公网侧，不改变系统默认路由。" />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>专线带宽（Mbps）</Label><Input type="number" min={1} value={form.privateBandwidthMbps} onChange={(event) => patchForm({ privateBandwidthMbps: event.target.value })} /></div>
              <div className="space-y-2"><Label>直连带宽（Mbps）</Label><Input type="number" min={1} value={form.directBandwidthMbps} onChange={(event) => patchForm({ directBandwidthMbps: event.target.value })} /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>激活直连阈值（Mbps）</Label><Input type="number" min={1} value={form.activationThresholdMbps} onChange={(event) => patchForm({ activationThresholdMbps: event.target.value })} /></div>
              <div className="space-y-2"><Label>统计窗口</Label><Input value={form.activationWindow} onChange={(event) => patchForm({ activationWindow: event.target.value })} /></div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button type="button" onClick={() => submit("save")} disabled={busy}>{saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}保存 Dual 草稿</Button>
              <Button type="button" variant="outline" disabled title="运行时与订阅尚未就绪"><Cable className="mr-2 h-4 w-4" />生成订阅（尚未就绪）</Button>
            </div>
          </CardContent>
        </Card>

        <Card className="border-amber-500/30 bg-card/60 backdrop-blur-md">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2"><Server className="h-4 w-4 text-primary" />服务端 Pilot</CardTitle>
                <CardDescription className="mt-1">实验启停通道。当前只控制 7CM Dual 服务端；客户端接入和订阅仍不属于生产部署。</CardDescription>
              </div>
              <Badge variant="secondary">readyToDeploy=false</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <LockKeyhole className="h-4 w-4" />
              <AlertTitle>必须手动绑定正确的服务端 Agent</AlertTitle>
              <AlertDescription>ForwardX 不会从 IP、客户端目标或 discovery 名称猜主机 ID。机器未预装 Dual Pilot runtime 时，Agent 只会返回“未安装”，不会自动下载或触碰生产服务。</AlertDescription>
            </Alert>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <div className="space-y-2">
                <Label htmlFor="dual-pilot-server-host">7CM Dual 服务端 Agent</Label>
                <select
                  id="dual-pilot-server-host"
                  value={pilotServerHostId || ""}
                  onChange={(event) => setPilotServerHostId(Number(event.target.value) || 0)}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  disabled={hostsQuery.isLoading || pilotBusy}
                >
                  <option value="">请选择，不自动猜测</option>
                  {pilotHosts.map((host) => (
                    <option key={host.id} value={host.id}>{host.name} · #{host.id} · {host.isOnline ? "在线" : "离线"} · {host.ip || host.ipv4 || host.ipv6 || "无地址"}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" disabled={!pilotServerHostId || pilotBusy || !selectedPilotHost?.isOnline} onClick={() => runPilotAction("status")}>
                  {pilotActionMutation.isPending && pilotActionMutation.variables?.action === "status" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <TerminalSquare className="mr-2 h-4 w-4" />}检查状态
                </Button>
                <Button type="button" disabled={!pilotServerHostId || pilotBusy || !selectedPilotHost?.isOnline} onClick={() => runPilotAction("start")}>
                  {pilotActionMutation.isPending && pilotActionMutation.variables?.action === "start" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}启动 Pilot
                </Button>
                <Button type="button" variant="destructive" disabled={!pilotServerHostId || pilotBusy || !selectedPilotHost?.isOnline} onClick={() => runPilotAction("stop")}>
                  {pilotActionMutation.isPending && pilotActionMutation.variables?.action === "stop" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Square className="mr-2 h-4 w-4" />}停止 Pilot
                </Button>
              </div>
            </div>
            <div className="rounded-xl border border-border/50 bg-muted/15 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">最近一次 Pilot Agent 操作</p>
                  <p className="mt-1 text-xs text-muted-foreground">{selectedPilotHost ? `${selectedPilotHost.name} · Host #${selectedPilotHost.id}` : "尚未选择服务端"}</p>
                </div>
                <Badge variant={pilotStatus?.state === "error" || pilotStatus?.state === "timeout" ? "destructive" : "secondary"}>{pilotStateLabel(pilotStatus?.state)}</Badge>
              </div>
              {pilotStatus ? (
                <div className="mt-3 space-y-2 text-xs">
                  <p className="text-muted-foreground">动作：{pilotStatus.action} · Task {pilotStatus.taskId}</p>
                  {pilotStatus.error ? <p className="whitespace-pre-wrap text-destructive">{pilotStatus.error}</p> : null}
                  {pilotStatus.output ? <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-background/70 p-3 font-mono leading-5">{pilotStatus.output}</pre> : null}
                </div>
              ) : <p className="mt-3 text-xs text-muted-foreground">点击“检查状态”后，结果会通过现有加密 Agent 通道返回。</p>}
            </div>
          </CardContent>
        </Card>

        <details className="rounded-xl border border-border/50 bg-card/40">
          <summary className="cursor-pointer px-5 py-4 text-sm font-medium">高级 / 诊断（离线、脱敏）</summary>
          <div className="space-y-5 border-t border-border/50 p-5">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg bg-muted/25 p-3"><p className="text-xs text-muted-foreground">服务端</p><p className="mt-1 text-sm">{serverTarget.targetId} · {serverTarget.status === "verified-read-only" ? "已发现" : "未发现"}</p></div>
              <div className="rounded-lg bg-muted/25 p-3"><p className="text-xs text-muted-foreground">客户端</p><p className="mt-1 break-all text-sm">{clientTargetLabel}</p></div>
              <div className="rounded-lg bg-muted/25 p-3"><p className="text-xs text-muted-foreground">Client snapshot</p><p className="mt-1 break-all text-sm">{clientSnapshotId ?? "未获取"}</p></div>
              <div className="rounded-lg bg-muted/25 p-3"><p className="text-xs text-muted-foreground">Dual ingress port</p><p className="mt-1 text-sm">{ingressPort ?? "等待自动规划"}</p></div>
              <div className="rounded-lg bg-muted/25 p-3"><p className="text-xs text-muted-foreground">Mieru sidecar SOCKS</p><p className="mt-1 text-sm">{privatePort ?? "等待自动规划"}</p></div>
              <div className="rounded-lg bg-muted/25 p-3"><p className="text-xs text-muted-foreground">Private carrier owner</p><p className="mt-1 text-sm">{privateBridge.type === "forwardx-managed-mieru-sidecar" ? "ForwardX official Mieru" : privateProxy ?? "外部 bridge"}</p></div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="outline" onClick={() => submit("preview")} disabled={busy}>{previewMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}生成诊断预览</Button>
              <Button type="button" variant="outline" onClick={() => submit("plan")} disabled={busy}>{planMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Gauge className="mr-2 h-4 w-4" />}生成 Dry-run</Button>
            </div>
            {previewData ? <Alert><CheckCircle2 className="h-4 w-4" /><AlertTitle>确定性脱敏预览已生成</AlertTitle><AlertDescription>native HY2 依赖 pinned artifact 的 with_quic 构建；所有生产 runtime mutation 仍关闭。</AlertDescription></Alert> : null}
            {planData ? (
              <div className="space-y-2 rounded-lg border border-border/50 p-4">
                <div className="flex items-center justify-between"><p className="text-sm font-medium">部署阻塞项</p><Badge variant="secondary">readyToDeploy=false</Badge></div>
                {planData.blockers.map((blocker) => <div key={blocker} className="flex gap-2 text-xs leading-5 text-muted-foreground"><LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />{blocker}</div>)}
              </div>
            ) : null}
            <div className="grid gap-4 xl:grid-cols-3">
              <PreviewBlock title="Official Mieru sidecar" value={previewData?.mieruPrivateSidecar ?? previewData?.mihomoPrivateListener} />
              <PreviewBlock title="Client sidecar" value={previewData?.clientConfig} />
              <PreviewBlock title="Server runtime boundary" value={previewData?.serverPreview} />
            </div>
          </div>
        </details>
      </div>
    </DashboardLayout>
  );
}
