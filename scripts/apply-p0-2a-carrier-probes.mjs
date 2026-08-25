import fs from "node:fs";

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function write(file, content) {
  fs.writeFileSync(file, content);
}

function replaceOnce(content, search, replacement, label) {
  const index = content.indexOf(search);
  if (index < 0) throw new Error(`Patch anchor not found: ${label}`);
  if (content.indexOf(search, index + search.length) >= 0) throw new Error(`Patch anchor is not unique: ${label}`);
  return content.slice(0, index) + replacement + content.slice(index + search.length);
}

function patchSchema() {
  const file = "drizzle/schema.ts";
  let s = read(file);
  const anchor = `export const hostProbeServices = table("host_probe_services", {\n  id: serial("id"),\n  name: text("name").notNull(),\n  method: varchar("method", { length: 16 }).notNull().default("tcping"),\n  targetIp: text("targetIp").notNull(),\n  targetPort: int("targetPort"),\n  hostScope:`;
  const replacement = `export const hostProbeServices = table("host_probe_services", {\n  id: serial("id"),\n  name: text("name").notNull(),\n  method: varchar("method", { length: 16 }).notNull().default("tcping"),\n  targetIp: text("targetIp").notNull(),\n  targetPort: int("targetPort"),\n  probeKind: varchar("probeKind", { length: 32 }).notNull().default("custom"),\n  carrier: varchar("carrier", { length: 8 }),\n  region: text("region"),\n  hostScope:`;
  s = replaceOnce(s, anchor, replacement, "drizzle host_probe_services metadata");
  write(file, s);
}

function patchDbSchema() {
  const file = "server/dbSchema.ts";
  let s = read(file);
  s = replaceOnce(
    s,
    `c("targetPort", "int"), c("hostScope", "varchar", { length: 16, notNull: true, default: "all" })`,
    `c("targetPort", "int"), c("probeKind", "varchar", { length: 32, notNull: true, default: "custom" }), c("carrier", "varchar", { length: 8 }), c("region", "text"), c("hostScope", "varchar", { length: 16, notNull: true, default: "all" })`,
    "dbSchema host_probe_services metadata",
  );
  s = replaceOnce(
    s,
    `indexes: [["userId", "sortOrder"], ["userId", "createdAt"], ["isEnabled"], ["hostScope"]] },\n  { name: "host_probe_service_stats"`,
    `indexes: [["userId", "sortOrder"], ["userId", "createdAt"], ["isEnabled"], ["hostScope"], ["probeKind", "carrier"], ["carrier", "region"]] },\n  { name: "host_probe_service_stats"`,
    "dbSchema host_probe_services indexes",
  );
  s = replaceOnce(
    s,
    `indexes: [["serviceId", "recordedAt"], ["hostId", "recordedAt"], ["recordedAt", "serviceId"]] },\n  { name: "host_network_quality_stats"`,
    `indexes: [["serviceId", "recordedAt"], ["hostId", "recordedAt"], ["recordedAt", "serviceId"], ["serviceId", "hostId", "recordedAt"]] },\n  { name: "host_network_quality_stats"`,
    "dbSchema host_probe_service_stats pair index",
  );
  write(file, s);
}

function patchProbeRepository() {
  const file = "server/repositories/hostProbeServiceRepository.ts";
  let s = read(file);
  s = replaceOnce(
    s,
    `import { packetLossPermille } from "./hostNetworkQualityRepository";`,
    `import { packetLossPermille } from "./hostNetworkQualityRepository";\nimport { normalizeHostProbeMetadata, type HostProbeCarrier, type HostProbeKind } from "../../shared/hostProbeMetadata";`,
    "probe repository metadata import",
  );
  s = replaceOnce(
    s,
    `  targetPort?: number | null;\n  hostScope: HostProbeScope;`,
    `  targetPort?: number | null;\n  probeKind?: HostProbeKind;\n  carrier?: HostProbeCarrier | null;\n  region?: string | null;\n  hostScope: HostProbeScope;`,
    "probe repository input metadata",
  );
  s = replaceOnce(
    s,
    `  const method = input.method === "ping" ? "ping" : "tcping";\n  const hostScope = input.hostScope === "exclude" || input.hostScope === "specific" ? input.hostScope : "all";\n  const payload = {`,
    `  const method = input.method === "ping" ? "ping" : "tcping";\n  const hostScope = input.hostScope === "exclude" || input.hostScope === "specific" ? input.hostScope : "all";\n  const metadata = normalizeHostProbeMetadata(input);\n  const payload = {`,
    "probe repository normalize metadata",
  );
  s = replaceOnce(
    s,
    `    targetPort: method === "tcping" ? Number(input.targetPort) : null,\n    hostScope,`,
    `    targetPort: method === "tcping" ? Number(input.targetPort) : null,\n    probeKind: metadata.probeKind,\n    carrier: metadata.carrier,\n    region: metadata.region,\n    hostScope,`,
    "probe repository payload metadata",
  );
  s = replaceOnce(
    s,
    `export function mapHostProbeService(row: any) {\n  return {\n    ...row,`,
    `export function mapHostProbeService(row: any) {\n  const metadata = normalizeHostProbeMetadata(row || {});\n  return {\n    ...row,\n    ...metadata,`,
    "probe repository map metadata",
  );
  s = replaceOnce(
    s,
    `export async function updateHostProbeService(id: number, input: Omit<HostProbeServiceInput, "userId">) {\n  const db = await getDb();\n  if (!db) return;\n  const payload = normalizeServiceInput({ ...input, userId: 0 });`,
    `export async function updateHostProbeService(id: number, input: Omit<HostProbeServiceInput, "userId">) {\n  const db = await getDb();\n  if (!db) return;\n  const existing = await getHostProbeServiceById(id);\n  if (!existing) return;\n  const payload = normalizeServiceInput({\n    ...input,\n    userId: 0,\n    probeKind: input.probeKind === undefined ? existing.probeKind : input.probeKind,\n    carrier: input.carrier === undefined ? existing.carrier : input.carrier,\n    region: input.region === undefined ? existing.region : input.region,\n  });`,
    "probe repository preserve metadata on update",
  );
  write(file, s);
}

