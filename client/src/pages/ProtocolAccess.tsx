import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import DataSectionLoading from "@/components/DataSectionLoading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { copyTextToClipboard } from "@/lib/clipboard";
import { trpc } from "@/lib/trpc";
import {
  MANAGED_SHADOWSOCKS_CIPHERS,
  parseProtocolAccessConfig,
  type ProtocolAccessProtocol,
  type ProtocolAccessRuntimeMode,
} from "@shared/protocolAccess";
import {
  Check,
  Copy,
  KeyRound,
  Link2,
  Pencil,
  Plus,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type EndpointForm = {
  id?: number;
  name: string;
  protocol: ProtocolAccessProtocol;
  runtimeMode: ProtocolAccessRuntimeMode;
  hostId: string;
  listenPort: string;
  forwardRuleId: string;
  publicHost: string;
  publicPort: string;
  cipher: string;
  password: string;
  udp: boolean;
  remotePort: string;
  sshUsername: string;
  sshPrivateKey: string;
  sortOrder: string;
  isEnabled: boolean;
};

const emptyEndpointForm: EndpointForm = {
  name: "",
  protocol: "shadowsocks",
  runtimeMode: "external",
  hostId: "",
  listenPort: "",
  forwardRuleId: "",
  publicHost: "",
  publicPort: "",
  cipher: "chacha20-ietf-poly1305",
  password: "",
  udp: false,
  remotePort: "",
  sshUsername: "tunnel",
  sshPrivateKey: "",
  sortOrder: "0",
  isEnabled: false,
};

const cipherOptions = [
  "chacha20-ietf-poly1305",
  "aes-256-gcm",
  "aes-128-gcm",
  "2022-blake3-aes-256-gcm",
] as const;

function protocolLabel(protocol?: string) {
  return protocol === "shadowsocks_ssh" ? "SS over SSH" : "Shadowsocks";
}

function userLabel(user: any) {
  const name = String(user?.name || "").trim();
  const username = String(user?.username || "").trim();
  return name && name !== username ? `${name}（${username}）` : username || `用户 #${user?.id}`;
}

function endpointAddress(endpoint: any) {
  const host = String(endpoint?.publicHost || "");
  return `${host.includes(":") ? `[${host}]` : host}:${Number(endpoint?.publicPort || 0)}`;
}

function fullFeedUrl(path?: string) {
  const value = String(path || "");
  if (!value || typeof window === "undefined") return value;
  return new URL(value, window.location.origin).toString();
}

function endpointFormFromRow(endpoint: any): EndpointForm {
  const config = parseProtocolAccessConfig(endpoint?.configJson);
  return {
    id: Number(endpoint.id),
    name: String(endpoint.name || ""),
    protocol: endpoint.protocol === "shadowsocks_ssh" ? "shadowsocks_ssh" : "shadowsocks",
    runtimeMode: endpoint.runtimeMode === "managed" ? "managed" : "external",
    hostId: endpoint.hostId ? String(endpoint.hostId) : "",
    listenPort: config.listenPort ? String(config.listenPort) : String(endpoint.publicPort || ""),
    forwardRuleId: endpoint.forwardRuleId ? String(endpoint.forwardRuleId) : "",
    publicHost: String(endpoint.publicHost || ""),
    publicPort: String(endpoint.publicPort || ""),
    cipher: String(config.cipher || "chacha20-ietf-poly1305"),
    password: typeof config.password === "string" ? config.password : "",
    udp: config.udp === true,
    remotePort: config.remotePort ? String(config.remotePort) : "",
    sshUsername: String(config.sshUsername || "tunnel"),
    sshPrivateKey: typeof config.sshPrivateKey === "string" ? config.sshPrivateKey : "",
    sortOrder: String(endpoint.sortOrder || 0),
    isEnabled: endpoint.isEnabled === true,
  };
}

function FeedLink({ label, description, value }: { label: string; description: string; value: string }) {
  const copy = async () => {
    const copied = await copyTextToClipboard(value);
    copied ? toast.success(`${label}已复制`) : toast.error("复制失败，请手动选择地址");
  };
  return (
    <div className="space-y-2 rounded-lg border border-border/60 p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
        <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={copy} aria-label={`复制${label}`}>
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export default function ProtocolAccessPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const utils = trpc.useUtils();
  const confirmDialog = useConfirmDialog();
  const [endpointEditorOpen, setEndpointEditorOpen] = useState(false);
  const [endpointForm, setEndpointForm] = useState<EndpointForm>(emptyEndpointForm);
  const [assignmentEndpoint, setAssignmentEndpoint] = useState<any | null>(null);
  const [assignmentUserId, setAssignmentUserId] = useState("");
  const [assignmentPassword, setAssignmentPassword] = useState("");
  const [assignmentEnabled, setAssignmentEnabled] = useState(true);
  const [feedUserId, setFeedUserId] = useState(0);
  const [feedUserSelect, setFeedUserSelect] = useState("");

  const endpointsQuery = trpc.protocolAccess.listEndpoints.useQuery(undefined, {
    enabled: isAdmin,
    placeholderData: (previousData: any) => previousData,
  });
  const usersQuery = trpc.users.options.useQuery(undefined, {
    enabled: isAdmin,
    staleTime: 30_000,
    placeholderData: (previousData: any) => previousData,
  });
  const hostsQuery = trpc.hosts.options.useQuery(undefined, {
    enabled: isAdmin,
    staleTime: 30_000,
    placeholderData: (previousData: any) => previousData,
  });
  const assignmentsQuery = trpc.protocolAccess.listAssignments.useQuery(
    { endpointId: Number(assignmentEndpoint?.id || 1) },
    { enabled: isAdmin && !!assignmentEndpoint, placeholderData: (previousData: any) => previousData },
  );
  const displayedFeedUserId = isAdmin ? feedUserId : Number(user?.id || 0);
  const feedQuery = trpc.protocolAccess.feedForUser.useQuery(
    { userId: displayedFeedUserId || 1 },
    { enabled: displayedFeedUserId > 0, retry: false },
  );

  const endpoints = (endpointsQuery.data || []) as any[];
  const users = (usersQuery.data || []) as any[];
  const hosts = (hostsQuery.data || []) as any[];
  const assignments = (assignmentsQuery.data || []) as any[];
  const assignedUserIds = useMemo(
    () => new Set(assignments.map((item) => Number(item.user?.id || item.access?.userId))),
    [assignments],
  );
  const selectedFeedUser = users.find((item) => Number(item.id) === feedUserId);
  const hostById = useMemo(() => new Map(hosts.map((item) => [Number(item.id), item])), [hosts]);

  const refreshEndpoints = () => utils.protocolAccess.listEndpoints.invalidate();
  const createEndpoint = trpc.protocolAccess.createEndpoint.useMutation({
    onSuccess: async () => {
      toast.success("协议端点已创建");
      setEndpointEditorOpen(false);
      await refreshEndpoints();
    },
    onError: (error) => toast.error(error.message || "创建失败"),
  });
  const updateEndpoint = trpc.protocolAccess.updateEndpoint.useMutation({
    onSuccess: async () => {
      toast.success("协议端点已保存");
      setEndpointEditorOpen(false);
      await refreshEndpoints();
    },
    onError: (error) => toast.error(error.message || "保存失败"),
  });
  const deleteEndpoint = trpc.protocolAccess.deleteEndpoint.useMutation({
    onSuccess: async () => {
      toast.success("协议端点已删除");
      await refreshEndpoints();
    },
    onError: (error) => toast.error(error.message || "删除失败"),
  });
  const setAssignment = trpc.protocolAccess.setAssignment.useMutation({
    onSuccess: async () => {
      toast.success("用户接入权限已保存");
      setAssignmentUserId("");
      setAssignmentPassword("");
      setAssignmentEnabled(true);
      await utils.protocolAccess.listAssignments.invalidate({ endpointId: Number(assignmentEndpoint?.id || 1) });
    },
    onError: (error) => toast.error(error.message || "保存用户权限失败"),
  });
  const removeAssignment = trpc.protocolAccess.removeAssignment.useMutation({
    onSuccess: async () => {
      toast.success("用户接入权限已移除");
      await utils.protocolAccess.listAssignments.invalidate({ endpointId: Number(assignmentEndpoint?.id || 1) });
    },
    onError: (error) => toast.error(error.message || "移除失败"),
  });
  const rotateFeed = trpc.protocolAccess.rotateFeedToken.useMutation({
    onSuccess: async () => {
      toast.success("订阅地址已轮换，旧地址立即失效");
      await utils.protocolAccess.feedForUser.invalidate({ userId: displayedFeedUserId });
    },
    onError: (error) => toast.error(error.message || "轮换失败"),
  });

  const openCreateEndpoint = () => {
    setEndpointForm({ ...emptyEndpointForm });
    setEndpointEditorOpen(true);
  };
  const openEditEndpoint = (endpoint: any) => {
    setEndpointForm(endpointFormFromRow(endpoint));
    setEndpointEditorOpen(true);
  };
  const openAssignments = (endpoint: any) => {
    setAssignmentEndpoint(endpoint);
    setAssignmentUserId("");
    setAssignmentPassword("");
    setAssignmentEnabled(true);
  };

  const saveEndpoint = () => {
    const publicPort = Number(endpointForm.publicPort);
    const listenPort = Number(endpointForm.listenPort || endpointForm.publicPort);
    const remotePort = Number(endpointForm.remotePort);
    if (!endpointForm.name.trim() || !endpointForm.publicHost.trim()) {
      toast.error("请填写名称和公网地址");
      return;
    }
    if (!Number.isInteger(publicPort) || publicPort < 1 || publicPort > 65535) {
      toast.error("公网端口必须是 1-65535");
      return;
    }
    if (endpointForm.runtimeMode === "managed") {
      if (!Number(endpointForm.hostId)) {
        toast.error("请选择 Agent 主机");
        return;
      }
      if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {
        toast.error("Agent 监听端口必须是 1-65535");
        return;
      }
      if (!endpointForm.password) {
        toast.error("Agent 托管端点必须设置共享 SS 密码");
        return;
      }
    }
    if (endpointForm.protocol === "shadowsocks_ssh" && (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535)) {
      toast.error("SSH 内部 SS 端口必须是 1-65535");
      return;
    }
    const config: Record<string, unknown> = {
      cipher: endpointForm.cipher,
      password: endpointForm.password,
      udp: endpointForm.protocol === "shadowsocks" && endpointForm.udp,
    };
    if (endpointForm.runtimeMode === "managed") config.listenPort = listenPort;
    if (endpointForm.protocol === "shadowsocks_ssh") {
      config.remotePort = remotePort;
      config.sshUsername = endpointForm.sshUsername;
      config.sshPrivateKey = endpointForm.sshPrivateKey;
    }
    const input = {
      name: endpointForm.name.trim(),
      protocol: endpointForm.protocol,
      runtimeMode: endpointForm.runtimeMode,
      hostId: endpointForm.runtimeMode === "managed" ? Number(endpointForm.hostId) : null,
      forwardRuleId: endpointForm.runtimeMode === "managed" && Number(endpointForm.forwardRuleId)
        ? Number(endpointForm.forwardRuleId)
        : null,
      publicHost: endpointForm.publicHost.trim(),
      publicPort,
      config,
      isEnabled: endpointForm.isEnabled,
      sortOrder: Math.max(0, Number.parseInt(endpointForm.sortOrder, 10) || 0),
    };
    endpointForm.id
      ? updateEndpoint.mutate({ id: endpointForm.id, ...input })
      : createEndpoint.mutate(input);
  };

  const toggleEndpoint = (endpoint: any, isEnabled: boolean) => {
    updateEndpoint.mutate({ id: Number(endpoint.id), isEnabled });
  };

  const confirmDeleteEndpoint = async (endpoint: any) => {
    const confirmed = await confirmDialog({
      title: "删除协议端点",
      description: <>将删除“{endpoint.name}”及其全部用户分配；ForwardX 主机、链路和流量记录不会受影响。</>,
      confirmText: "删除端点",
      tone: "destructive",
    });
    if (confirmed) deleteEndpoint.mutate({ id: Number(endpoint.id) });
  };

  const saveAssignment = () => {
    const userId = Number(assignmentUserId);
    if (!assignmentEndpoint || !userId) {
      toast.error("请选择用户");
      return;
    }
    setAssignment.mutate({
      endpointId: Number(assignmentEndpoint.id),
      userId,
      credential: assignmentPassword ? { password: assignmentPassword } : {},
      isEnabled: assignmentEnabled,
    });
  };

  const editAssignment = (assignment: any) => {
    const credential = parseProtocolAccessConfig(assignment.access?.credentialJson);
    setAssignmentUserId(String(assignment.user?.id || assignment.access?.userId || ""));
    setAssignmentPassword(typeof credential.password === "string" ? credential.password : "");
    setAssignmentEnabled(assignment.access?.isEnabled !== false);
  };

  const toggleAssignment = (assignment: any, isEnabled: boolean) => {
    setAssignment.mutate({
      endpointId: Number(assignmentEndpoint.id),
      userId: Number(assignment.user?.id || assignment.access?.userId),
      credential: parseProtocolAccessConfig(assignment.access?.credentialJson),
      isEnabled,
    });
  };

  const confirmRemoveAssignment = async (assignment: any) => {
    const confirmed = await confirmDialog({
      title: "移除用户接入",
      description: <>移除 {userLabel(assignment.user)} 对“{assignmentEndpoint?.name}”的接入权限，不会删除用户账户。</>,
      confirmText: "移除权限",
      tone: "destructive",
    });
    if (confirmed) {
      removeAssignment.mutate({
        endpointId: Number(assignmentEndpoint.id),
        userId: Number(assignment.user?.id || assignment.access?.userId),
      });
    }
  };

  const confirmRotateFeed = async () => {
    if (!displayedFeedUserId) return;
    const confirmed = await confirmDialog({
      title: "轮换订阅地址",
      description: "旧地址会立即失效，已导入的客户端需要重新更新订阅地址。",
      confirmText: "确认轮换",
      tone: "destructive",
    });
    if (confirmed) rotateFeed.mutate({ userId: displayedFeedUserId });
  };

  const feedContent = feedQuery.isLoading ? (
    <DataSectionLoading label="正在生成订阅地址" minHeight="min-h-[150px]" />
  ) : feedQuery.isError ? (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      {feedQuery.error.message || "订阅地址加载失败"}
    </div>
  ) : feedQuery.data ? (
    <div className="space-y-3">
      <FeedLink
        label="通用 SS 订阅"
        description="适用于 Shadowrocket 等支持 SIP002 的客户端；SS over SSH 不会进入此订阅。"
        value={fullFeedUrl(feedQuery.data.uriPath)}
      />
      <FeedLink
        label="Mihomo / OpenClash 订阅"
        description="适用于 OpenClash、Clash Meta，可包含 SS 和 SS over SSH。"
        value={fullFeedUrl(feedQuery.data.mihomoPath)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <p className="text-xs text-muted-foreground">地址长期稳定；仅在泄露时轮换。</p>
        <Button variant="outline" size="sm" onClick={confirmRotateFeed} disabled={rotateFeed.isPending}>
          <RefreshCw className={`mr-2 h-4 w-4 ${rotateFeed.isPending ? "forwardx-icon-spin" : ""}`} />
          轮换地址
        </Button>
      </div>
    </div>
  ) : null;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <RadioTower className="h-6 w-6" /> 协议接入
            </h1>
            <p className="text-sm text-muted-foreground">复用 ForwardX 用户和链路，仅管理协议凭据与客户端订阅。</p>
          </div>
          {isAdmin && (
            <Button onClick={openCreateEndpoint}>
              <Plus className="mr-2 h-4 w-4" /> 新增端点
            </Button>
          )}
        </div>

        <Card className="border-primary/20 bg-primary/[0.03]">
          <CardContent className="flex gap-3 pt-5 text-sm">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="space-y-1">
              <p className="font-medium">单一控制面</p>
              <p className="leading-6 text-muted-foreground">
                主机、转发、多跳、流量和用户状态仍由 ForwardX 原生模块负责；这里不会再次部署面板或重复统计流量。
              </p>
            </div>
          </CardContent>
        </Card>

        {isAdmin ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><Link2 className="h-5 w-5" /> 用户订阅地址</CardTitle>
              <CardDescription>选择现有 ForwardX 用户，查看其统一客户端订阅。</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row">
              <Select value={feedUserSelect} onValueChange={setFeedUserSelect}>
                <SelectTrigger className="sm:max-w-sm"><SelectValue placeholder="选择用户" /></SelectTrigger>
                <SelectContent>
                  {users.map((item) => (
                    <SelectItem key={item.id} value={String(item.id)}>{userLabel(item)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" disabled={!feedUserSelect} onClick={() => setFeedUserId(Number(feedUserSelect))}>
                <KeyRound className="mr-2 h-4 w-4" /> 查看订阅
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg"><KeyRound className="h-5 w-5" /> 我的接入订阅</CardTitle>
              <CardDescription>复制到对应客户端；账号停用或到期后订阅自动失效。</CardDescription>
            </CardHeader>
            <CardContent>{feedContent}</CardContent>
          </Card>
        )}

        {isAdmin && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">协议端点</h2>
                <p className="text-xs text-muted-foreground">external 只登记；managed 复用现有 Agent 与 GOST 原子下发。</p>
              </div>
              <Badge variant="outline">{endpoints.length} 个</Badge>
            </div>
            {endpointsQuery.isLoading ? (
              <DataSectionLoading label="正在加载协议端点" />
            ) : endpoints.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="flex min-h-44 flex-col items-center justify-center gap-3 text-center">
                  <RadioTower className="h-8 w-8 text-muted-foreground" />
                  <div>
                    <p className="font-medium">还没有协议端点</p>
                    <p className="text-sm text-muted-foreground">可登记现有服务，或让 ForwardX Agent 托管标准 Shadowsocks。</p>
                  </div>
                  <Button variant="outline" onClick={openCreateEndpoint}><Plus className="mr-2 h-4 w-4" /> 新增端点</Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {endpoints.map((endpoint) => {
                  const config = parseProtocolAccessConfig(endpoint.configJson);
                  return (
                    <Card key={endpoint.id}>
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <CardTitle className="truncate text-lg">{endpoint.name}</CardTitle>
                            <CardDescription className="font-mono">{endpointAddress(endpoint)}</CardDescription>
                          </div>
                          <Switch
                            checked={endpoint.isEnabled === true}
                            disabled={updateEndpoint.isPending}
                            onCheckedChange={(checked) => toggleEndpoint(endpoint, checked)}
                          />
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="flex flex-wrap gap-2">
                          <Badge>{protocolLabel(endpoint.protocol)}</Badge>
                          <Badge variant="outline">{endpoint.runtimeMode === "managed" ? "Agent 托管" : "external"}</Badge>
                          <Badge variant={endpoint.isEnabled ? "default" : "secondary"}>{endpoint.isEnabled ? "已启用" : "已停用"}</Badge>
                        </div>
                        <div className="grid gap-2 rounded-lg bg-muted/30 p-3 text-sm sm:grid-cols-2">
                          <div><span className="text-muted-foreground">加密：</span>{String(config.cipher || "-")}</div>
                          <div><span className="text-muted-foreground">密码：</span>{config.password ? "共享密码" : "按用户分配"}</div>
                          {endpoint.runtimeMode === "managed" && (
                            <>
                              <div><span className="text-muted-foreground">Agent：</span>{String(hostById.get(Number(endpoint.hostId))?.name || `#${endpoint.hostId}`)}</div>
                              <div><span className="text-muted-foreground">监听：</span>{String(config.listenPort || endpoint.publicPort)}</div>
                            </>
                          )}
                          {endpoint.protocol === "shadowsocks_ssh" && (
                            <>
                              <div><span className="text-muted-foreground">SSH 用户：</span>{String(config.sshUsername || "-")}</div>
                              <div><span className="text-muted-foreground">内部端口：</span>{String(config.remotePort || "-")}</div>
                            </>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" size="sm" onClick={() => openAssignments(endpoint)}>
                            <Users className="mr-2 h-4 w-4" /> 用户分配
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => openEditEndpoint(endpoint)}>
                            <Pencil className="mr-2 h-4 w-4" /> 编辑
                          </Button>
                          <Button variant="outline" size="sm" className="text-destructive" onClick={() => void confirmDeleteEndpoint(endpoint)}>
                            <Trash2 className="mr-2 h-4 w-4" /> 删除
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <Dialog open={endpointEditorOpen} onOpenChange={setEndpointEditorOpen}>
        <DialogContent className="flex max-h-[92svh] w-[calc(100vw-1rem)] max-w-[95vw] flex-col overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="px-4 pt-4 sm:px-5 sm:pt-5">
            <DialogTitle>{endpointForm.id ? "编辑协议端点" : "新增协议端点"}</DialogTitle>
            <DialogDescription>托管模式直接合并进 ForwardX 现有 GOST desired-state，不创建第二套运行时。</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4 sm:px-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>端点名称</Label>
                <Input value={endpointForm.name} onChange={(event) => setEndpointForm({ ...endpointForm, name: event.target.value })} placeholder="例如：7CM SS" />
              </div>
              <div className="space-y-2">
                <Label>运行模式</Label>
                <Select
                  value={endpointForm.runtimeMode}
                  onValueChange={(runtimeMode) => setEndpointForm({
                    ...endpointForm,
                    runtimeMode: runtimeMode as ProtocolAccessRuntimeMode,
                    ...(runtimeMode === "managed" ? {
                      protocol: "shadowsocks",
                      cipher: (MANAGED_SHADOWSOCKS_CIPHERS as readonly string[]).includes(endpointForm.cipher)
                        ? endpointForm.cipher
                        : MANAGED_SHADOWSOCKS_CIPHERS[0],
                      listenPort: endpointForm.listenPort || endpointForm.publicPort,
                    } : {}),
                  })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="external">登记现有服务</SelectItem>
                    <SelectItem value="managed">ForwardX Agent 托管</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>协议</Label>
                <Select disabled={endpointForm.runtimeMode === "managed"} value={endpointForm.protocol} onValueChange={(protocol) => setEndpointForm({ ...endpointForm, protocol: protocol as ProtocolAccessProtocol })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="shadowsocks">Shadowsocks</SelectItem>
                    <SelectItem value="shadowsocks_ssh">SS over SSH</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>加密方式</Label>
                <Select value={endpointForm.cipher} onValueChange={(cipher) => setEndpointForm({ ...endpointForm, cipher })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {cipherOptions
                      .filter((cipher) => endpointForm.runtimeMode !== "managed" || (MANAGED_SHADOWSOCKS_CIPHERS as readonly string[]).includes(cipher))
                      .map((cipher) => <SelectItem key={cipher} value={cipher}>{cipher}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>公网域名或 IP</Label>
                <Input value={endpointForm.publicHost} onChange={(event) => setEndpointForm({ ...endpointForm, publicHost: event.target.value })} placeholder="211.136.162.184" />
              </div>
              <div className="space-y-2">
                <Label>{endpointForm.protocol === "shadowsocks_ssh" ? "SSH 公网端口" : "SS 公网端口"}</Label>
                <Input type="number" min={1} max={65535} value={endpointForm.publicPort} onChange={(event) => setEndpointForm({ ...endpointForm, publicPort: event.target.value })} />
              </div>
              {endpointForm.runtimeMode === "managed" && (
                <>
                  <div className="space-y-2">
                    <Label>Agent 主机</Label>
                    <Select value={endpointForm.hostId} onValueChange={(hostId) => setEndpointForm({ ...endpointForm, hostId })}>
                      <SelectTrigger><SelectValue placeholder="选择主机" /></SelectTrigger>
                      <SelectContent>
                        {hosts.map((host) => (
                          <SelectItem key={host.id} value={String(host.id)}>
                            {host.name || `主机 #${host.id}`}{host.isOnline ? " · 在线" : " · 离线"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Agent 监听端口</Label>
                    <Input type="number" min={1} max={65535} value={endpointForm.listenPort} onChange={(event) => setEndpointForm({ ...endpointForm, listenPort: event.target.value })} />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>关联 ForwardX 规则 ID（可选）</Label>
                    <Input type="number" min={1} value={endpointForm.forwardRuleId} onChange={(event) => setEndpointForm({ ...endpointForm, forwardRuleId: event.target.value })} placeholder="公网入口经过现有链路时填写" />
                    <p className="text-xs text-muted-foreground">填写后只引用现有转发规则，不会再编译一条重复链路；规则源端口需等于公网端口，目标端口需等于 Agent 监听端口。</p>
                  </div>
                </>
              )}
              <div className="space-y-2 sm:col-span-2">
                <Label>共享 SS 密码{endpointForm.runtimeMode === "managed" ? "" : "（可选）"}</Label>
                <Input type="password" value={endpointForm.password} onChange={(event) => setEndpointForm({ ...endpointForm, password: event.target.value })} autoComplete="new-password" />
                <p className="text-xs text-muted-foreground">
                  {endpointForm.runtimeMode === "managed" ? "托管运行时只编译这一份共享密码；用户分配只控制订阅权限。" : "留空时必须在“用户分配”中为每个用户填写独立密码。"}
                </p>
              </div>
              {endpointForm.protocol === "shadowsocks_ssh" ? (
                <>
                  <div className="space-y-2">
                    <Label>SSH 用户名</Label>
                    <Input value={endpointForm.sshUsername} onChange={(event) => setEndpointForm({ ...endpointForm, sshUsername: event.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>SSH 内部 SS 端口</Label>
                    <Input type="number" min={1} max={65535} value={endpointForm.remotePort} onChange={(event) => setEndpointForm({ ...endpointForm, remotePort: event.target.value })} />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>SSH 私钥</Label>
                    <Textarea className="min-h-40 font-mono text-xs" value={endpointForm.sshPrivateKey} onChange={(event) => setEndpointForm({ ...endpointForm, sshPrivateKey: event.target.value })} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
                    <p className="text-xs text-muted-foreground">私钥只进入获授权用户的 Mihomo 订阅，并在配置审计中脱敏。</p>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between gap-3 rounded-lg border p-3 sm:col-span-2">
                  <div>
                    <p className="text-sm font-medium">UDP</p>
                    <p className="text-xs text-muted-foreground">
                      {endpointForm.runtimeMode === "managed" ? "在同一 GOST 配置中追加独立 SSU 监听。" : "仅在现有 SS 服务确实支持时开启。"}
                    </p>
                  </div>
                  <Switch checked={endpointForm.udp} onCheckedChange={(udp) => setEndpointForm({ ...endpointForm, udp })} />
                </div>
              )}
              <div className="space-y-2">
                <Label>排序</Label>
                <Input type="number" min={0} value={endpointForm.sortOrder} onChange={(event) => setEndpointForm({ ...endpointForm, sortOrder: event.target.value })} />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div><p className="text-sm font-medium">端点状态</p><p className="text-xs text-muted-foreground">启用后进入用户订阅。</p></div>
                <Switch checked={endpointForm.isEnabled} onCheckedChange={(isEnabled) => setEndpointForm({ ...endpointForm, isEnabled })} />
              </div>
            </div>
          </div>
          <DialogFooter className="border-t px-4 py-4 sm:px-5">
            <Button variant="outline" onClick={() => setEndpointEditorOpen(false)}>取消</Button>
            <Button onClick={saveEndpoint} disabled={createEndpoint.isPending || updateEndpoint.isPending}>
              {(createEndpoint.isPending || updateEndpoint.isPending) ? <RefreshCw className="forwardx-icon-spin mr-2 h-4 w-4" /> : <Check className="mr-2 h-4 w-4" />}
              保存端点
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!assignmentEndpoint} onOpenChange={(open) => !open && setAssignmentEndpoint(null)}>
        <DialogContent className="flex max-h-[92svh] w-[calc(100vw-1rem)] max-w-[95vw] flex-col overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="px-4 pt-4 sm:px-5 sm:pt-5">
            <DialogTitle>用户分配 · {assignmentEndpoint?.name}</DialogTitle>
            <DialogDescription>复用现有 ForwardX 用户；不创建第二套协议用户。</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-4 sm:px-5">
            <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <div className="space-y-2">
                <Label>用户</Label>
                <Select value={assignmentUserId} onValueChange={setAssignmentUserId}>
                  <SelectTrigger><SelectValue placeholder="选择用户" /></SelectTrigger>
                  <SelectContent>
                    {users.map((item) => (
                      <SelectItem key={item.id} value={String(item.id)}>
                        {userLabel(item)}{assignedUserIds.has(Number(item.id)) ? " · 已分配" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>独立 SS 密码（可选）</Label>
                <Input disabled={assignmentEndpoint?.runtimeMode === "managed"} type="password" value={assignmentPassword} onChange={(event) => setAssignmentPassword(event.target.value)} autoComplete="new-password" />
                {assignmentEndpoint?.runtimeMode === "managed" && <p className="text-xs text-muted-foreground">托管端点固定使用共享密码，避免重复编译用户监听。</p>}
              </div>
              <Button onClick={saveAssignment} disabled={!assignmentUserId || setAssignment.isPending}>
                <UserPlus className="mr-2 h-4 w-4" /> 保存分配
              </Button>
              <div className="flex items-center gap-2 sm:col-span-3">
                <Switch checked={assignmentEnabled} onCheckedChange={setAssignmentEnabled} />
                <span className="text-xs text-muted-foreground">分配后立即启用</span>
              </div>
            </div>

            {assignmentsQuery.isLoading ? (
              <DataSectionLoading label="正在加载用户分配" minHeight="min-h-[140px]" />
            ) : assignments.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">尚未分配用户</div>
            ) : (
              <div className="space-y-2">
                {assignments.map((assignment) => (
                  <div key={assignment.access.id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{userLabel(assignment.user)}</p>
                      <p className="text-xs text-muted-foreground">
                        {assignment.user?.accountEnabled ? "账户正常" : "账户停用"} · {parseProtocolAccessConfig(assignment.access.credentialJson).password ? "独立密码" : "共享密码"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Switch checked={assignment.access.isEnabled !== false} onCheckedChange={(checked) => toggleAssignment(assignment, checked)} />
                      <Button variant="outline" size="sm" onClick={() => { setFeedUserSelect(String(assignment.user.id)); setFeedUserId(Number(assignment.user.id)); }}>
                        <Link2 className="mr-2 h-4 w-4" /> 订阅
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => editAssignment(assignment)}><Pencil className="h-4 w-4" /></Button>
                      <Button variant="outline" size="sm" className="text-destructive" onClick={() => void confirmRemoveAssignment(assignment)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className="border-t px-4 py-4 sm:px-5">
            <Button variant="outline" onClick={() => setAssignmentEndpoint(null)}>关闭</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isAdmin && feedUserId > 0} onOpenChange={(open) => !open && setFeedUserId(0)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>客户端订阅 · {selectedFeedUser ? userLabel(selectedFeedUser) : `用户 #${feedUserId}`}</DialogTitle>
            <DialogDescription>Token 复用同一用户，不会创建另一套订阅账户。</DialogDescription>
          </DialogHeader>
          {feedContent}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
