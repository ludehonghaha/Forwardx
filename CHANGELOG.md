# Changelog

## [2.3.291] - 2026-09-01

### 修复与优化

- 修复托管 VLESS + Reality / Xray 实际监听正常时，Agent 将 Xray 端口错误归类为 GOST，导致面板显示“TCP 监听未就绪”的问题。
- Xray 现在拥有独立的 runtime ports、protocols 与 readiness 状态，并仅使用 Xray / forwardx-xray 监听进程判断健康状态。
- 防止 GOST 与 Xray 在相同端口时互相冒充健康；IPv6 `[::]` 双栈监听继续正确识别。

### 版本

- 面板与 APK Release `2.3.291`，Agent `2.2.198`，ForwardX FXP runtime `2.2.114`，Android APP `2.3.97`。

## [2.3.290] - 2026-09-01

### 修复与优化

- 修复混合 IPv4 / IPv6 用户订阅中，只要任一已分配端点没有 `hosts.ipv6` 就会让整个 `ipVersion=6` 订阅返回 `422`、导致 Shadowrocket 提示“服务器 URL 遇到问题”的问题。
- `ipVersion=6` 现在只输出具备真实 IPv6 的端点；IPv4-only 端点会被跳过且绝不回退 IPv4。若该用户没有任何可用 IPv6 端点，仍明确返回 `422`。
- `X-ForwardX-Skipped-Entries` 会计入因缺少 IPv6 被跳过的端点，并补充混合双栈/IPv4-only 的 URI、Mihomo 隔离灰度与单元测试覆盖。

### 版本

- 面板与 APK Release `2.3.290`，Agent `2.2.197`，ForwardX FXP runtime `2.2.114`，Android APP `2.3.97`。

## [2.3.289] - 2026-09-01

### 新增

- 「协议接入」订阅地址新增 IPv4 / IPv6 手动选择，默认继续使用 IPv4；同一订阅可显式请求 `ipVersion=4` 或 `ipVersion=6`。
- IPv6 订阅从协议端点关联主机的 `hosts.ipv6` 读取真实地址，URI 自动使用 `[IPv6]:端口`，Mihomo/OpenClash 输出对应 IPv6 `server`。

### 修复与优化

- 主机没有可用 IPv6 时返回明确错误并禁止静默回退 IPv4；非法 `ipVersion` 请求同样显式拒绝。
- 增加隔离 dev-panel 灰度 smoke 和 CI 覆盖，验证默认 IPv4、显式 IPv4/IPv6、URI IPv6 括号、Mihomo IPv6、422 no-fallback 和非法参数。

### 版本

- 面板与 APK Release `2.3.289`，Agent `2.2.197`，ForwardX FXP runtime `2.2.114`，Android APP `2.3.97`。

## [2.3.288] - 2026-08-30

### 新增

- 新增 NoBrand Provider 完整接入：ForwardX Agent 只读扫描 NoBrand-OneClick v3 固定状态目录，面板可查看 Mieru、Snell、Hysteria2 候选节点并显式选择导入。
- NoBrand 节点以 `external` 端点导入，支持稳定去重并继续复用 ForwardX 现有用户分配与统一订阅；ForwardX 不接管、不重启、不删除 NoBrand 运行时。
- 「协议接入」新增管理员 NoBrand Provider 扫描/选择/导入界面；普通 TLS VLESS Sudoku 等无法无损映射的节点继续 fail closed，不会错误转换为 Reality。

### 修复与优化

- Hysteria2 URI 与 Mihomo 订阅显式输出 `h3` ALPN，保持与服务端监听配置一致并提高客户端互操作性。
- NoBrand 扫描结果与凭据仅短暂保存在面板内存中，导入前重新校验 ownership、候选有效性和重复状态；扫描本身不写协议数据库。

### 版本

- 面板与 APK Release `2.3.288`，Agent `2.2.197`，ForwardX FXP runtime `2.2.114`，Android APP `2.3.97`。

## [2.3.287] - 2026-08-30

### 修复与优化

- 修复托管 Hysteria2 生成 `ignore-client-bandwidth: true` 时客户端认证、延迟测试和实际联网异常的问题；现改为显式生成 `false`，并加入回归测试，实机 A/B 已验证恢复正常。

### 开发与设计

