# Dual Runtime Planner Foundation

本阶段只建立 ForwardX Dual 的 offline/control-plane 基础，不部署、不执行 shell、不修改任何设备。

## 数据流

```text
Target discovery snapshot
        ↓
Auto planning / carrier adapters
        ↓
Typed validation evidence
        ↓
Deployment readiness engine
        ↓
blocked | ready
```

`readyToDeploy` 不再由 UI 或硬编码布尔值决定，而由 canonical evidence 推导。缺 evidence、target 不匹配、synthetic evidence、端口 unknown、artifact 未固定或原生配置未验证时全部 fail closed。

## Auto port

客户端 loopback 端口继续保持：

```json
{
  "portStrategy": "auto",
  "status": "unresolved",
  "port": null
}
```

`PortAvailabilityProbe` 只有只读 contract，没有 SSH/shell implementation。planner 只接受 `available` 的明确 evidence；`occupied` 会跳过，`unknown` 不会被当作可用。候选端口由调用方/策略提供，不能把 `20808`、`20809` 重新写成产品 runtime fact。

服务端内部 multipath listener `127.0.0.1:39000` 仍是不同边界，本阶段不删除。

## Carrier adapter

Dual schema 只描述聚合目标，不把 Mieru/HY2 安装细节写死在 schema 中。

当前提供纯离线 adapter contract：

```text
discover()
plan()
validate()
render()
dryRun()
```

这些接口没有 command execution、package install、systemd、firewall 或 route mutation surface。

### Mieru

Mieru adapter 明确拆分：

- `localListener`：Dual server 上已经发现的 Mita/Mieru listener。
- `externalEntry`：客户端实际连接的 NoBrand/L4/mobile entry。

二者不允许互相推导。只有 server local listener 时，adapter 保持 blocked，不会把它伪装成 external entry。

### Hysteria2

HY2 adapter 从 target discovery 派生公网 interface/source address，从 `directCarrier` 派生 endpoint/TLS。它只是 planning/rendering，不启动 HY2，也不写任何 runtime。

## Readiness blockers

至少覆盖：

- target discovery
- auto client ports
- private carrier discovery
- HY2 runtime config
- client/server pinned artifacts
- Mihomo native config validation
- final `sing-box check`
- private/direct carrier reachability
- secret resolution
- gray lifecycle
- rollback plan

Synthetic evidence 可以用于测试 planner，但不能让真实 target 进入 `readyToDeploy=true`。

## Artifact pinning

Artifact requirement 需要：

- component
- platform
- arch
- exact version
- source
- SHA256
- verification status

当前至少表示 OpenWrt `aarch64` client 与 Dual Linux `x86_64` server。缺 exact version/source/SHA256 时 blocker 必须保留；文档和测试不会填写虚构生产 checksum。

## 对 Ou-Mieru 的借鉴边界

参考：`cshaizhihao/Ou-Mieru` 的 `nobrand` installer。

借鉴的设计思想：

1. 本机 Mieru listener 与客户端 external entry 分开建模。
2. 参数化 installer，而不是把安装流程写进 UI。
3. 创建前检查端口冲突。
4. 提供 dry-run/preview 边界。
5. artifact 需要版本与 SHA256 校验。
6. credentials/config 由系统生成或引用，不要求普通用户管理内部细节。

明确不采用：

- 不 `curl | sh`。
- 不 vendor 整个 Ou-Mieru 脚本。
- 不把它作为 ForwardX runtime dependency。
- 不执行它的 reinstall/uninstall/systemd/Mita mutation。
- 不把 Ou-Mieru 当作 multipath implementation。

ForwardX 的 multipath 仍独立于 Mieru；Mieru 只是 private/premium carrier adapter 之一。

## 安全边界

本阶段没有：

- SSH 写入
- OpenClash 写配置
- binary 下载/安装
- Mita 修改
- HY2 启动
- systemd/firewall/route/ip rule 修改
- Gray/Production 部署
- PR merge
