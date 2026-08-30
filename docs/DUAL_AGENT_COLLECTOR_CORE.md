# Dual Agent Collector Core

本阶段只实现 **Agent 端的纯只读 Collector 核心**，不把它注册到真实 Agent action / SSE / HTTP 路径，也不提供任何 shell 执行能力。

## 目标

固定链路：

```text
DualAgentDiscoveryRequest
        ↓
dualDiscoveryCollectorProvider
        ↓
collectDualAgentDiscovery()
        ↓
DualDiscoveryEvidenceBundle
```

Provider 是 capability-shaped API，而不是 command-shaped API。Collector 只能请求以下规范化事实：

- platform
- interfaces
- default route
- Mita runtime（如果存在）
- installed binary presence
- `127.0.0.1/tcp` candidate port availability

不存在 `command`、`shell`、`script`、`argv`、`cwd`、`env` 等通用远程执行字段。

## 当前分类规则

- default route 的 `dev + sourceAddress` 形成公网/默认出口事实；sourceAddress 必须真实属于该 interface。
- 专线侧必须能从非默认出口 interface 唯一推导；若无法唯一确定，Collector **fail closed**，不猜测。
- Mita 不存在时不伪造 observation。该缺口留给 readiness engine 继续阻塞部署。
- 端口 provider 报错或返回未知枚举时统一降级为 `unknown`；`unknown` 不会被 planner 当成 available。

当前 NoBrand Dual 的 `eth0 / eth1 / 87.86.22.221 / 172.16.4.114 / 11464` 只存在于测试/目标事实中，不写入 Collector 通用接口。

第二台 synthetic Dual 可使用 `ens3 / ens8 / 203.0.113.20 / 10.44.0.12 / 22464`，无需修改 schema 或 Collector source。

## 明确禁止

本 PR 不实现：

- `os/exec` / generic command runner
- `ip`, `ss`, `systemctl` 等真实 collector backend
- SSH
- OpenWrt / OpenClash 写入
- Mita / HY2 修改
- binary 安装
- systemd / firewall / route / ip rule 修改
- Gray / Production 部署

下一阶段若接入真实 Agent，只能为这里的固定 Provider methods 分别实现最小只读 backend，不能新增通用 shell executor。
