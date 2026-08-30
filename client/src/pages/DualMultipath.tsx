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
import { Cable, CheckCircle2, Copy, Eye, Gauge, Loader2, LockKeyhole, Network, Save, ShieldCheck } from "lucide-react";
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

export default function DualMultipathPage() {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<DualMultipathFormState>(() => defaultDualMultipathForm());
  const currentQuery = trpc.dualMultipath.current.useQuery(undefined, { retry: false, refetchOnWindowFocus: false });

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
    if (kind === "preview") previewMutation.mutate(draft as any);
    if (kind === "plan") planMutation.mutate(draft as any);
    if (kind === "save") saveMutation.mutate(draft as any);
  };

  if (currentQuery.isLoading) {
    return <DashboardLayout><DataSectionLoading label="正在加载 Dual 聚合草稿" minHeight="min-h-[320px]" /></DashboardLayout>;
  }

  const previewData = previewMutation.data;
  const planData = planMutation.data;
  const configured = currentQuery.data?.configured === true;
  const busy = previewMutation.isPending || planMutation.isPending || saveMutation.isPending;
  const privateStatus = form.infrastructure.privateCarrierBridge?.status === "resolved" ? "已就绪" : "等待自动发现纯 Mieru 节点";
  const directStatus = form.infrastructure.directCarrier?.status === "resolved" ? "已就绪" : "运行时未配置";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Dual 聚合</h1>
            <p className="mt-1 text-sm text-muted-foreground">一个聚合节点：小流量优先专线，大流量自动追加直连。</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="gap-1.5"><Eye className="h-3.5 w-3.5" />离线预览</Badge>
            <Badge variant={configured ? "outline" : "secondary"}>{configured ? "已有草稿" : "尚未保存"}</Badge>
          </div>
        </div>

        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>部署门禁保持关闭</AlertTitle>
          <AlertDescription>本页只有 ForwardX 的 Dual 草稿与脱敏预览；不会修改 OpenClash、Mita、systemd、防火墙、路由或远端运行时。</AlertDescription>
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
            <StatusRow label="专线" protocol="Mieru" status={privateStatus} detail="首选路径；ForwardX 将通过 Mihomo dedicated listener 固定到单一纯 Mieru proxy。" />
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

        <details className="rounded-xl border border-border/50 bg-card/40">
          <summary className="cursor-pointer px-5 py-4 text-sm font-medium">高级 / 诊断（离线、脱敏）</summary>
          <div className="space-y-5 border-t border-border/50 p-5">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg bg-muted/25 p-3"><p className="text-xs text-muted-foreground">OpenClash adapter</p><p className="mt-1 text-sm">本地 SOCKS sidecar · 自动规划</p></div>
              <div className="rounded-lg bg-muted/25 p-3"><p className="text-xs text-muted-foreground">Private bridge</p><p className="mt-1 text-sm">Mihomo dedicated listener · {privateStatus}</p></div>
              <div className="rounded-lg bg-muted/25 p-3"><p className="text-xs text-muted-foreground">Server listener</p><p className="mt-1 text-sm">loopback-only · 不允许公网暴露</p></div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="outline" onClick={() => submit("preview")} disabled={busy}>{previewMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}生成诊断预览</Button>
              <Button type="button" variant="outline" onClick={() => submit("plan")} disabled={busy}>{planMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Gauge className="mr-2 h-4 w-4" />}生成 Dry-run</Button>
            </div>
            {previewData ? <Alert><CheckCircle2 className="h-4 w-4" /><AlertTitle>确定性脱敏预览已生成</AlertTitle><AlertDescription>native HY2 依赖 pinned artifact 的 with_quic 构建；所有 runtime mutation 仍关闭。</AlertDescription></Alert> : null}
            {planData ? (
              <div className="space-y-2 rounded-lg border border-border/50 p-4">
                <div className="flex items-center justify-between"><p className="text-sm font-medium">部署阻塞项</p><Badge variant="secondary">readyToDeploy=false</Badge></div>
                {planData.blockers.map((blocker) => <div key={blocker} className="flex gap-2 text-xs leading-5 text-muted-foreground"><LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />{blocker}</div>)}
              </div>
            ) : null}
            <div className="grid gap-4 xl:grid-cols-3">
              <PreviewBlock title="Mihomo dedicated listener" value={previewData?.mihomoPrivateListener} />
              <PreviewBlock title="Client sidecar" value={previewData?.clientConfig} />
              <PreviewBlock title="Server runtime boundary" value={previewData?.serverPreview} />
            </div>
          </div>
        </details>
      </div>
    </DashboardLayout>
  );
}
