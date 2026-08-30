# Dual Agent Handler Core

本阶段把 Draft PR #63 的固定 wire protocol 与 Draft PR #64 的纯 Collector Core 接起来：

```text
JSON payload
   ↓ strict decode
DualAgentDiscoveryRequest
   ↓
collectDualAgentDiscovery()
   ↓ validate request/response binding
DualAgentDiscoveryResponse
   ↓ JSON encode
response payload
```

## 安全边界

Handler Core **没有注册到任何 transport**：

- 不注册 HTTP route
- 不注册 SSE/action
- 不连接真实 Agent dispatch
- 不含 `os/exec`
- 不含 shell/argv/cwd/env
- 不执行 `ip` / `ss` / `systemctl`
- 不访问 SSH
- 不修改 OpenWrt/OpenClash/Mita/HY2/systemd/firewall/route

请求必须先通过 v1 strict decoder；unknown field 会在 Provider 被调用之前拒绝。因此 `command` 等字段不能借 handler 绕过固定协议。

Collector 返回的成功或 `collection-failed` 响应在编码前再次通过 exchange validation，确保 `requestId` / `targetId` 与 evidence 绑定。

下一阶段若要注册到真实 Agent transport，注册点只能调用这个固定 Handler Core，并注入固定只读 Provider；不得增加通用 remote executor。