- 完成 Dual / `singbox-multipath` 的 P1-0A 边界设计，并加入隔离的 P1-0B 配置编译器；固定上游 `multipath-poc3` commit，严格区分 outbound/inbound 字段并增加数值与内存边界校验。当前仍未接入生产 runtime、数据库、UI 或统一订阅。
- 明确 NoBrand Provider 首版 ownership：只读发现并导入 external 节点，禁止 ForwardX 与 NoBrand 同时管理同一 runtime；同步托管 Mieru 多用户语义文档。

### 版本

- 面板与 APK Release `2.3.287`，Agent `2.2.196`，ForwardX FXP runtime `2.2.114`，Android APP `2.3.97`。

## [2.3.286] - 2026-08-29

### 修复与优化

- 修复 Release Agent 仅比较紧邻 `main` 提交、可能漏掉上一正式 Release 之后已合入 Agent 源码变更的问题；现在以最近一个具备完整可复用 Agent 资产的正式 Release 为基线累计检测构建输入。
- 重新构建与当前源码一致的 Agent `2.2.196` 发布资产，替代 `v2.3.285` 中误复用的旧 Agent 打包结果。

### 版本

- 面板与 APK Release `2.3.286`，Agent `2.2.196`，ForwardX FXP runtime `2.2.114`，Android APP `2.3.97`。

## [2.3.285] - 2026-08-29

### 新增

- 托管 VLESS + Reality 改由 Xray `settings.clients` 在同一监听端口承载多个 ForwardX 用户，并为每个分配维护稳定、独立的 UUID 与 Xray 用户身份。
- Agent 读取 Xray StatsService 原生 per-user 流量统计，并将各分配的上下行流量严格一次写入对应 ForwardX 协议流量 bucket。

### 修复与优化

- 修复加密 `/api/sync` 上报在中间件与路由层重复执行协议流量计量的问题，确保同一报告只入账一次。
- 修复 Reality 分配新增、删除、启用或停用后未强制推进配置 revision 并刷新 Agent 的问题。
- 托管 Reality 停用旧的单 owner traffic bridge，统一使用 Xray 原生多用户计量；其他非原生计量协议继续保留单 owner 保护。

### 版本

- 面板与 APK Release `2.3.285`，Agent `2.2.196`，ForwardX FXP runtime `2.2.114`，Android APP `2.3.97`。

## [2.3.284] - 2026-08-27

### 新增

- 托管 Mieru 支持同一端点、同一监听端口分配给多个 ForwardX 用户，并为每个分配自动维护独立用户名与密码；首个既有用户可平滑继承旧凭据，避免迁移中断。
- Mita 单运行时可同时下发多个用户，Agent 读取 Mieru 原生 per-user metrics 并按用户独立累计流量、更新 `trafficUsed` 与协议流量 bucket。
- 用户启用、停用、到期或超限只影响对应 Mieru 用户，不会重建端点或影响同端口其他用户；重新启用后保留原独立凭据。

### 修复与优化

- 修复 Mieru Reporter 未继承 Mita UDS 环境变量导致无法读取真实 per-user metrics 的问题。
- 修复协议流量 claim 与 legacy traffic claim 共用原始 reportId 引发唯一约束冲突、HTTP ACK 失败和 pending 重试的问题；legacy claim 使用独立命名空间并保持旧 pending 幂等恢复。
- 修复托管 Mieru 用户启用/停用时前端错误回传用户名与密码、被后端凭据保护拒绝的问题；托管凭据继续只由 ForwardX 自动管理。

### 版本

- 面板与 APK Release `2.3.284`，Agent `2.2.195`，ForwardX FXP runtime `2.2.114`，Android APP `2.3.97`。

## [2.3.283] - 2026-08-25

### 修复与优化

- 修复 Agent 通过加密 `/api/sync` 隧道上报 `/api/agent/network-quality` 时被明确路径白名单拒绝的问题，并将已在生产验证通过的 network-quality 修复固化为正式版本。
- 增加未知加密同步路径的负向回归保护，确保未列入 `AGENT_TUNNEL_PATHS` 的路径继续返回 `400 Invalid encrypted request`，不扩大 `/api/sync` 权限边界。

### 版本

