# ForwardX × NoBrand-OneClick Provider 边界

> 状态：Provider ownership 边界完成；P2-0 已进入“schema v3 只读状态解析”阶段。禁止直接让 ForwardX 与 NoBrand 同时接管同一协议 runtime。

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

ForwardX 的 managed Mieru 已采用“ForwardX 管理的 Mita runtime + 多 ForwardX assignment 独立凭据与流量”的模型。

NoBrand 3.0 的 Mieru 则是每个启用用户稳定 `instance_id`、独立 Mita 实例、独占 listener，并由 NoBrand 独立管理 quota / expiry / tc / firewall。

两个模型都合理，但 ownership 不兼容。若同一节点同时由两者管理，会出现：

- 用户/额度双重事实来源；
- listener 与端口 ownership 冲突；
- service/apply/rollback 互相覆盖；
- 卸载时无法安全判断资源归属。

因此 **NoBrand Provider 首版必须从“发现和导入外部节点”开始，而不是复制 NoBrand 的用户管理。**

## 4. 已审计的 schema v3 只读边界

进一步审计 NoBrand 3.0 源码后，P2-0 不再把 `nobrand nodes` 的人类表格当作机器 API。NoBrand v3 已有明确的权威状态根和 fail-closed schema 标记，可作为只读 Provider 的稳定输入。

权威根：

```text
/var/lib/nobrand-oneclick/state.json
```

只有根标记同时满足下列条件，ForwardX 才允许继续读取子状态：

```json
{
  "schema_version": 3,
  "project": "NoBrand-OneClick",
  "ownership": "nobrand-v3"
}
```

任何旧版、未知 schema、缺失 ownership 或错误 project 都必须 fail closed：不读取子状态、不猜测、不迁移、更不修改。

当前已确认的 v3 数据源：

```text
/var/lib/nobrand-oneclick/mieru/install-state.env
/var/lib/nobrand-oneclick/mieru/users.json
/var/lib/nobrand-oneclick/snell/instances/*.json
/var/lib/nobrand-oneclick/hysteria2/state.json
/var/lib/nobrand-oneclick/vless-sudoku/state.json
```

其中 Mieru `install-state.env` 由 NoBrand 使用 Bash `printf %q` 写入。ForwardX **绝不 source/执行它**；只允许解析 Provider 所需的简单枚举和整数键，例如 schema、ownership、protocol、MTU、multiplexing、handshake mode、traffic-pattern mode 与 Low Entropy mode。出现需要 shell 求值的未知值时拒绝猜测。

## 5. P2-0 只读 Provider

### 5.1 发现

Agent 后续只负责把经过路径、权限和 schema 检查的状态内容读回面板解析，不执行 install/reconfigure/delete，也不修改任何 NoBrand 文件。

CLI 可以继续用于人工诊断：

```text
nobrand --version
nobrand nodes
nobrand status
nobrand doctor
```

但 `nobrand nodes` 当前主要输出固定宽度的人类表格，因此不作为 ForwardX 的持久机器解析合同。

### 5.2 当前无损映射

P2-0 parser 只输出 ForwardX 能完整表达的 external node：

- **Mieru**：要求 root schema v3、Mieru install-state v3、`users.json` version 2、`deployment_model=isolated-v2` 一致；读取每个稳定 `instance_id`、用户名、密码、display endpoint、MTU、multiplexing 与 handshake mode。NoBrand `BOTH` 会明确拆成 TCP / UDP 两个 external node，UDP 端口为基准端口 + 1。
- **Snell v4/v5**：读取稳定 instance id、版本、PSK、display endpoint 与 v5 QUIC/UDP 状态。
- **Hysteria2**：读取 auth、SNI、Salamander obfs、display endpoint，并按 NoBrand 自签证书语义生成 `insecure=true` 的 external 配置。
- **VLESS + FinalMask/Sudoku**：当前 ForwardX 支持的是 VLESS Reality，二者不是同一种协议。P2-0 必须显式 skip，绝不能伪装成 Reality 导入。

Mieru 还有两个必须 fail closed 的客户端能力：

