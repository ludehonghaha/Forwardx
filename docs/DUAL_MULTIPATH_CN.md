# ForwardX Dual / singbox-multipath 设计与 PoC 边界

> 状态：P1-0A 架构结论完成；允许进入 P1-0B 灰度 PoC，禁止直接生产启用。

## 1. 上游基线

ForwardX 的 Dual 聚合实验以 `WuSiYu/singbox-multipath` 为唯一 PoC 上游，当前固定参考：

- branch: `multipath-poc3`
- commit: `1c36787d956d750f2ee58d73710d8006a11ccf2c`
- protocol generation: strict v4

这是实验性 sing-box fork，不等同于 Linux kernel MPTCP。

## 2. 能力边界

`multipath` 在一个逻辑 TCP 字节流下使用恰好两条可靠 child outbound：

1. leg 0：首选、低延迟、稳定线路，例如专线 / WireGuard / 可绑定专用接口的直连路径；
2. leg 1：第二条容量线路，例如公网 Hysteria2；
3. 默认先走 leg 0；达到速率、累计字节或队列阈值后，leg 1 才参与数据面；
4. UDP 不聚合，只委托给指定 child outbound；
5. multipath 自身不提供认证或加密，底层路径必须自行提供可信或认证边界。

因此 ForwardX 不把 Dual 当作第五种普通代理协议，而把它建模为“由现有路径组成的聚合线路”。

## 3. ForwardX 架构约束

### 3.1 不修改普通协议类型

不得把 `multipath` 塞进 `ProtocolType`。现有 Reality、Mieru、Hysteria2、Shadowsocks 等普通协议订阅和运行时保持独立。

### 3.2 独立数据模型

P1-0B 计划新增独立模型：

- `aggregate_lines`
  - 聚合线路本体
  - 名称、运行主机、监听地址/端口、启用状态
  - 上游版本/commit pin
  - activation / queue / chunk / replay 等调度参数
  - production gate 状态
- `aggregate_legs`
  - 每条 aggregate line 恰好两行
  - `legIndex` 只能为 0/1
  - 引用现有可验证路径，而不是复制节点凭据
  - 标记 preferred / UDP fallback / 预期带宽权重

数据库层必须保证同一 aggregate line 不出现重复 legIndex；业务层必须拒绝少于或多于两条 leg。

### 3.3 独立运行时

- 每个 AggregateLine 一个独立 singbox-multipath 进程 / systemd service；
- 不复用 `forwardx-mihomo`、`forwardx-mita`、Xray 或普通 GOST runtime；
- 配置先写临时文件、执行配置校验，再原子替换；
- apply 失败必须保留上一份可工作的配置；
- Agent desired-state 只在 feature gate 明确开启时下发；
- 删除/停用最后一条 aggregate line 后清理对应独立服务，不影响普通协议。

### 3.4 独立订阅

Dual 必须输出专用的 sing-box/multipath 客户端配置，不得伪装成普通 Mihomo 节点，也不得改变现有统一订阅 URL 的语义。

普通统一订阅继续只输出客户端本身原生支持的协议节点。只有明确支持该实验 fork 的客户端才允许领取 Dual 配置。

## 4. P1-0B 首个 PoC 默认参数

第一轮只追求验证路径，不追求最终最优参数：

```json
{
  "activation_threshold_mbps": 120,
  "activation_window": "1s",
  "chunk_size": 65536,
  "queue_frames": 256,
  "bandwidth_mbps": [160, 700],
  "leg1_replay_timeout": "5s",
  "tcp_fast_open": true
}
```

参数必须可配置；上面只是符合当前上游示例/实验目标的起点。

## 5. P1-0B 灰度验收矩阵

只有以下项目全部通过，才允许讨论生产 gate：

1. **小流量择优**：网页/短连接只使用 leg 0，不无故拉起 leg 1；
2. **大流量聚合**：单 TCP 流达到阈值后 leg 1 加入，吞吐高于单 leg 0；
3. **回落**：流量降低后不会长期无意义占用 leg 1；
4. **leg 1 故障**：第二路中断时，已有逻辑连接按上游 replay 语义可继续或在可接受范围内恢复；
5. **leg 0 故障**：明确记录行为，不能假设与 leg 1 故障对称；
6. **重排/抖动**：高 RTT 差、丢包情况下不得出现不可接受的卡死或内存持续增长；
7. **UDP**：确认只走配置的 `udp_outbound`，不宣称 UDP 聚合；
8. **资源占用**：记录 CPU、RSS、队列与重排缓冲峰值；
9. **客户端兼容**：只允许安装了同一协议代际 fork 的客户端；普通 sing-box / Mihomo 应被明确判定为不兼容，而不是生成错误订阅；
10. **回滚**：停用 Dual 后普通 ForwardX 转发和普通统一订阅完全不受影响。

## 6. 生产阻断条件

以下任一项存在时，Dual 必须保持 Experimental：

- 上游协议代际继续变更且没有稳定兼容承诺；
- 客户端没有可维护的二进制分发方式；
- leg 故障语义未实机验证；
- 单 TCP 聚合收益不足以抵消 CPU / 重排 / 运维成本；
- ForwardX 还不能做到一键回滚且不影响普通协议运行时。

## 7. 当前结论

**GO：进入 P1-0B 单机灰度 PoC。**

**BLOCKED：生产默认启用。**

下一实施步应先做独立 AggregateLine/Leg 的最小数据模型和配置编译器，再接 Agent runtime；不要先改普通协议订阅或现有 ProtocolType。
