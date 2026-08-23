from pathlib import Path


def patch(path, replacements):
    p = Path(path)
    s = p.read_text()
    for label, old, new in replacements:
        count = s.count(old)
        if count != 1:
            raise SystemExit(f'{path}: {label}: expected 1 match, got {count}')
        s = s.replace(old, new, 1)
    p.write_text(s)


patch('server/routers/protocolAccess.ts', [
    ('allocator import',
     'import { reserveSpecificHostPort, type HostPortReservation } from "../portReservations";',
     'import { reserveSpecificHostPort, type HostPortReservation } from "../portReservations";\nimport { reserveManagedProtocolPort } from "../protocolManagedPort";'),
    ('create schema auto port',
     '  publicPort: z.number().int().min(1).max(65535),\n  config: configSchema,',
     '  publicPort: z.number().int().min(1).max(65535).nullable().optional(),\n  autoPort: z.boolean().optional().default(false),\n  config: configSchema,'),
    ('validate pre reservation',
     '  isEnabled: boolean;\n}) {\n  if (/\\s|:\\/\\//.test(input.publicHost)) {',
     '  isEnabled: boolean;\n  preReservation?: HostPortReservation | null;\n}) {\n  if (!Number.isInteger(input.publicPort) || input.publicPort < 1 || input.publicPort > 65535) {\n    throw new Error("公网端口必须是 1-65535");\n  }\n  if (/\\s|:\\/\\//.test(input.publicHost)) {'),
    ('reuse pre reservation',
     '  if (!input.isEnabled) return { hostId, forwardRuleId, reservation: null as HostPortReservation | null };\n  const reservation = await reserveSpecificHostPort({',
     '  if (input.preReservation) {\n    if (input.preReservation.hostId !== hostId || input.preReservation.port !== listenPort || input.preReservation.protocol !== serverProtocol) {\n      throw new Error("自动分配端口预约与端点配置不一致");\n    }\n    return { hostId, forwardRuleId, reservation: input.preReservation };\n  }\n  if (!input.isEnabled) return { hostId, forwardRuleId, reservation: null as HostPortReservation | null };\n  const reservation = await reserveSpecificHostPort({'),
    ('create endpoint mutation',
     '''  createEndpoint: adminProcedure.input(endpointCreateSchema).mutation(async ({ ctx, input }) => {\n    const config = provisionManagedProtocolConfig(input.protocol, input.runtimeMode, input.config);\n    const validated = await validateEndpoint({ ...input, config });\n    try {\n      return await db.createProtocolEndpoint({\n        name: input.name,\n        protocol: input.protocol,\n        runtimeMode: input.runtimeMode,\n        hostId: validated.hostId,\n        forwardRuleId: validated.forwardRuleId,\n        publicHost: input.publicHost,\n        publicPort: input.publicPort,\n        configJson: config,\n        isEnabled: input.isEnabled,\n        sortOrder: input.sortOrder,\n        createdByUserId: ctx.user.id,\n      } as any);\n    } finally {\n      validated.reservation?.release();\n    }\n  }),''',
     '''  createEndpoint: adminProcedure.input(endpointCreateSchema).mutation(async ({ ctx, input }) => {\n    const config = provisionManagedProtocolConfig(input.protocol, input.runtimeMode, input.config);\n    let publicPort = Number(input.publicPort || 0);\n    let reservation: HostPortReservation | null = null;\n    try {\n      if (input.autoPort) {\n        if (input.runtimeMode !== "managed") throw new Error("自动分配端口仅支持 Agent 托管端点");\n        if (input.forwardRuleId) throw new Error("关联现有 ForwardX 规则时不能自动分配端口");\n        const hostId = Number(input.hostId || 0);\n        if (!Number.isInteger(hostId) || hostId <= 0 || !await db.getHostById(hostId)) {\n          throw new Error("请选择有效的 ForwardX Agent 主机");\n        }\n        const serverProtocol = managedProtocolSocketProtocol(input.protocol, config);\n        const runtimeState = getAgentLocalRuntimeStateSnapshot(hostId)?.state;\n        const runtimePorts = (runtimeState?.listeners || [])\n          .filter((listener) => listener.ready)\n          .map((listener) => Number(listener.port || 0))\n          .filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);\n        reservation = await reserveManagedProtocolPort({\n          hostId,\n          protocol: serverProtocol,\n          excludedPorts: runtimePorts,\n          findAvailablePort: (excludedPorts) => db.findAvailablePort(\n            hostId,\n            undefined,\n            undefined,\n            serverProtocol,\n            excludedPorts,\n            [],\n            [],\n          ),\n          isPortUsed: (port) => db.isPortUsedOnHost(\n            hostId,\n            port,\n            undefined,\n            serverProtocol,\n            undefined,\n            true,\n          ),\n        });\n        if (!reservation) throw new Error("该 Agent 主机端口区间内已无可用端口");\n        publicPort = reservation.port;\n        config.listenPort = reservation.port;\n      }\n      if (!publicPort) throw new Error("请填写公网端口，或开启自动分配端口");\n      const validated = await validateEndpoint({ ...input, publicPort, config, preReservation: reservation });\n      reservation = validated.reservation;\n      return await db.createProtocolEndpoint({\n        name: input.name,\n        protocol: input.protocol,\n        runtimeMode: input.runtimeMode,\n        hostId: validated.hostId,\n        forwardRuleId: validated.forwardRuleId,\n        publicHost: input.publicHost,\n        publicPort,\n        configJson: config,\n        isEnabled: input.isEnabled,\n        sortOrder: input.sortOrder,\n        createdByUserId: ctx.user.id,\n      } as any);\n    } finally {\n      reservation?.release();\n    }\n  }),'''),
    ('update auto port reject',
     '    const current = await db.getProtocolEndpointById(input.id);\n    if (!current) throw new Error("协议接入端点不存在");',
     '    const current = await db.getProtocolEndpointById(input.id);\n    if (!current) throw new Error("协议接入端点不存在");\n    if (input.autoPort) throw new Error("自动分配端口仅用于新建托管端点；编辑时请保留现有端口或手动修改");'),
    ('strip auto port from patch',
     '    const { id, config: _config, ...patch } = input;',
     '    const { id, config: _config, autoPort: _autoPort, ...patch } = input;'),
])