- 面板与 APK Release `2.3.283`，Agent `2.2.194`，ForwardX FXP runtime `2.2.114`，Android APP `2.3.97`。

## [2.3.282] - 2026-08-24

### 新增

- 主机管理新增默认网络质量监控：ForwardX Agent 复用现有 Agent → Panel Presence 出站请求采集 RTT，并按 5 个真实请求样本聚合延迟和丢包率；无需管理员预先创建 Probe Service，兼容 NAT 与无公网入站 Agent。
- 主机卡片直接展示当前延迟与丢包率，主机网络质量图表支持 1H / 6H / 24H / 7D，并同时展示延迟、丢包率和成功/失败样本。
- 现有 Ping/TCPing 服务探测保留为高级探测，并补充成功数、失败数和丢包率历史；旧历史无丢包字段时保持为空，不会误显示为 100%。

### 修复与优化

- 默认网络质量仅将真实完成的 Presence 请求失败计入丢包；单飞锁跳过、被新请求取消或无数据不会被当成丢包。
- 新增 `host_network_quality_stats` 并扩展探测历史字段，复用现有数据库 migration 与历史清理机制，默认网络质量历史保留 7 天。

### 版本

- 面板与 APK Release `2.3.282`，Agent `2.2.194`，ForwardX FXP runtime `2.2.114`，Android APP `2.3.97`。

## [2.3.281] - 2026-08-23

### 修复

- 修复 Agent 托管 Mihomo 在 `systemctl restart` 后立即只检查一次监听端口造成的启动竞态：Reality / Snell / Hysteria2 现在会在配置校验通过后等待服务与预期 TCP/UDP socket 就绪，再决定是否回滚，避免 Mihomo 已正常启动却因监听尚未完成而被错误停止。
- Mihomo 运行时测试新增 POSIX `/bin/sh` 语法覆盖，并验证就绪检测包含有限次数重试、真实 TCP/UDP socket 检查及失败退出。

### 版本

- 面板与 APK Release `2.3.281`，Agent `2.2.193`，ForwardX FXP runtime `2.2.114`，Android APP `2.3.97`。

## [2.3.280] - 2026-08-23

### 修复

- 修复 Agent 托管 Snell / VLESS + Reality / Hysteria2 首次安装 Mihomo 时生成的 POSIX shell 命令缺少复合命令分隔符，导致 `/bin/sh` 报 `Syntax error: "if" unexpected`、Mihomo 未下载且协议端口不监听的问题。
- 协议运行时测试新增真实 `sh -n` 语法校验，后续生成的 Mihomo 安装命令若无法被 `/bin/sh` 解析会直接在 CI 阶段失败。

### 新增

- 「协议接入」用户订阅地址增加浏览器本地生成的二维码，可直接使用支持订阅扫码的客户端导入；订阅 Token 不会发送到第三方二维码服务。

### 版本

- 面板与 APK Release `2.3.280`，Agent `2.2.193`，ForwardX FXP runtime `2.2.114`，Android APP `2.3.97`。

## [2.3.279] - 2026-08-23

### 新增

- 「协议接入」在 Agent 托管模式选择主机时自动带出该主机公网地址，优先使用已启用 DDNS 域名，其次依次使用 entryIp、IPv4、主 IP 与 IPv6；自动填入后仍可手动覆盖。
- VLESS + Reality 创建表单新增可编辑的 Reality Server Name（SNI）与 Dest。默认仍为 `www.cloudflare.com` / `www.cloudflare.com:443`，可直接替换为自选伪装目标；UUID、X25519 密钥与 Short ID 继续自动生成。

### 版本

- 面板与 APK Release `2.3.279`，Agent `2.2.193`，ForwardX FXP runtime `2.2.114`，Android APP `2.3.97`。

## [2.3.278] - 2026-08-23

### 新增

- Agent 托管协议端点新增服务端自动端口分配。新建托管 Snell、VLESS + Reality、Hysteria2 等端点时默认自动选择主机允许范围内的空闲端口，并保持公网端口与 Agent 监听端口一致。
- 自动端口分配复用 ForwardX 现有端口策略与预约锁，避开转发规则、协议端点、并发预约以及 Agent 已上报的真实监听；需要固定端口时仍可切换为手动高级设置。

### 修复与优化

