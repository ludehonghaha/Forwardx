# ForwardX × NoBrand-OneClick Provider 边界

> 状态：Provider 设计边界完成；允许进入只读发现 / external import PoC。禁止直接让 ForwardX 与 NoBrand 同时接管同一协议 runtime。

## 1. 上游基线

当前参考上游：`ike-sh/NoBrand-OneClick` 3.0.0。

NoBrand 3.0 是独立的服务器协议部署/管理器，正式入口为：

```text
nobrand
nb
```

它拥有自己的 schema v3 state、runtime、systemd/OpenRC、firewall/tc ownership，并支持：

- Mieru
- Snell v4/v5
- Hysteria2
- Plain VLESS + FinalMask/Sudoku

因此 ForwardX 不能把 NoBrand 当作一个“可以随便修改文件的脚本目录”。

## 2. 两套 ownership 必须分开

### ForwardX 继续唯一拥有

- ForwardX 用户、套餐、额度、到期；
- ForwardX hosts / Agent；
- ForwardX 转发规则、隧道、多跳、故障转移；
- ForwardX 稳定 access-feed Token 与统一订阅；
- ForwardX managed protocol runtime（例如现有 managed Mieru / Mihomo / Xray）明确创建的资源。

### NoBrand 继续唯一拥有

当一个 runtime 被登记为 `provider=nobrand` 时：

- `/var/lib/nobrand-oneclick` state；
- `/etc/nobrand-oneclick` 配置；
- NoBrand 自己安装的 mita / Xray / Snell runtime；
- NoBrand 创建的 service、firewall、tc、scheduler；
- NoBrand backup / restore / uninstall 语义。

ForwardX 不直接编辑这些文件，不按进程名 kill，不覆盖 unit，不把 NoBrand-owned listener 再编译进自己的 desired state。

## 3. 为什么不能直接“套脚本”

ForwardX 的 managed Mieru 已采用“每台 Agent 主机一个 Mita listener，多 ForwardX assignment 独立凭据与流量”的模型。

NoBrand 3.0 的 Mieru 则是每个启用用户稳定 `instance_id`、独立 Mita 实例、独占 listener，并由 NoBrand 独立管理 quota / expiry / tc / firewall。

两个模型都合理，但 ownership 不兼容。若同一节点同时由两者管理，会出现：

- 用户/额度双重事实来源；
- listener 与端口 ownership 冲突；
- service/apply/rollback 互相覆盖；
- 卸载时无法安全判断资源归属。

因此 **NoBrand Provider 首版必须从“发现和导入外部节点”开始，而不是复制 NoBrand 的用户管理。**

## 4. P2-0 Provider 首版

### 4.1 只读探测

Agent 只执行公开 CLI：

```text
nobrand --version
nobrand nodes
nobrand status
nobrand doctor
```

不得直接解析或修改 NoBrand 私有 state 文件作为首版 API。

只读结果用于判断：

- 是否安装 NoBrand；
- 版本；
- 持久化协议/节点；
- display endpoint；
- Running / Stopped；
- doctor 是否通过。

### 4.2 显式导入 external endpoint

管理员选择一个 NoBrand 节点后，ForwardX 创建/更新 `runtimeMode=external` 的协议端点。

规则：

- ForwardX 保存自己订阅所需的 endpoint/credential 快照；
- 不把 external endpoint 下发到 ForwardX managed runtime；
- ForwardX 删除“导入记录”不等于删除 NoBrand 节点；
- NoBrand 删除节点后，ForwardX 只标记 provider drift / unavailable，不自行重建。

凭据必须来自 NoBrand 的正式 show/export 命令或管理员显式提供，不从监听进程、日志或私有 state 反推。

### 4.3 Provider identity

后续数据模型至少需要区分：

```text
provider = forwardx | nobrand
providerHostId
providerExternalId
providerProtocol
providerVersion
providerObservedAt
providerStatus
```

首版可先作为协议端点 metadata，不必立即新增第二套节点表。

`providerExternalId` 必须是 NoBrand 可稳定识别的实例/用户标识；不能只拿显示名称当主键。

## 5. NoBrand delegated actions（第二阶段，默认关闭）

只有只读 Provider 稳定后，才考虑由 ForwardX Agent 调用 NoBrand 正式 CLI，例如安装/重启/删除某个 NoBrand-owned实例。

如果实现，必须满足：

1. 全程调用 `nobrand ...`，不直接改 NoBrand state/config；
2. 请求必须标记 `provider=nobrand`，与 ForwardX managed runtime 互斥；
3. 每次 destructive action 前做 ownership 检查；
4. ForwardX 只记录 action/result，不宣称自己拥有底层资源；
5. NoBrand CLI 失败时不执行“第二套修复逻辑”；
6. 卸载/删除必须明确提示会作用于 NoBrand-owned 资源。

## 6. 订阅策略

NoBrand Provider 的价值是把现有 NoBrand 节点纳入 ForwardX 的稳定用户订阅，而不是再创造第二条订阅体系。

支持原则：

- 能无损表示为 ForwardX 已支持格式的 external 节点，可进入现有 access-feed；
- 不能无损表达的协议/参数，不允许静默降级；
- NoBrand 的 Display Endpoint 应作为客户端地址，真实 listener 仅用于 provider health；
- ForwardX 不把“节点导入成功”等同于“链路由 ForwardX 计量”。external 流量能力必须如实显示。

## 7. P2-0 验收

首版完成的定义：

1. Agent 能识别 NoBrand 是否安装和版本；
2. 能只读列出节点和 Running/Stopped；
3. 不读取/修改 NoBrand secret state；
4. 选择一个节点后能显式导入为 ForwardX external endpoint；
5. refresh 不重复创建 endpoint；
6. NoBrand 节点停止/删除后能显示 drift；
7. 删除 ForwardX 导入记录不会删除 NoBrand runtime；
8. 普通 ForwardX managed Mieru/Mihomo/Xray desired state 完全不受影响；
9. 统一订阅只输出客户端确实支持的完整参数；
10. provider 不把 external 流量伪装成 ForwardX managed 流量。

## 8. 当前结论

**GO：只读 NoBrand Provider + external import PoC。**

**BLOCKED：让 ForwardX 与 NoBrand 同时管理同一 runtime；以及在未完成 ownership 验收前开放一键删除/卸载。**