patch('client/src/pages/ProtocolAccess.tsx', [
    ('form auto port field',
     '  publicPort: string;\n  cipher: string;',
     '  publicPort: string;\n  autoPort: boolean;\n  cipher: string;'),
    ('empty auto port',
     '  publicPort: "",\n  cipher: "chacha20-ietf-poly1305",',
     '  publicPort: "",\n  autoPort: true,\n  cipher: "chacha20-ietf-poly1305",'),
    ('row auto port false',
     '    publicPort: String(endpoint.publicPort || ""),\n    cipher: String(config.cipher || "chacha20-ietf-poly1305"),',
     '    publicPort: String(endpoint.publicPort || ""),\n    autoPort: false,\n    cipher: String(config.cipher || "chacha20-ietf-poly1305"),'),
    ('save auto mode',
     '  const saveEndpoint = () => {\n    const publicPort = Number(endpointForm.publicPort);\n    const listenPort = Number(endpointForm.listenPort || endpointForm.publicPort);',
     '  const saveEndpoint = () => {\n    const autoManagedPort = endpointForm.runtimeMode === "managed" && !endpointForm.id && endpointForm.autoPort;\n    const publicPort = Number(endpointForm.publicPort);\n    const listenPort = Number(endpointForm.listenPort || endpointForm.publicPort);'),
    ('public port validation',
     '    if (!Number.isInteger(publicPort) || publicPort < 1 || publicPort > 65535) {\n      toast.error("公网端口必须是 1-65535");\n      return;\n    }',
     '    if (!autoManagedPort && (!Number.isInteger(publicPort) || publicPort < 1 || publicPort > 65535)) {\n      toast.error("公网端口必须是 1-65535");\n      return;\n    }'),
    ('listen port validation',
     '      if (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535) {\n        toast.error("Agent 监听端口必须是 1-65535");\n        return;\n      }',
     '      if (!autoManagedPort && (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535)) {\n        toast.error("Agent 监听端口必须是 1-65535");\n        return;\n      }\n      if (autoManagedPort && Number(endpointForm.forwardRuleId)) {\n        toast.error("自动分配端口不能同时关联现有 ForwardX 规则");\n        return;\n      }'),
    ('managed config listen',
     '    if (endpointForm.runtimeMode === "managed") config.listenPort = listenPort;',
     '    if (endpointForm.runtimeMode === "managed" && !autoManagedPort) config.listenPort = listenPort;'),
    ('input auto port',
     '      publicHost: endpointForm.publicHost.trim(),\n      publicPort,\n      config,',
     '      publicHost: endpointForm.publicHost.trim(),\n      publicPort: autoManagedPort ? undefined : publicPort,\n      autoPort: autoManagedPort,\n      config,'),
    ('runtime mode auto default',
     '                      listenPort: endpointForm.listenPort || endpointForm.publicPort,\n                    } : {}),',
     '                      listenPort: endpointForm.listenPort || endpointForm.publicPort,\n                      autoPort: !endpointForm.id,\n                    } : { autoPort: false }),'),
    ('public port field conditional',
     '''              <div className="space-y-2">\n                <Label>{endpointForm.protocol === "shadowsocks_ssh" ? "SSH 公网端口" : `${protocolLabel(endpointForm.protocol)} 公网端口`}</Label>\n                <Input type="number" min={1} max={65535} value={endpointForm.publicPort} onChange={(event) => setEndpointForm({ ...endpointForm, publicPort: event.target.value })} />\n              </div>''',
     '''              {!(endpointForm.runtimeMode === "managed" && !endpointForm.id && endpointForm.autoPort) && (\n                <div className="space-y-2">\n                  <Label>{endpointForm.protocol === "shadowsocks_ssh" ? "SSH 公网端口" : `${protocolLabel(endpointForm.protocol)} 公网端口`}</Label>\n                  <Input type="number" min={1} max={65535} value={endpointForm.publicPort} onChange={(event) => setEndpointForm({ ...endpointForm, publicPort: event.target.value })} />\n                </div>\n              )}'''),
    ('managed fields auto switch',
     '''              {endpointForm.runtimeMode === "managed" && (\n                <>\n                  <div className="space-y-2">\n                    <Label>Agent 主机</Label>''',
     '''              {endpointForm.runtimeMode === "managed" && (\n                <>\n                  {!endpointForm.id && (\n                    <div className="flex items-center justify-between gap-3 rounded-lg border p-3 sm:col-span-2">\n                      <div>\n                        <p className="text-sm font-medium">自动分配端口（推荐）</p>\n                        <p className="text-xs leading-5 text-muted-foreground">保存时由服务端按主机端口策略自动预约空闲端口，并避开现有转发、协议端点和 Agent 已上报监听；公网端口与 Agent 监听端口保持一致。</p>\n                      </div>\n                      <Switch checked={endpointForm.autoPort} onCheckedChange={(autoPort) => setEndpointForm({ ...endpointForm, autoPort })} />\n                    </div>\n                  )}\n                  <div className="space-y-2">\n                    <Label>Agent 主机</Label>'''),
    ('managed listen conditional',
     '''                  <div className="space-y-2">\n                    <Label>Agent 监听端口</Label>\n                    <Input type="number" min={1} max={65535} value={endpointForm.listenPort} onChange={(event) => setEndpointForm({ ...endpointForm, listenPort: event.target.value })} />\n                  </div>\n                  <div className="space-y-2 sm:col-span-2">\n                    <Label>关联 ForwardX 规则 ID（可选）</Label>\n                    <Input type="number" min={1} value={endpointForm.forwardRuleId} onChange={(event) => setEndpointForm({ ...endpointForm, forwardRuleId: event.target.value })} placeholder="公网入口经过现有链路时填写" />\n                    <p className="text-xs text-muted-foreground">填写后只引用现有转发规则，不会再编译一条重复链路；规则源端口需等于公网端口，目标端口需等于 Agent 监听端口。</p>\n                  </div>''',
     '''                  {(!endpointForm.autoPort || !!endpointForm.id) && (\n                    <div className="space-y-2">\n                      <Label>Agent 监听端口</Label>\n                      <Input type="number" min={1} max={65535} value={endpointForm.listenPort} onChange={(event) => setEndpointForm({ ...endpointForm, listenPort: event.target.value })} />\n                    </div>\n                  )}\n                  {(!endpointForm.autoPort || !!endpointForm.id) && (\n                    <div className="space-y-2 sm:col-span-2">\n                      <Label>关联 ForwardX 规则 ID（可选）</Label>\n                      <Input type="number" min={1} value={endpointForm.forwardRuleId} onChange={(event) => setEndpointForm({ ...endpointForm, forwardRuleId: event.target.value })} placeholder="公网入口经过现有链路时填写" />\n                      <p className="text-xs text-muted-foreground">填写后只引用现有转发规则，不会再编译一条重复链路；规则源端口需等于公网端口，目标端口需等于 Agent 监听端口。</p>\n                    </div>\n                  )}'''),
])

patch('package.json', [
    ('protocol test script',
     'server/protocolAccessSchema.test.ts server/protocolRuntimePlan.test.ts server/protocolRuntimeStatus.test.ts server/protocolSubscription.test.ts',
     'server/protocolAccessSchema.test.ts server/protocolManagedPort.test.ts server/protocolRuntimePlan.test.ts server/protocolRuntimeStatus.test.ts server/protocolSubscription.test.ts'),
])