- 修复自动分配候选端口在并发期间临时变为占用时重复选择同一端口的问题，失败候选会加入本次排除集后继续寻找下一可用端口。
- 调整发布流水线：普通 `main` 构建只发布 `main` 与提交 SHA 灰度镜像，正式 `vX.Y.Z` 与 `latest` 仅由 Release 发布，避免旧版本 Docker 标签被后续提交覆盖。
- Panel-only 版本发布复用上一正式 Release 中已校验的 Agent / FXP / runtime 资产，不重新编译未变化的 Agent；只有 Agent/FXP 构建输入实际变化时才进入原有唯一 Agent 编译链。

### 版本

- 面板与 APK Release `2.3.278`，Agent `2.2.193`，ForwardX FXP runtime `2.2.114`，Android APP `2.3.97`。

## [2.3.277] - 2026-08-23

### 新增

- 「协议接入」新增 Agent 托管 Snell、VLESS + Reality、Hysteria2，三种入口协议在同一主机共用一个 `forwardx-mihomo` 运行时。
- 托管 Reality 自动生成 UUID、X25519 密钥与 Short ID；Hysteria2 自动管理凭据和证书；统一订阅支持多协议节点并避免重复用户模型。

### 修复与优化

- Agent 升级到 `2.2.193`，增加 `forwardx-mihomo` 服务、配置和 TCP/UDP 监听状态上报及周期自愈；Mihomo 故障不会连带影响既有 GOST/Nginx 转发运行态。
- 新入口协议只有在 Agent 实际确认服务与监听就绪后才显示“运行正常”，并保留 Shadowsocks → GOST、Mieru → `forwardx-mita`、Realm/GOST/FXP 中转的既有架构。
- 面板与 Agent 发布继续使用单一现有流水线，不新增重复 Agent 编译链。

### 版本

- 面板与 APK Release `2.3.277`，Agent `2.2.193`，ForwardX FXP runtime `2.2.114`，Android APP `2.3.97`。

## [2.3.276] - 2026-08-14

### 新增

- 增加管理员密码本机与容器重置命令，重置后自动吊销已有会话。
- 协议接入页面显示 Agent 配置应用、GOST TCP/UDP 监听健康和最后错误状态，复用现有心跳运行态快照。
- 协议接入支持 Agent 托管 Mieru：每台主机唯一 `forwardx-mita`、原子配置回滚及 TCP/UDP 真实监听检查，不重复编译 GOST 或按用户创建运行时。

### 修复与优化

- 加固禁用账号、双重验证、Telegram 登录、支付回调及计费和端口分配的并发安全。
- 优化端口策略、面板日志、状态缓存与 Agent/FXP 任务调度，降低高负载下的 CPU、内存和进程占用。
- 修复流量周期边界、多段端口策略、回环地址校验，以及自定义 HTML、Markdown 链接和容量显示问题。

### 版本

- 面板与 APK Release `2.3.276`，Agent `2.2.192`，ForwardX FXP runtime `2.2.114`，Android APP `2.3.97`。

## [2.3.275] - 2026-08-13

### 修复与优化

- 修复转发组故障转移按成员优先级恢复，成员恢复后自动回切到更高优先级成员。
- 修复规则离开页面后状态短暂变黄、普通用户入口域名展示不一致等问题，复用上次状态并平滑刷新。
- 增加 GitHub 加速站配置与安装/升级脚本支持，补充部署文档和升级校验。

### 版本

- 面板与 APK Release `2.3.275`，Agent `2.2.189`，ForwardX FXP runtime `2.2.113`，Android APP `2.3.97`。

## [2.3.274] - 2026-08-09

### 新增

- 支持用户同时拥有多个套餐，合并可用权益并分别展示套餐、手工额度和附加流量。

### 修复与优化

- 修复套餐到期、重置和续费后的资源回收、周期展示及 Agent 状态刷新。
- 修复 Agent/FXP 流量与连接统计，优化 UDP 缓冲回收和心跳离线重试，减少误报与内存占用。

### 版本

- 面板与 APK Release `2.3.274`，Agent `2.2.188`，ForwardX FXP runtime `2.2.113`，Android APP `2.3.97`。

## [2.3.273] - 2026-08-07

### 新增

- 端口转发、转发链和转发组增加资源限速，覆盖 GOST、ForwardX、iptables、nftables、Realm、Socat 和 Nginx。

