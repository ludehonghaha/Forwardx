# Dual Read-only Discovery Evidence

本阶段把 ForwardX Dual 从“手工注入 discovery snapshot”继续推进到“结构化只读 evidence -> snapshot / planner”。仍然没有真实设备执行器。

## 数据流

```text
future ForwardX Agent read-only collector
              ↓
DualDiscoveryEvidenceBundle
              ↓
strict evidence compiler
        ┌─────┴─────┐
        ↓           ↓
Target snapshot   PortAvailabilityProbe
        ↓           ↓
carrier adapters / auto-port planner
              ↓
readiness engine
```

## Evidence 只允许结构化 observation

允许的 observation：

- `platform`
- `interface`
- `default-route`
- `private-side`
- `mita-runtime`
- `installed-binaries`
- `port-probe`

协议没有任意 `command`、`shell`、`script` 字段。当前 server compiler 只解释已经收集的 facts，不执行命令、不连接 SSH、不调用 Agent。

## Topology fail closed

公网侧只由明确的 `default-route` observation 选择，并要求 `sourceAddress` 属于该 interface。

专线侧必须有明确的 `private-side` observation：

- 不根据“非默认网卡”自动猜测；
- 不允许与公网侧为同一 interface；
- source address 必须属于该 interface；
- interface 重复、缺失或歧义直接拒绝。

Mita 必须有单独 `mita-runtime` observation。不能因为系统上“可能安装过 Mieru”就推导 listener。

## Port evidence

端口 availability 只有三个值：

- `available`
- `occupied`
- `unknown`

只有明确 `available` 才允许 Auto Port Planner 选中。没有对应 probe observation 时，evidence-backed probe 返回 `unknown`，禁止通过“listener 列表里没看到”推断端口可用。

这仍然不把 `20808` / `20809` 写回产品常量。`127.0.0.1:39000` 继续属于 server internal multipath listener，与客户端 auto ports 是不同边界。

## Provenance

当前 provenance：

- `agent-read-only`：未来 authenticated ForwardX Agent 只读采集，可映射为 `target-read-only` evidence；
- `synthetic`：仅测试/离线 fixture。

Synthetic bundle 可以验证 schema/compiler/preview，但输出的 readiness evidence 仍标记为 `synthetic`，不能满足真实 target 的 target-read-only evidence 要求。

## 当前 NoBrand facts

当前 verified fixture 仍对应：

- public: `eth0`, `87.86.22.221`, gateway `87.86.22.1`
- private: `eth1`, `172.16.4.114`
- existing Mita TCP listener: `11464`

这些仍然是目标发现数据，不是 generic schema literal。第二台 Dual 可以使用 `ens3/ens8`、不同公网/私网地址和不同 Mita port，不修改 TypeScript schema。

## 下一步（本 PR 不做）

下一阶段才考虑 ForwardX Agent 的真实只读 collector。即使进入该阶段，也应使用固定 action/request 类型，而不是从 Panel 下发任意 shell 命令。

在真实 collector 完成鉴权、结果签名/绑定 target、超时与错误语义审查前，`readyToDeploy` 继续 fail closed。

## 安全边界

本阶段没有：

- SSH 连接/修改设备
- 任意 shell executor
- OpenWrt/OpenClash 写入
- binary 下载/安装
- Mita/HY2 修改
- systemd/firewall/route/ip rule 修改
- Gray/Production 部署
- PR merge