function patchDbExports() {
  const file = "server/db.ts";
  let s = read(file);
  s = replaceOnce(
    s,
    `export * from "./repositories/hostProbeServiceRepository";\nexport * from "./repositories/hostNetworkQualityRepository";`,
    `export * from "./repositories/hostProbeServiceRepository";\nexport * from "./repositories/chinaCarrierProbeRepository";\nexport * from "./repositories/hostNetworkQualityRepository";`,
    "db export china carrier repository",
  );
  write(file, s);
}

function patchHostsRouter() {
  const file = "server/routers/hosts.ts";
  let s = read(file);
  s = replaceOnce(
    s,
    `import { planAgentUpgradeWaves } from "../agentUpgradeRollout";`,
    `import { planAgentUpgradeWaves } from "../agentUpgradeRollout";\nimport { normalizeHostProbeMetadata } from "../../shared/hostProbeMetadata";`,
    "hosts router metadata import",
  );
  s = replaceOnce(
    s,
    `  targetPort: z.number().int().min(1).max(65535).nullable().optional(),\n  hostScope: z.enum(["all", "exclude", "specific"]).default("all"),`,
    `  targetPort: z.number().int().min(1).max(65535).nullable().optional(),\n  probeKind: z.enum(["custom", "china_carrier"]).optional(),\n  carrier: z.enum(["ct", "cu", "cm"]).nullable().optional(),\n  region: z.string().trim().max(64).nullable().optional(),\n  hostScope: z.enum(["all", "exclude", "specific"]).default("all"),`,
    "hosts router probe input metadata",
  );
  s = replaceOnce(
    s,
    `  if (input.method === "tcping" && !input.targetPort) throw new Error("TCPing 服务需要填写目标端口");\n  const hostIds =`,
    `  if (input.method === "tcping" && !input.targetPort) throw new Error("TCPing 服务需要填写目标端口");\n  const metadata = normalizeHostProbeMetadata(input);\n  const hostIds =`,
    "hosts router normalize metadata",
  );
  s = replaceOnce(
    s,
    `  return {\n    ...input,\n    targetPort: input.method === "tcping" ? Number(input.targetPort) : null,`,
    `  return {\n    ...input,\n    ...metadata,\n    targetPort: input.method === "tcping" ? Number(input.targetPort) : null,`,
    "hosts router normalized return metadata",
  );
  s = replaceOnce(
    s,
    `    probeServices: protectedProcedure.query(async ({ ctx }) => {`,
    `    chinaCarrierProbeOverview: adminProcedure.query(async () => db.getChinaCarrierProbeOverview()),\n    probeServices: protectedProcedure.query(async ({ ctx }) => {`,
    "hosts router china carrier overview",
  );
  write(file, s);
}