### 修复

- 修复 Agent 离线判定和 DDNS 故障转移延迟，并为状态切换失败增加有限重试。
- 修复 ForwardX、mimic 和故障转移的监听切换、重启恢复及运行状态同步。
- 修复套餐月度重置日、下次流量周期和流量超限后规则恢复不一致。
- 修复主机探测延迟图长时间范围截断、时间轴偏移和首次打开状态错误。
- 修复 AI API Key 无法删除。

### 版本

- 面板与 APK Release `2.3.273`，Agent `2.2.187`，ForwardX FXP runtime `2.2.112`，Android APP `2.3.97`。

## [2.3.272] - 2026-08-04

### 修复

- 修复 WireGuard UDP 代理关闭时队列清理与写循环互等，避免 Agent 运行时卡死。
- 修复 nftables 旧版解析兼容、转发链放行和 MASQUERADE 失败时无回退导致的链路不通。

### 版本

- 面板与 APK Release `2.3.272`，Agent `2.2.186`，ForwardX FXP runtime `2.2.112`，Android APP `2.3.97`。

## [2.3.271] - 2026-08-04

### 修复

- 修复 Agent/FXP 流量上报在挂载路由下签名路径不完整导致持续 `401`，并修复繁忙探测任务的强制刷新丢失。
- 修复历史转发组子规则、成员引用和删除标记残留，避免规则不可见或阻塞主机删除；启动时自动修复可确认的历史数据。
- 修复隧道规则探测只收到出口结果时误报成功、首段缺失时显示旧结果，以及隧道段超时状态和总延迟展示不准确。
- 修复 WireGuard UDP 代理关闭时队列清理与写循环互等，避免 Agent 运行时卡死。
- 修复 nftables 旧版解析兼容、转发链放行和 MASQUERADE 失败时无回退导致的链路不通。

### 版本

- 面板与 APK Release `2.3.271`，Agent `2.2.186`，ForwardX FXP runtime `2.2.112`，Android APP `2.3.97`。

## [2.3.270] - 2026-08-04

### 修复

- 修复 Agent/FXP 升级或面板配置变化后复用旧进程，导致 ForwardX 隧道可转发但流量不上报。
- 修复 GOST 等进程转发短连接漏计，导致 24H 连接数长期为 `0`。
- 增加 FXP 流量上报限频诊断，并保证失败批次幂等重试。
- 修复 GOST/ForwardX UDP 会话提前关闭及重建后断流，降低高包速率开销并限制队列与分片内存。
- Agent 心跳失败采用单一有限重试队列，避免请求叠加，并在任意心跳成功后立即取消重试。
- 修复 Agent Token 删除时待清理规则误拦截，并在真实规则占用时显示所属用户。

### 版本

- 面板与 APK Release `2.3.270`，Agent `2.2.184`，ForwardX FXP runtime `2.2.112`，Android APP `2.3.97`。

## [2.3.269] - 2026-08-02

### 修复

- 修复普通用户转发组流量与连接数归属，以及 Agent/FXP 连接累计不准确。
- 修复可选访问限制和 TCP/UDP 计数链恢复导致的重复重启或计数中断。
- 修复批量导入、复制及跨组迁移的入口端口误判和并发分配冲突。
- 修复隧道转发延迟分段误显示“等待探测”和出口组文案错误。

### 版本

- 面板与 APK Release `2.3.269`，Agent `2.2.183`，ForwardX FXP runtime `2.2.111`，Android APP `2.3.97`。

## [2.3.268] - 2026-08-01

### 新增

- 增加套餐流量与按量计费流量分开统计及重置展示基线。
- 增加自定义菜单的面板路径、内嵌和新窗口打开方式。
- 补充隧道、多入口延迟分支详情和故障排查文档截图。

### 修复

- 修复 Agent/FXP 在重启、升级及 V1/V2、WireGuard、GOST 切换后的运行态恢复和监听校验。
- 修复 Agent 流量计数链恢复、规则修复时的重复清理和计数丢失，保留已有防火墙计数。
- 修复隧道、转发链和多入口探测的拓扑匹配、并发刷新、超时及旧结果串用。
- 修复延迟详情节点归属、普通用户流量展示和自定义菜单嵌入兼容性。

