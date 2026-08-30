# Dual Agent Read-only Protocol v1

本阶段只定义 ForwardX Panel 与未来 Agent Dual collector 之间的**固定只读协议契约**。不注册 Agent action、不发请求到真实设备、不执行系统命令。

## 为什么单独做协议层

Dual discovery 后续需要读取：网卡、默认路由、专线侧、Mita listener、已安装 runtime，以及指定 loopback candidate 的端口占用状态。

Panel 不应该通过通用 `command` / `shell` / `script` 字段告诉 Agent “执行什么命令”。否则控制面会退化为远程 shell。

因此 v1 只有一个固定 operation：

```text
dual-readonly-discovery
```

Agent 最终如何采集这些 facts，必须由 Agent 自己的受审计 collector 实现，而不是由 Panel 传入命令文本。

## Request

Request 只包含：

- protocol version
- fixed operation
- `requestId`
- `targetId`
- loopback TCP port candidate groups

当前端口 probe 被限制在 `127.0.0.1/tcp`。Panel 只能给 candidate port 数字，不能给 address command、socket command、cwd、env 或 shell args。

`20808/20809` 仍不是 runtime 常量。candidate 只是 planner 的候选，只有未来 Agent 明确返回 `available` evidence 才能被选中。

## Response

Response 为：

- `ok` + `DualDiscoveryEvidenceBundle`
- 或 `failed` + 固定错误结构

真实 Agent 成功响应的 evidence provenance 必须是：

```text
agent-read-only
```

Panel 接收层继续检查：

1. request / response `requestId` 一致；
2. request / response `targetId` 一致；
3. evidence `targetId` 与 target 一致；
4. provenance 为 `agent-read-only`；
5. evidence 再进入上一层 strict discovery compiler。

任何 mismatch 都 fail closed。

## Cross-language fixture

`shared/fixtures/dual-agent-discovery-request-v1.json` 与 `dual-agent-discovery-response-v1.json` 同时由 TypeScript 和 Go tests 读取，用于防止 Panel / Agent JSON contract 漂移。

Go 侧目前只有：

- JSON structs/constants
- strict decode
- pure validation
- cross-language tests

没有 collector，没有 handler registration，没有 HTTP/SSE dispatch，也没有 `os/exec`。

## 明确禁止的协议能力

v1 不存在以下字段：

- `command`
- `shell`
- `script`
- `cwd`
- arbitrary environment
- arbitrary argv

协议也不包含 systemd/firewall/route mutation、文件写入或 binary install 指令。

## 下一阶段

下一阶段若实现 Agent collector，应先独立 review collector 的固定只读实现，例如：

- interface/default-route discovery
- explicit private-side selection evidence
- Mita status/listener discovery
- exact loopback port probe

即使实现 collector，也应保持：

```text
Panel fixed request
      ↓
Agent fixed collector implementation
      ↓
structured evidence
```

而不是：

```text
Panel shell text
      ↓
Agent generic executor
```

真实 collector 尚未完成前，readiness 继续 fail closed。

## 当前安全边界

本 PR 没有：

- SSH
- 真实 Agent dispatch
- shell/system command execution
- OpenWrt/OpenClash 写入
- Mita/HY2 修改
- binary 安装
- systemd/firewall/route/ip rule 修改
- Gray/Production 部署
- PR merge