1. **traffic-pattern**：NoBrand 的 `install-state.env` 只记录 `off / conservative / aggressive` 模式；真正下发到客户端的 `traffic-pattern` 是 NoBrand 调用 Mita `export traffic-pattern` 后得到的实际生成值。因此当前纯状态 parser 只允许 `TRAFFIC_PATTERN=off`，并且在 ForwardX 订阅中完全不输出 `traffic-pattern`。只要启用 conservative/aggressive，就先 skip，直到后续 Agent 能以只读方式拿到实际导出值。
2. **Low Entropy**：ForwardX 当前协议模型尚未表达 NoBrand 的实验性 Low Entropy 客户端参数，所以 P2-0 只允许 `LOW_ENTROPY_MODE_OFF`。启用任意 Low Entropy 模式时显式 skip，不静默丢参数。

所有结果只生成 `runtimeMode=external` 所需的 endpoint/credential 快照；parser 本身不读文件、不写数据库、不操作 runtime。

### 5.3 Display Endpoint

NoBrand 的 `advertise_host` / `advertise_port` 是客户端真正应连接的地址，优先于后台 listener。

当 NoBrand 使用 `advertise_mode=auto` 或 Mieru 用户没有自定义 display endpoint 时，必须由 Agent 提供当前主机可验证的公网地址；没有可靠公网地址就 skip，不用 `0.0.0.0`、localhost 或猜测地址代替。

### 5.4 显式导入 external endpoint

管理员选择一个已发现节点后，ForwardX 才创建/更新 `runtimeMode=external` 的协议端点。

规则：

- ForwardX 保存自己订阅所需的 endpoint/credential 快照；
- 不把 external endpoint 下发到 ForwardX managed runtime；
- ForwardX 删除“导入记录”不等于删除 NoBrand 节点；
- NoBrand 删除节点后，ForwardX 只标记 provider drift / unavailable，不自行重建；
- refresh 使用稳定 source key 去重，不拿显示名称当唯一主键。

## 6. Provider identity

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

稳定外部标识当前定义：

```text
mieru:<instance_id>:tcp|udp
snell:<instance_id>
hysteria2:default
vless-sudoku:default   # 仅用于报告 skip/drift，当前不导入
```

## 7. NoBrand delegated actions（第二阶段，默认关闭）

只有只读 Provider 稳定后，才考虑由 ForwardX Agent 调用 NoBrand 正式 CLI，例如安装/重启/删除某个 NoBrand-owned 实例。

如果实现，必须满足：

1. 全程调用 `nobrand ...`，不直接改 NoBrand state/config；
2. 请求必须标记 `provider=nobrand`，与 ForwardX managed runtime 互斥；
3. 每次 destructive action 前做 ownership 检查；
4. ForwardX 只记录 action/result，不宣称自己拥有底层资源；
5. NoBrand CLI 失败时不执行“第二套修复逻辑”；
6. 卸载/删除必须明确提示会作用于 NoBrand-owned 资源。

## 8. 订阅策略

NoBrand Provider 的价值是把现有 NoBrand 节点纳入 ForwardX 的稳定用户订阅，而不是再创造第二条订阅体系。

支持原则：

- 能无损表示为 ForwardX 已支持格式的 external 节点，可进入现有 access-feed；
- 不能无损表达的协议/参数，不允许静默降级；
- NoBrand 的 Display Endpoint 应作为客户端地址，真实 listener 仅用于 provider health；
- ForwardX 不把“节点导入成功”等同于“链路由 ForwardX 计量”。external 流量能力必须如实显示。

## 9. P2-0 验收

首版完成的定义：

1. Agent 能识别精确 NoBrand schema v3 ownership；
2. 只读获取受支持的 v3 状态内容，不执行 shell state；
3. parser 能无损发现 Mieru / Snell / Hysteria2，并报告 unsupported / malformed / lossy 状态；
4. Mieru traffic-pattern 或 Low Entropy 无法无损表达时必须 skip，不输出错误客户端参数；
5. 选择一个节点后能显式导入为 ForwardX external endpoint；
6. refresh 按稳定 source key 更新，不重复创建 endpoint；
7. NoBrand 节点停止/删除后能显示 drift；
8. 删除 ForwardX 导入记录不会删除 NoBrand runtime；
9. 普通 ForwardX managed Mieru/Mihomo/Xray desired state 完全不受影响；
10. 统一订阅只输出客户端确实支持的完整参数；provider 不把 external 流量伪装成 ForwardX managed 流量。

## 10. 当前结论

**GO：schema v3 只读 NoBrand Provider + external import PoC。**

**BLOCKED：任何 NoBrand runtime 写操作、自动 install/reconfigure/delete，以及在 ownership 验收前开放一键删除/卸载。**
