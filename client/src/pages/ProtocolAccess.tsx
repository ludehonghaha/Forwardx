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
  MIERU_HANDSHAKE_MODES,
  MIERU_MULTIPLEXING_LEVELS,
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
  autoPort: boolean;
  cipher: string;
  password: string;
  udp: boolean;
  remotePort: string;
  sshUsername: string;
  sshPrivateKey: string;
  mieruUsername: string;
  mieruTransport: "TCP" | "UDP";
  mieruMtu: string;
  mieruMultiplexing: string;
  mieruHandshakeMode: string;
  mieruTrafficPattern: string;
  sortOrder: string;
  isEnabled: boolean;
  sourceConfig: Record<string, unknown>;
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
  autoPort: true,
  cipher: "chacha20-ietf-poly1305",
  password: "",
  udp: false,
  remotePort: "",
  sshUsername: "tunnel",
  sshPrivateKey: "",
  mieruUsername: "",
  mieruTransport: "TCP",
  mieruMtu: "1400",
  mieruMultiplexing: "MULTIPLEXING_OFF",
  mieruHandshakeMode: "HANDSHAKE_NO_WAIT",
  mieruTrafficPattern: "",
  sortOrder: "0",
  isEnabled: false,
  sourceConfig: {},
};

const cipherOptions = [
  "chacha20-ietf-poly1305",
  "aes-256-gcm",
  "aes-128-gcm",
  "2022-blake3-aes-256-gcm",
] as const;