function patchManager() {
  const file = "client/src/components/hosts/HostProbeServiceManager.tsx";
  let s = read(file);
  s = replaceOnce(
    s,
    `import { toast } from "sonner";`,
    `import { toast } from "sonner";\nimport { HOST_PROBE_CARRIER_LABELS, type HostProbeCarrier, type HostProbeKind } from "@shared/hostProbeMetadata";`,
    "manager metadata import",
  );
  s = replaceOnce(
    s,
    `  targetPort: string;\n  hostScope:`,
    `  targetPort: string;\n  probeKind: HostProbeKind;\n  carrier: HostProbeCarrier | null;\n  region: string;\n  hostScope:`,
    "manager form metadata fields",
  );
  s = replaceOnce(
    s,
    `  targetPort: "",\n  hostScope: "all",`,
    `  targetPort: "",\n  probeKind: "custom",\n  carrier: null,\n  region: "",\n  hostScope: "all",`,
    "manager default metadata",
  );
  s = replaceOnce(
    s,
    `    targetPort: method === "tcping" ? Number(service?.targetPort || 0) : null,\n    hostScope:`,
    `    targetPort: method === "tcping" ? Number(service?.targetPort || 0) : null,\n    probeKind: service?.probeKind === "china_carrier" ? "china_carrier" : "custom",\n    carrier: service?.probeKind === "china_carrier" ? (service?.carrier || null) : null,\n    region: String(service?.region || "").trim() || null,\n    hostScope:`,
    "manager update payload metadata",
  );
  s = replaceOnce(
    s,
    `  onFilterStatsChange?: (stats: { filtered: number; total: number }) => void;\n};`,
    `  onFilterStatsChange?: (stats: { filtered: number; total: number }) => void;\n  probeKindFilter?: HostProbeKind | "all";\n  defaultProbeKind?: HostProbeKind;\n};`,
    "manager props metadata",
  );
  s = replaceOnce(
    s,
    `  searchQuery = "",\n  onFilterStatsChange,\n}: HostProbeServiceManagerProps) {`,
    `  searchQuery = "",\n  onFilterStatsChange,\n  probeKindFilter = "all",\n  defaultProbeKind = "custom",\n}: HostProbeServiceManagerProps) {`,
    "manager prop defaults",
  );
  s = replaceOnce(
    s,
    `  const { data: services = [], isLoading } = trpc.hosts.probeServices.useQuery(undefined, { refetchInterval: pollingInterval("slow") });\n  const serviceItems = useMemo(() => (services as any[] | undefined) || [], [services]);`,
    `  const { data: services = [], isLoading } = trpc.hosts.probeServices.useQuery(undefined, { refetchInterval: pollingInterval("slow") });\n  const allServiceItems = useMemo(() => (services as any[] | undefined) || [], [services]);\n  const serviceItems = useMemo(\n    () => probeKindFilter === "all"\n      ? allServiceItems\n      : allServiceItems.filter((service) => (service?.probeKind === "china_carrier" ? "china_carrier" : "custom") === probeKindFilter),\n    [allServiceItems, probeKindFilter],\n  );`,
    "manager kind filter",
  );
  s = replaceOnce(
    s,
    `    onSuccess: () => { utils.hosts.probeServices.invalidate(); setDialogOpen(false); setForm(defaultForm); toast.success("服务已添加"); },`,
    `    onSuccess: () => { utils.hosts.probeServices.invalidate(); utils.hosts.chinaCarrierProbeOverview.invalidate(); setDialogOpen(false); setForm({ ...defaultForm, probeKind: defaultProbeKind }); toast.success("服务已添加"); },`,
    "manager create invalidate carrier",
  );
  s = replaceOnce(
    s,
    `    onSuccess: () => { utils.hosts.probeServices.invalidate(); setDialogOpen(false); setEditingId(null); setForm(defaultForm); toast.success("服务已更新"); },`,
    `    onSuccess: () => { utils.hosts.probeServices.invalidate(); utils.hosts.chinaCarrierProbeOverview.invalidate(); setDialogOpen(false); setEditingId(null); setForm({ ...defaultForm, probeKind: defaultProbeKind }); toast.success("服务已更新"); },`,
    "manager update invalidate carrier",
  );
  s = replaceOnce(
    s,
    `      await utils.hosts.probeServices.invalidate();\n    },`,
    `      await Promise.all([utils.hosts.probeServices.invalidate(), utils.hosts.chinaCarrierProbeOverview.invalidate()]);\n    },`,
    "manager toggle invalidate carrier",
  );
  s = replaceOnce(
    s,
    `    onSuccess: () => { utils.hosts.probeServices.invalidate(); toast.success("服务已删除"); },`,
    `    onSuccess: () => { utils.hosts.probeServices.invalidate(); utils.hosts.chinaCarrierProbeOverview.invalidate(); toast.success("服务已删除"); },`,
    "manager delete invalidate carrier",
  );
  s = replaceOnce(
    s,
    `    setEditingId(null);\n    setForm(defaultForm);\n    setDialogOpen(true);`,
    `    setEditingId(null);\n    setForm({ ...defaultForm, probeKind: defaultProbeKind });\n    setDialogOpen(true);`,
    "manager create default kind",
  );
  s = replaceOnce(
    s,
    `    if (form.hostScope === "specific" && form.hostIds.length === 0) { toast.error("请选择需要运行服务的主机"); return; }\n    const payload = { ...form, name, targetIp, targetPort: form.method === "tcping" ? targetPort : null, intervalSeconds: Math.max(5, Number(form.intervalSeconds) || 30) };`,
    `    if (form.hostScope === "specific" && form.hostIds.length === 0) { toast.error("请选择需要运行服务的主机"); return; }\n    if (form.probeKind === "china_carrier" && !form.carrier) { toast.error("请选择运营商"); return; }\n    const payload = {\n      ...form,\n      name,\n      targetIp,\n      targetPort: form.method === "tcping" ? targetPort : null,\n      carrier: form.probeKind === "china_carrier" ? form.carrier : null,\n      region: form.region.trim() || null,\n      intervalSeconds: Math.max(5, Number(form.intervalSeconds) || 30),\n    };`,
    "manager submit metadata",
  );
  s = replaceOnce(
    s,
    `      targetPort: service.targetPort ? String(service.targetPort) : "",\n      hostScope:`,
    `      targetPort: service.targetPort ? String(service.targetPort) : "",\n      probeKind: service.probeKind === "china_carrier" ? "china_carrier" : "custom",\n      carrier: service.probeKind === "china_carrier" ? (service.carrier || null) : null,\n      region: String(service.region || ""),\n      hostScope:`,
    "manager edit metadata",
  );
  const formAnchor = `            <div className="grid gap-3 sm:grid-cols-2">\n              <div className="space-y-1.5"><Label>服务名</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如: 公网 API 延迟" /></div>\n              <div className="space-y-1.5"><Label>类型</Label><Select value={form.method} onValueChange={(value) => setForm({ ...form, method: value as ServiceForm["method"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="tcping">TCPing</SelectItem><SelectItem value="ping">Ping</SelectItem></SelectContent></Select></div>\n            </div>`;
  const formReplacement = `${formAnchor}\n            <div className=\"grid gap-3 sm:grid-cols-2\">\n              <div className=\"space-y-1.5\">\n                <Label>探测分类</Label>\n                <Select\n                  value={form.probeKind}\n                  onValueChange={(value) => setForm({ ...form, probeKind: value as HostProbeKind, carrier: value === \"china_carrier\" ? form.carrier : null })}\n                >\n                  <SelectTrigger><SelectValue /></SelectTrigger>\n                  <SelectContent>\n                    <SelectItem value=\"custom\">自定义探测</SelectItem>\n                    <SelectItem value=\"china_carrier\">三网质量</SelectItem>\n                  </SelectContent>\n                </Select>\n              </div>\n              {form.probeKind === \"china_carrier\" ? (\n                <div className=\"space-y-1.5\">\n                  <Label>运营商</Label>\n                  <Select value={form.carrier || \"\"} onValueChange={(value) => setForm({ ...form, carrier: value as HostProbeCarrier })}>\n                    <SelectTrigger><SelectValue placeholder=\"选择运营商\" /></SelectTrigger>\n                    <SelectContent>\n                      <SelectItem value=\"cm\">{HOST_PROBE_CARRIER_LABELS.cm}</SelectItem>\n                      <SelectItem value=\"cu\">{HOST_PROBE_CARRIER_LABELS.cu}</SelectItem>\n                      <SelectItem value=\"ct\">{HOST_PROBE_CARRIER_LABELS.ct}</SelectItem>\n                    </SelectContent>\n                  </Select>\n                </div>\n              ) : <div />}\n            </div>\n            {form.probeKind === \"china_carrier\" ? (\n              <div className=\"space-y-1.5\">\n                <Label>地区 <span className=\"text-xs text-muted-foreground\">可选</span></Label>\n                <Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} placeholder=\"例如: 上海 / 广州 / 北京\" />\n              </div>\n            ) : null}`;
  s = replaceOnce(s, formAnchor, formReplacement, "manager metadata form controls");
  write(file, s);
}

function patchHostsPage() {
  const file = "client/src/pages/Hosts.tsx";
  let s = read(file);
  s = replaceOnce(
    s,
    `import HostProbeServiceManager, { type HostProbeServiceViewMode } from "@/components/hosts/HostProbeServiceManager";`,
    `import { type HostProbeServiceViewMode } from "@/components/hosts/HostProbeServiceManager";\nimport AdvancedProbePanel from "@/components/hosts/AdvancedProbePanel";`,
    "Hosts advanced panel import",
  );
  s = replaceOnce(
    s,
    `            <HostProbeServiceManager\n              createSignal={serviceCreateSignal}`,
    `            <AdvancedProbePanel\n              createSignal={serviceCreateSignal}`,
    "Hosts advanced panel component",
  );
  write(file, s);
}

patchSchema();
patchDbSchema();
patchProbeRepository();
patchDbExports();
patchHostsRouter();
patchManager();
patchHostsPage();
console.log("P0-2A carrier probe integration patch applied");
