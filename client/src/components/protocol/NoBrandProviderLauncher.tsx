import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { Download, Loader2, RadioTower, RefreshCw, ScanSearch, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

function hostLabel(host: any) {
  const name = String(host?.name || "").trim() || `主机 #${host?.id}`;
  const address = String(host?.entryIp || host?.ipv4 || host?.ip || host?.ipv6 || "").trim();
  return address ? `${name} · ${address}` : name;
}

function protocolLabel(value: unknown) {
  if (value === "mieru") return "Mieru";
  if (value === "snell") return "Snell";
  if (value === "hysteria2") return "Hysteria2";
  if (value === "vless-sudoku") return "VLESS Sudoku";
  return String(value || "未知协议");
}

function statusLabel(state?: string | null) {
  if (state === "queued") return "已排队";
  if (state === "running") return "扫描中";
  if (state === "success") return "扫描完成";
  if (state === "error") return "扫描失败";
  if (state === "timeout") return "扫描超时";
  return "未扫描";
}

function statusVariant(state?: string | null): "default" | "secondary" | "destructive" | "outline" {
  if (state === "success") return "default";
  if (state === "error" || state === "timeout") return "destructive";
  if (state === "queued" || state === "running") return "secondary";
  return "outline";
}

export default function NoBrandProviderLauncher() {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const [hostId, setHostId] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const hostsQuery = trpc.hosts.options.useQuery(undefined, {
    enabled: open,
    staleTime: 30_000,
    placeholderData: (previousData: any) => previousData,
  });
  const hosts = (hostsQuery.data || []) as any[];
  const agentHosts = useMemo(
    () => hosts.filter((host) => String(host?.agentVersion || "").trim()),
    [hosts],
  );

  useEffect(() => {
    if (!open || hostId || agentHosts.length === 0) return;
    setHostId(Number(agentHosts[0]?.id || 0));
  }, [agentHosts, hostId, open]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [hostId]);

  const statusQuery = trpc.nobrandProvider.status.useQuery(
    { hostId: hostId || 1 },
    {
      enabled: open && hostId > 0,
      retry: false,
      refetchInterval: open && hostId > 0 ? 1_500 : false,
    },
  );
  const status = statusQuery.data;
  const scanDone = status?.state === "success";
  const candidatesQuery = trpc.nobrandProvider.candidates.useQuery(
    { hostId: hostId || 1 },
    {
      enabled: open && hostId > 0 && scanDone && status?.installed === true,
      retry: false,
    },
  );
  const candidates = (candidatesQuery.data || []) as any[];
  const supportedCandidates = candidates.filter((candidate) => candidate?.supported === true && candidate?.protocol);
  const busy = status?.state === "queued" || status?.state === "running";

  const scanMutation = trpc.nobrandProvider.scan.useMutation({
    onSuccess: async () => {
      setSelectedIds(new Set());
      toast.success("NoBrand 扫描已下发给 Agent");
      await Promise.all([
        utils.nobrandProvider.status.invalidate({ hostId }),
        utils.nobrandProvider.candidates.invalidate({ hostId }),
      ]);
    },
    onError: (error) => toast.error(error.message || "NoBrand 扫描启动失败"),
  });

  const importMutation = trpc.nobrandProvider.importCandidates.useMutation({
    onSuccess: async (result) => {
      const createdCount = Number(result.createdCount || 0);
      const duplicateCount = Number(result.duplicateCount || 0);
      if (createdCount > 0) {
        toast.success(`已导入 ${createdCount} 个 NoBrand 节点${duplicateCount ? `，跳过 ${duplicateCount} 个重复节点` : ""}`);
      } else if (duplicateCount > 0) {
        toast.success(`所选节点已经存在，已跳过 ${duplicateCount} 个重复节点`);
      } else {
        toast.success("没有需要新增的节点");
      }
      setSelectedIds(new Set());
      await Promise.all([
        utils.protocolAccess.listEndpoints.invalidate(),
        utils.nobrandProvider.candidates.invalidate({ hostId }),
      ]);
    },
    onError: (error) => toast.error(error.message || "NoBrand 节点导入失败"),
  });

  const toggleCandidate = (candidateId: string, checked: boolean) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(candidateId);
      else next.delete(candidateId);
      return next;
    });
  };

  const selectAllSupported = () => {
    setSelectedIds(new Set(supportedCandidates.map((candidate) => String(candidate.candidateId))));
  };

  const runScan = () => {
    if (!hostId) {
      toast.error("请选择已连接 Agent 的主机");
      return;
    }
    scanMutation.mutate({ hostId });
  };

  const importSelected = () => {
    const candidateIds = Array.from(selectedIds);
    if (!hostId || candidateIds.length === 0) {
      toast.error("请选择至少一个可导入节点");
      return;
    }
    importMutation.mutate({ hostId, candidateIds });
  };

  return (
    <>
      <Button
        type="button"
        className="fixed bottom-5 right-5 z-40 shadow-lg"
        onClick={() => setOpen(true)}
      >
        <ScanSearch className="mr-2 h-4 w-4" />
        扫描 NoBrand
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[92svh] w-[calc(100vw-1rem)] max-w-3xl flex-col overflow-hidden p-0">
          <DialogHeader className="px-5 pt-5">
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5" /> NoBrand Provider
            </DialogTitle>
            <DialogDescription>
              只读扫描 NoBrand-OneClick，选择节点后以 external 方式导入。ForwardX 不会接管、重启或删除 NoBrand 的运行服务。
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-5">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <div className="space-y-2">
                <p className="text-sm font-medium">Agent 主机</p>
                <Select value={hostId ? String(hostId) : ""} onValueChange={(value) => setHostId(Number(value))}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择安装了 NoBrand 的主机" />
                  </SelectTrigger>
                  <SelectContent>
                    {agentHosts.map((host) => (
                      <SelectItem key={host.id} value={String(host.id)}>{hostLabel(host)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {open && !hostsQuery.isLoading && agentHosts.length === 0 ? (
                  <p className="text-xs text-destructive">当前没有已连接 ForwardX Agent 的主机。</p>
                ) : null}
              </div>
              <Button type="button" onClick={runScan} disabled={!hostId || busy || scanMutation.isPending}>
                {busy || scanMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                {busy ? "正在扫描" : "扫描 NoBrand"}
              </Button>
            </div>

            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-3">
                  <RadioTower className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">扫描状态</p>
                    <p className="text-xs text-muted-foreground">
                      {status?.error || (status?.installed === false && scanDone ? "未发现 NoBrand-OneClick v3 安装" : "扫描结果只短暂保存在面板内存中，不写入数据库。")}
                    </p>
                  </div>
                </div>
                <Badge variant={statusVariant(status?.state)}>{statusLabel(status?.state)}</Badge>
              </CardContent>
            </Card>

            {candidatesQuery.isLoading ? (
              <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 正在解析 NoBrand 节点
              </div>
            ) : scanDone && status?.installed && candidates.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex min-h-28 items-center justify-center text-center text-sm text-muted-foreground">
                  已发现 NoBrand，但没有可展示的 Mieru / Snell / Hysteria2 / VLESS Sudoku 节点。
                </CardContent>
              </Card>
            ) : candidates.length > 0 ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">发现 {candidates.length} 个候选节点</p>
                    <p className="text-xs text-muted-foreground">只显示连接参数摘要，不在这里回显密码或密钥。</p>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={selectAllSupported} disabled={supportedCandidates.length === 0}>
                    全选可导入节点
                  </Button>
                </div>

                {candidates.map((candidate) => {
                  const id = String(candidate.candidateId || "");
                  const supported = candidate.supported === true && !!candidate.protocol;
                  return (
                    <Card key={id} className={!supported ? "opacity-70" : undefined}>
                      <CardContent className="flex items-start gap-3 p-4">
                        <Switch
                          checked={supported && selectedIds.has(id)}
                          disabled={!supported}
                          onCheckedChange={(checked) => toggleCandidate(id, checked)}
                          aria-label={`选择 ${candidate.name}`}
                        />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-medium">{candidate.name}</p>
                            <Badge variant={supported ? "secondary" : "outline"}>{protocolLabel(candidate.sourceKind || candidate.protocol)}</Badge>
                            {!supported ? <Badge variant="destructive">暂不支持</Badge> : null}
                          </div>
                          <p className="break-all font-mono text-xs text-muted-foreground">
                            {candidate.publicHost}:{candidate.publicPort}
                          </p>
                          {!supported && candidate.unsupportedReason ? (
                            <p className="text-xs leading-5 text-muted-foreground">{candidate.unsupportedReason}</p>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : null}
          </div>

          <DialogFooter className="border-t px-5 py-4">
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">已选择 {selectedIds.size} 个；导入后在本页正常分配用户，即可进入统一订阅。</p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>关闭</Button>
                <Button type="button" onClick={importSelected} disabled={selectedIds.size === 0 || importMutation.isPending}>
                  {importMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                  导入 ForwardX
                </Button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