function protocolLabel(protocol?: string) {
  if (protocol === "shadowsocks_ssh") return "SS over SSH";
  if (protocol === "mieru") return "Mieru";
  if (protocol === "snell") return "Snell";
  if (protocol === "vless_reality") return "VLESS + Reality";
  if (protocol === "hysteria2") return "Hysteria2";
  return "Shadowsocks";
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

function runtimeBadgeVariant(state?: string): "default" | "secondary" | "destructive" | "outline" {
  if (state === "healthy") return "default";
  if (state === "unhealthy" || state === "offline") return "destructive";
  if (state === "pending" || state === "unsupported" || state === "unknown") return "secondary";
  return "outline";
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
    protocol: (["shadowsocks", "shadowsocks_ssh", "mieru", "snell", "vless_reality", "hysteria2"] as string[]).includes(String(endpoint.protocol))
      ? endpoint.protocol as ProtocolAccessProtocol
      : "shadowsocks",
    runtimeMode: endpoint.runtimeMode === "managed" ? "managed" : "external",
    hostId: endpoint.hostId ? String(endpoint.hostId) : "",
    listenPort: config.listenPort ? String(config.listenPort) : String(endpoint.publicPort || ""),
    forwardRuleId: endpoint.forwardRuleId ? String(endpoint.forwardRuleId) : "",
    publicHost: String(endpoint.publicHost || ""),
    publicPort: String(endpoint.publicPort || ""),
    autoPort: false,
    cipher: String(config.cipher || "chacha20-ietf-poly1305"),
    password: typeof config.password === "string" ? config.password : "",
    udp: config.udp === true,
    remotePort: config.remotePort ? String(config.remotePort) : "",
    sshUsername: String(config.sshUsername || "tunnel"),
    sshPrivateKey: typeof config.sshPrivateKey === "string" ? config.sshPrivateKey : "",
    mieruUsername: String(config.username || ""),
    mieruTransport: config.transport === "UDP" ? "UDP" : "TCP",
    mieruMtu: String(config.mtu || 1400),
    mieruMultiplexing: String(config.multiplexing || "MULTIPLEXING_OFF"),
    mieruHandshakeMode: String(config.handshakeMode || "HANDSHAKE_NO_WAIT"),
    mieruTrafficPattern: typeof config.trafficPattern === "string" ? config.trafficPattern : "",
    sortOrder: String(endpoint.sortOrder || 0),
    isEnabled: endpoint.isEnabled === true,
    sourceConfig: config,
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
  const [assignmentUsername, setAssignmentUsername] = useState("");
  const [assignmentPassword, setAssignmentPassword] = useState("");
  const [assignmentEnabled, setAssignmentEnabled] = useState(true);
  const [feedUserId, setFeedUserId] = useState(0);
  const [feedUserSelect, setFeedUserSelect] = useState("");

  const endpointsQuery = trpc.protocolAccess.listEndpoints.useQuery(undefined, {
    enabled: isAdmin,
    placeholderData: (previousData: any) => previousData,
    refetchInterval: isAdmin ? 10_000 : false,
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
      setAssignmentUsername("");
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
    setAssignmentUsername("");
    setAssignmentPassword("");
    setAssignmentEnabled(true);
  };

  const saveEndpoint = () => {
    const autoManagedPort = endpointForm.runtimeMode === "managed" && !endpointForm.id && endpointForm.autoPort;
    const publicPort = Number(endpointForm.publicPort);
    const listenPort = Number(endpointForm.listenPort || endpointForm.publicPort);
    const remotePort = Number(endpointForm.remotePort);
    if (!endpointForm.name.trim() || !endpointForm.publicHost.trim()) {
      toast.error("请填写名称和公网地址");
      return;
    }
    if (!autoManagedPort && (!Number.isInteger(publicPort) || publicPort < 1 || publicPort > 65535)) {
      toast.error("公网端口必须是 1-65535");
      return;
    }
    if (endpointForm.runtimeMode === "managed") {
      if (!Number(endpointForm.hostId)) {
        toast.error("请选择 Agent 主机");
        return;
      }
      if (!autoManagedPort && (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535)) {
        toast.error("Agent 监听端口必须是 1-65535");
        return;
      }
      if (autoManagedPort && Number(endpointForm.forwardRuleId)) {
        toast.error("自动分配端口不能同时关联现有 ForwardX 规则");
        return;
      }
      if (endpointForm.protocol === "shadowsocks" && !endpointForm.password) {
        toast.error("Agent 托管 Shadowsocks 必须设置共享密码");
        return;
      }
      if (endpointForm.protocol === "mieru" && (!endpointForm.password || !endpointForm.mieruUsername.trim())) {
        toast.error("托管 Mieru 必须设置共享用户名和密码");
        return;
      }
    }
    if (endpointForm.protocol === "mieru") {
      const mtu = Number(endpointForm.mieruMtu);
      if (!Number.isInteger(mtu) || mtu < 1280 || mtu > 1400) {
        toast.error("Mieru MTU 必须是 1280-1400");
        return;
      }
      if (!!endpointForm.mieruUsername !== !!endpointForm.password) {
        toast.error("Mieru 默认用户名和密码必须同时填写，或同时留空改为按用户分配");
        return;
      }
    }
    if (endpointForm.protocol === "shadowsocks_ssh" && (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535)) {
      toast.error("SSH 内部 SS 端口必须是 1-65535");
      return;
    }
    const config: Record<string, unknown> = endpointForm.protocol === "mieru" ? {
      username: endpointForm.mieruUsername,
      password: endpointForm.password,
      transport: endpointForm.mieruTransport,
      mtu: Number(endpointForm.mieruMtu),
      multiplexing: endpointForm.mieruMultiplexing,
      handshakeMode: endpointForm.mieruHandshakeMode,
      trafficPattern: endpointForm.mieruTrafficPattern.trim(),
      udp: endpointForm.udp,
    } : endpointForm.protocol === "snell" || endpointForm.protocol === "vless_reality" || endpointForm.protocol === "hysteria2" ? {
      ...endpointForm.sourceConfig,
      ...(endpointForm.protocol !== "vless_reality" ? { password: endpointForm.password } : {}),
      ...(endpointForm.protocol !== "hysteria2" ? { udp: endpointForm.udp } : {}),
    } : {
      cipher: endpointForm.cipher,
      password: endpointForm.password,
      udp: endpointForm.protocol === "shadowsocks" && endpointForm.udp,
    };
    if (endpointForm.runtimeMode === "managed" && !autoManagedPort) config.listenPort = listenPort;
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
      publicPort: autoManagedPort ? undefined : publicPort,
      autoPort: autoManagedPort,
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
      credential: assignmentEndpoint.protocol === "mieru"
        ? (assignmentUsername || assignmentPassword ? { username: assignmentUsername.trim(), password: assignmentPassword } : {})
        : (assignmentPassword ? { password: assignmentPassword } : {}),
      isEnabled: assignmentEnabled,
    });
  };

  const editAssignment = (assignment: any) => {
    const credential = parseProtocolAccessConfig(assignment.access?.credentialJson);
    setAssignmentUserId(String(assignment.user?.id || assignment.access?.userId || ""));
    setAssignmentUsername(typeof credential.username === "string" ? credential.username : "");
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
        label="通用 URI 订阅"
        description="包含 SS、Mieru、VLESS Reality 和 Hysteria2；Snell 与 SS over SSH 仅进入 Mihomo 订阅。"
        value={fullFeedUrl(feedQuery.data.uriPath)}
      />
      <FeedLink
        label="Mihomo / OpenClash 订阅"
        description="适用于 OpenClash、Clash Meta，可包含 SS、Mieru、Snell、VLESS Reality、Hysteria2 与 SS over SSH。"
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
                <p className="text-xs text-muted-foreground">external 只登记；managed 复用 Agent desired-state。SS 合并 GOST；Mieru 独立 mita；Snell / Reality / Hysteria2 每台主机共用一个 Mihomo。</p>
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
                    <p className="text-sm text-muted-foreground">可登记现有服务，或让 ForwardX Agent 一键托管 SS / Mieru / Snell / VLESS Reality / Hysteria2。</p>
                  </div>
                  <Button variant="outline" onClick={openCreateEndpoint}><Plus className="mr-2 h-4 w-4" /> 新增端点</Button>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {endpoints.map((endpoint) => {
                  const config = parseProtocolAccessConfig(endpoint.configJson);
                  const runtimeStatus = endpoint.runtimeStatus;
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
                          {endpoint.runtimeMode === "managed" && (
                            <Badge variant={runtimeBadgeVariant(runtimeStatus?.state)}>{String(runtimeStatus?.label || "等待状态")}</Badge>
                          )}
                        </div>
                        <div className="grid gap-2 rounded-lg bg-muted/30 p-3 text-sm sm:grid-cols-2">
                          {endpoint.protocol === "mieru" ? (
                            <>
                              <div><span className="text-muted-foreground">传输：</span>{String(config.transport || "-")}</div>
                              <div><span className="text-muted-foreground">凭据：</span>{config.username && config.password ? "默认凭据" : "按用户分配"}</div>
                              <div><span className="text-muted-foreground">MTU：</span>{String(config.mtu || 1400)}</div>
                              <div><span className="text-muted-foreground">多路复用：</span>{String(config.multiplexing || "-").replace("MULTIPLEXING_", "")}</div>
                            </>
                          ) : (
                            <>
                              <div><span className="text-muted-foreground">加密：</span>{String(config.cipher || "-")}</div>
                              <div><span className="text-muted-foreground">密码：</span>{config.password ? "共享密码" : "按用户分配"}</div>
                            </>
                          )}
                          {endpoint.runtimeMode === "managed" && (
                            <>
                              <div><span className="text-muted-foreground">Agent：</span>{String(hostById.get(Number(endpoint.hostId))?.name || `#${endpoint.hostId}`)}</div>
                              <div><span className="text-muted-foreground">监听：</span>{String(config.listenPort || endpoint.publicPort)}</div>
                              <div className="sm:col-span-2">
                                <span className="text-muted-foreground">运行态：</span>
                                <span className={runtimeStatus?.lastError ? "text-destructive" : ""}>{String(runtimeStatus?.message || "等待 Agent 状态")}</span>
                              </div>
                              {runtimeStatus?.lastError && (
                                <div className="text-destructive sm:col-span-2">
                                  <span className="font-medium">最后错误：</span>{String(runtimeStatus.lastError)}
                                </div>
                              )}
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
            <DialogDescription>SS 复用 GOST；Mieru 使用独立 mita；Snell / VLESS Reality / Hysteria2 在同一主机共用一个 forwardx-mihomo，避免重复运行时。</DialogDescription>
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
                      protocol: endpointForm.protocol === "shadowsocks_ssh" ? "shadowsocks" : endpointForm.protocol,
                    } : {
                      protocol: (["snell", "vless_reality", "hysteria2"] as string[]).includes(endpointForm.protocol) ? "shadowsocks" : endpointForm.protocol,
                    }),
                    ...(runtimeMode === "managed" ? {
                      cipher: (MANAGED_SHADOWSOCKS_CIPHERS as readonly string[]).includes(endpointForm.cipher)
                        ? endpointForm.cipher
                        : MANAGED_SHADOWSOCKS_CIPHERS[0],
                      listenPort: endpointForm.listenPort || endpointForm.publicPort,
                      autoPort: !endpointForm.id,
                    } : { autoPort: false }),
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
                <Select
                  value={endpointForm.protocol}
                  onValueChange={(value) => {
                    const protocol = value as ProtocolAccessProtocol;
                    const changesRuntimeFamily = protocol !== endpointForm.protocol;
                    setEndpointForm({
                      ...endpointForm,
                      protocol,
                      ...(changesRuntimeFamily ? {
                        password: "",
                        sourceConfig: {},
                        udp: ["mieru", "snell", "vless_reality"].includes(protocol),
                      } : {}),
                    });
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="shadowsocks">Shadowsocks</SelectItem>
                    {endpointForm.runtimeMode !== "managed" && <SelectItem value="shadowsocks_ssh">SS over SSH</SelectItem>}
                    <SelectItem value="mieru">Mieru</SelectItem>
                    {endpointForm.runtimeMode === "managed" && <SelectItem value="snell">Snell</SelectItem>}
                    {endpointForm.runtimeMode === "managed" && <SelectItem value="vless_reality">VLESS + Reality</SelectItem>}
                    {endpointForm.runtimeMode === "managed" && <SelectItem value="hysteria2">Hysteria2</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
              {(endpointForm.protocol === "shadowsocks" || endpointForm.protocol === "shadowsocks_ssh") && <div className="space-y-2">
                <Label>加密方式</Label>
                <Select value={endpointForm.cipher} onValueChange={(cipher) => setEndpointForm({ ...endpointForm, cipher })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {cipherOptions
                      .filter((cipher) => endpointForm.runtimeMode !== "managed" || (MANAGED_SHADOWSOCKS_CIPHERS as readonly string[]).includes(cipher))
                      .map((cipher) => <SelectItem key={cipher} value={cipher}>{cipher}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>}
              <div className="space-y-2">
                <Label>公网域名或 IP</Label>
                <Input value={endpointForm.publicHost} onChange={(event) => setEndpointForm({ ...endpointForm, publicHost: event.target.value })} placeholder="211.136.162.184" />
              </div>
              {!(endpointForm.runtimeMode === "managed" && !endpointForm.id && endpointForm.autoPort) && (
                <div className="space-y-2">
                  <Label>{endpointForm.protocol === "shadowsocks_ssh" ? "SSH 公网端口" : `${protocolLabel(endpointForm.protocol)} 公网端口`}</Label>
                  <Input type="number" min={1} max={65535} value={endpointForm.publicPort} onChange={(event) => setEndpointForm({ ...endpointForm, publicPort: event.target.value })} />
                </div>
              )}
              {endpointForm.runtimeMode === "managed" && (
                <>
                  {!endpointForm.id && (
                    <div className="flex items-center justify-between gap-3 rounded-lg border p-3 sm:col-span-2">
                      <div>
                        <p className="text-sm font-medium">自动分配端口（推荐）</p>
                        <p className="text-xs leading-5 text-muted-foreground">保存时由服务端按主机端口策略自动预约空闲端口，并避开现有转发、协议端点和 Agent 已上报监听；公网端口与 Agent 监听端口保持一致。</p>
                      </div>
                      <Switch checked={endpointForm.autoPort} onCheckedChange={(autoPort) => setEndpointForm({ ...endpointForm, autoPort })} />
                    </div>
                  )}
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
                  {(!endpointForm.autoPort || !!endpointForm.id) && (
                    <div className="space-y-2">
                      <Label>Agent 监听端口</Label>
                      <Input type="number" min={1} max={65535} value={endpointForm.listenPort} onChange={(event) => setEndpointForm({ ...endpointForm, listenPort: event.target.value })} />
                    </div>
                  )}
                  {(!endpointForm.autoPort || !!endpointForm.id) && (
                    <div className="space-y-2 sm:col-span-2">
                      <Label>关联 ForwardX 规则 ID（可选）</Label>
                      <Input type="number" min={1} value={endpointForm.forwardRuleId} onChange={(event) => setEndpointForm({ ...endpointForm, forwardRuleId: event.target.value })} placeholder="公网入口经过现有链路时填写" />
                      <p className="text-xs text-muted-foreground">填写后只引用现有转发规则，不会再编译一条重复链路；规则源端口需等于公网端口，目标端口需等于 Agent 监听端口。</p>
                    </div>
                  )}
                </>
              )}
              {endpointForm.protocol === "mieru" ? (
                <>
                  <div className="space-y-2">
                    <Label>共享 Mieru 用户名{endpointForm.runtimeMode === "managed" ? "" : "（可选）"}</Label>
                    <Input value={endpointForm.mieruUsername} onChange={(event) => setEndpointForm({ ...endpointForm, mieruUsername: event.target.value })} autoComplete="off" />
                  </div>
                  <div className="space-y-2">
                    <Label>共享 Mieru 密码{endpointForm.runtimeMode === "managed" ? "" : "（可选）"}</Label>
                    <Input type="password" value={endpointForm.password} onChange={(event) => setEndpointForm({ ...endpointForm, password: event.target.value })} autoComplete="new-password" />
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">{endpointForm.runtimeMode === "managed" ? "单一 mita 实例只编译这一份共享凭据；用户分配只控制订阅权限。" : "默认凭据必须成对填写；同时留空时，在“用户分配”中为每个用户设置独立凭据。"}</p>
                </>
              ) : endpointForm.protocol === "vless_reality" ? (
                <div className="rounded-lg border p-3 text-xs leading-5 text-muted-foreground sm:col-span-2">
                  托管 Reality 会自动生成 UUID、X25519 密钥和 Short ID；默认伪装目标为 www.cloudflare.com:443。保存后订阅自动包含客户端公钥参数。
                </div>
              ) : (
                <div className="space-y-2 sm:col-span-2">
                  <Label>{endpointForm.protocol === "snell" ? "共享 Snell PSK" : endpointForm.protocol === "hysteria2" ? "共享 Hysteria2 密码" : "共享 SS 密码"}{endpointForm.runtimeMode === "managed" && (endpointForm.protocol === "snell" || endpointForm.protocol === "hysteria2") ? "（留空自动生成）" : endpointForm.runtimeMode === "managed" ? "" : "（可选）"}</Label>
                  <Input type="password" value={endpointForm.password} onChange={(event) => setEndpointForm({ ...endpointForm, password: event.target.value })} autoComplete="new-password" />
                  <p className="text-xs text-muted-foreground">
                    {endpointForm.runtimeMode === "managed" ? "托管运行时只保存这一份共享凭据；用户分配只控制订阅权限。" : "留空时必须在“用户分配”中为每个用户填写独立密码。"}
                  </p>
                </div>
              )}
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
              ) : endpointForm.protocol === "mieru" ? (
                <>
                  <div className="space-y-2">
                    <Label>传输协议</Label>
                    <Select value={endpointForm.mieruTransport} onValueChange={(mieruTransport) => setEndpointForm({ ...endpointForm, mieruTransport: mieruTransport as "TCP" | "UDP" })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="TCP">TCP</SelectItem><SelectItem value="UDP">UDP</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>MTU</Label>
                    <Input type="number" min={1280} max={1400} value={endpointForm.mieruMtu} onChange={(event) => setEndpointForm({ ...endpointForm, mieruMtu: event.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>多路复用</Label>
                    <Select value={endpointForm.mieruMultiplexing} onValueChange={(mieruMultiplexing) => setEndpointForm({ ...endpointForm, mieruMultiplexing })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{MIERU_MULTIPLEXING_LEVELS.map((value) => <SelectItem key={value} value={value}>{value.replace("MULTIPLEXING_", "")}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>握手模式</Label>
                    <Select value={endpointForm.mieruHandshakeMode} onValueChange={(mieruHandshakeMode) => setEndpointForm({ ...endpointForm, mieruHandshakeMode })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{MIERU_HANDSHAKE_MODES.map((value) => <SelectItem key={value} value={value}>{value.replace("HANDSHAKE_", "")}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label>Traffic Pattern（可选）</Label>
                    <Textarea className="min-h-20 font-mono text-xs" value={endpointForm.mieruTrafficPattern} onChange={(event) => setEndpointForm({ ...endpointForm, mieruTrafficPattern: event.target.value })} placeholder="Mieru 导出的 Base64 protobuf" />
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-lg border p-3 sm:col-span-2">
                    <div><p className="text-sm font-medium">允许客户端 UDP</p><p className="text-xs text-muted-foreground">写入 Mihomo 节点的 udp 字段，不会创建额外监听。</p></div>
                    <Switch checked={endpointForm.udp} onCheckedChange={(udp) => setEndpointForm({ ...endpointForm, udp })} />
                  </div>
                </>
              ) : endpointForm.protocol === "hysteria2" ? (
                <div className="rounded-lg border p-3 text-xs leading-5 text-muted-foreground sm:col-span-2">Hysteria2 固定使用 UDP/QUIC；托管模式自动生成自签证书并默认启用 Salamander 混淆。</div>
              ) : (
                <div className="flex items-center justify-between gap-3 rounded-lg border p-3 sm:col-span-2">
                  <div>
                    <p className="text-sm font-medium">UDP</p>
                    <p className="text-xs text-muted-foreground">
                      {endpointForm.protocol === "snell" ? "使用 Snell UDP over TCP。" : endpointForm.protocol === "vless_reality" ? "允许客户端通过 VLESS/XUDP 传递 UDP。" : endpointForm.runtimeMode === "managed" ? "在同一 GOST 配置中追加独立 SSU 监听。" : "仅在现有 SS 服务确实支持时开启。"}
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
            <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
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
              {assignmentEndpoint?.protocol === "mieru" && (
                <div className="space-y-2">
                  <Label>独立 Mieru 用户名（可选）</Label>
                  <Input disabled={assignmentEndpoint?.runtimeMode === "managed"} value={assignmentUsername} onChange={(event) => setAssignmentUsername(event.target.value)} autoComplete="off" />
                </div>
              )}
              <div className="space-y-2">
                <Label>{assignmentEndpoint?.protocol === "mieru" ? "独立 Mieru 密码（可选）" : "独立 SS 密码（可选）"}</Label>
                <Input disabled={assignmentEndpoint?.runtimeMode === "managed"} type="password" value={assignmentPassword} onChange={(event) => setAssignmentPassword(event.target.value)} autoComplete="new-password" />
                {assignmentEndpoint?.runtimeMode === "managed" && <p className="text-xs text-muted-foreground">托管端点固定使用共享用户名和密码，用户分配只控制订阅权限。</p>}
              </div>
              <Button onClick={saveAssignment} disabled={!assignmentUserId || setAssignment.isPending}>
                <UserPlus className="mr-2 h-4 w-4" /> 保存分配
              </Button>
              <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
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
                        {assignment.user?.accountEnabled ? "账户正常" : "账户停用"} · {parseProtocolAccessConfig(assignment.access.credentialJson).password ? "独立凭据" : "默认凭据"}
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
