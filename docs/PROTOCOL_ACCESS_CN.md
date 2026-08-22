# 协议接入融合边界

本模块把 TMS 中 ForwardX 尚未具备的“协议接入与客户端订阅”能力加入 ForwardX，
但不把两个面板拼接在一起，也不引入第二套后端、前端、Agent 或网络编排模型。

## 单一事实来源

| 能力 | 唯一实现 | 融合规则 |
| --- | --- | --- |
| 用户、到期、套餐、额度 | ForwardX `users` / 套餐与计费表 | 不迁移 TMS `user` / `user_tunnel` |
| 主机与 Agent | ForwardX `hosts` + Go Agent | 不迁移 TMS `node` 与 WebSocket Agent |
| 入口、出口、多跳、故障转移 | ForwardX 隧道、转发组、转发规则 | 不迁移 TMS Network Orchestration 分支 |
| 流量与限速 | ForwardX 转发规则和用户流量账本 | 协议层不再次累计链路流量 |
| 配置审计与运行态收敛 | ForwardX config audit + desired state | 不新增第二套 Apply/rollback 引擎 |
| 协议端点与用户凭据 | 本模块 | 新增，TMS 只作为行为参考 |
| URI / Mihomo 客户端订阅 | 本模块 | 新增，和“套餐订阅”使用不同命名 |

明确不进入此仓库的代码：

- TMS Spring Boot 后端；
- TMS Vite/React 前端；
- TMS 内置的整套 go-gost；
- TMS `Node`、`Tunnel`、`Forward`、用户、限速和流量表；
- TMS 新增的节点组、多跳编译、健康探测、Apply 和 rollback 模块。

这样生产构建仍然只有 ForwardX 的一套 Web/Server 和一套 Agent，不会重复编译两个面板。

## 当前第一阶段

第一阶段只开放 `runtimeMode=external`：把已经存在的 Shadowsocks 或
Shadowsocks-over-SSH 接入登记到 ForwardX，再由 ForwardX 用户和稳定 Token 输出客户端订阅。

数据模型只有三个增量表：

- `protocol_endpoints`：协议端点，不复制主机或链路；
- `protocol_user_access`：现有 ForwardX 用户到端点的凭据分配；
- `protocol_feed_tokens`：每个用户一个稳定的客户端总订阅 Token。

订阅地址：

- `/api/v1/access-feed/:token`：Base64 URI 列表；
- `/api/v1/access-feed/:token/mihomo`：Mihomo / OpenClash YAML。

复合的 Shadowsocks-over-SSH 不能无损表示为普通 `ss://`，因此只进入 Mihomo 订阅。
若没有任何兼容节点，接口返回 404，而不是返回 HTTP 200 的空正文。

外部端点的流量不经过 ForwardX，面板不会假装能够计量它。只有未来由 ForwardX
转发规则承载的托管端点才进入现有用户流量与额度账本。

## 后续托管阶段

托管协议不会复制 TMS 的推送链路，而会扩展 ForwardX 现有 desired state：

1. 协议端点引用现有 `hostId`；
2. 每个用户的公网监听引用现有 `forwardRuleId`；
3. Agent 原子写入并校验 sing-box 配置；
4. desired state 对账运行服务；
5. 监听和握手健康后更新运行态；
6. 失败继续使用 ForwardX 配置审计与上一个已应用快照恢复。

端口预留、多跳链、限速、用户停用、到期和流量封禁仍由 ForwardX 原生资源处理。
协议模块只负责生成本地协议监听和客户端凭据。

## 安全约束

- 客户端 Token 使用 32 字节随机数，只保存一份稳定总订阅，可主动轮换；
- 订阅响应使用 `private, no-store`；
- 无效、停用或过期用户统一返回 404；
- SSH 私钥只会进入该用户的 Mihomo 订阅，不进入 URI 订阅；
- 配置审计对密码、Token、私钥和 credential 字段自动脱敏；
- 未实现托管运行态前，API 拒绝创建 `runtimeMode=managed` 端点。