### 版本

- 面板与 APK Release `2.3.268`，Agent `2.2.182`，ForwardX FXP runtime `2.2.110`，Android APP `2.3.97`。

## [2.3.267] - 2026-08-01

### 修复

- 修复支付回调重新激活已关闭订单，并启用 PostgreSQL TLS 证书校验。

### 版本

- 面板与 APK Release `2.3.267`，Agent `2.2.181`，ForwardX FXP runtime `2.2.110`，Android APP `2.3.97`。

## [2.3.266] - 2026-07-30

### 新增

- 主机累计流量支持“用量修正”，可按实际用量覆盖当前统计值。

### 修复

- 修复 GOST 六种原生传输、单 UDP 规则协议和多跳中继鉴权配置。
- 修复 ForwardX FXP 切换 GOST 时旧运行态残留及认证失败，增加事务交接、失败回滚和运行态恢复。
- 修复普通用户规则列表按账号隔离，以及筛选无结果后无法返回的问题。

### 优化

- 调整主机卡片和列表快捷操作，取消瞬时流量动画，并明确 Agent Token 创建时间展示。

### 版本

- 面板与 APK Release `2.3.266`，Agent `2.2.181`，ForwardX FXP runtime `2.2.110`，Android APP `2.3.97`。

## [2.3.265] - 2026-07-30

### 修复

- 稳定 Agent 在 ForwardX V1/V2、WireGuard 与 GOST/Nginx 间切换时的运行态交接、监听就绪和失败恢复。
- 转发链支持各成员独立使用主机端口区间，并修复同步回滚、链路探测和流量归属。
- Docker 升级增加镜像与运行版本校验，避免旧实例仍在运行时误报升级成功。
- Docker 镜像改为 amd64/arm64 原生构建并验证后合并，避免 QEMU 异常导致 ARM64 镜像缺失。
- 修复隧道延迟刷新超时边界偶发重复查询。

### 版本

- 面板与 APK Release `2.3.265`，Agent `2.2.180`，ForwardX FXP runtime `2.2.110`，Android APP `2.3.96`。

## [2.3.264] - 2026-07-29

### 新增

- Nginx Stream 自定义证书支持拖放或多选上传 PEM 证书链和私钥。

### 修复

- 修复 ForwardX V1/V2 会话、队列、握手及规则替换造成的内存、连接和旧运行态回收问题。
- 修复 Nginx Stream TCP 长连接超时、入口证书处理和旧证书清理问题，补充会话诊断日志。

### 优化

- 优化大批量 ForwardX V1/V2 入口规则合并，降低 Agent 的 CPU 与 GC 压力。
- 优化 Agent Token 备注展示，并统一隧道探测超时文案。

### 验证

- 类型检查、前端构建、Agent/FXP 测试、竞态测试和 `go vet` 通过。

### 版本

- 面板与 APK Release `2.3.264`，Agent `2.2.179`，ForwardX FXP runtime `2.2.110`，Android APP `2.3.96`。

## [2.3.263] - 2026-07-29

### 修复

- 修复 ForwardX FXP 多入口及 V1/V2 混用时的运行态残留、误清理和 WireGuard peer 未就绪问题。
- 稳定转发组健康切换，避免短暂超时或面板通讯波动造成入口、DNS 和规则状态反复切换。
- 修复资源撤权、规则迁移和按量计费授权不一致的问题，并避免旧规则清理误删同端口新规则。
- 拆分端口转发与网络测试主机授权，普通用户不再看到未授权的底层主机。
- 修复域名到期或 DNS 失败引发的重复解析和运行态抖动，失败时保留最后有效地址。
- 修复 iptables、nftables、Realm、Socat、GOST、Nginx 与 ForwardX 的流量重复、串流或漏计问题。
- 减少大规则量下防火墙计数规则的扫描和重建，降低域名变化、Agent 重启时的 CPU 峰值，并兼容 Alpine/BusyBox。

### 验证

- 服务端 `427/427`、Agent/FXP 测试、类型检查、生产与文档构建均通过；未执行 Docker 构建。

### 版本

- 面板与 APK Release `2.3.263`，Agent `2.2.178`，ForwardX FXP runtime `2.2.109`，Android APP `2.3.96`.