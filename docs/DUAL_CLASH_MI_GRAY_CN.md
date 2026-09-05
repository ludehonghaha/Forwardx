# ForwardX Dual：Clash Mi + Android Mobile Gray 验证

> 当前状态：只准备离线验证材料，不部署、不启动 runtime、不修改现有 Mita / Clash Mi。

## 为什么先做手机 Gray

OpenClash 是最终家庭入口，但不是验证 multipath 聚合本身的前置条件。

公司场景下可以先使用 Android + Clash Mi：

```text
Android 应用流量
      ↓
Clash Mi 测试节点 / 本地入口
      ↓
127.0.0.1:<sidecar ingress>
      ↓
singbox-multipath Android sidecar
      ├─ leg0 → 127.0.0.1:<Clash Mi dedicated SOCKS> → 单一纯 Mieru
      └─ leg1 → native Hysteria2 → Dual 公网侧
      ↓
Dual server loopback multipath listener
```

Clash Mi / Mihomo 本身不实现实验性 `multipath` outbound。真正的聚合逻辑在 pinned `WuSiYu/singbox-multipath` sidecar 中；Clash Mi 只提供 private Mieru leg 的 dedicated SOCKS bridge，以及后续用户侧入口。

## 与正式 v5 clientTarget 的关系

手机只是一次性 Gray 验证器，不是正式 OpenWrt client。

因此 Mobile Gray bundle：

- 不读取或信任 `draft.clientTarget`；
- 不产生 `DualClientDiscoverySnapshot`；
- 不写 port planning evidence；
- 不把 Android 设备保存成 `forwardx-host` 或 `external-openwrt`；
- 不影响以后 OpenWrt 的正式 discovery / evidence。

## Android artifact

ForwardX 只接受固定上游：

- repository: `WuSiYu/singbox-multipath`
- commit: `1c36787d956d750f2ee58d73710d8006a11ccf2c`
- platform: Android
- architecture: arm64
- required build tag: `with_quic`

`scripts/build-dual-android-sidecar.sh` 按上游自己的 Android arm64 NDK 构建方式编译，并输出：

```text
sing-box-android-arm64
sing-box-android-arm64.sha256
build-metadata.json
```

CI artifact 只是测试二进制，不代表 runtime 已被批准部署。

## Mobile Gray bundle

`server/dualMultipathMobileGrayBundle.ts` 只生成脱敏 preview：

- Android sidecar sing-box client config；
- Clash Mi dedicated SOCKS listener fragment；
- server loopback multipath inbound fragment；
- Hysteria2 server runtime skeleton；
- blockers / safety flags。

所有 secret 都只保留 `dual.*` reference，输出中不会包含真实密码、TLS private key 或订阅内容。

## 真机测试前仍必须完成

1. Android 本地两个测试端口只读确认未占用；
2. 确认 Clash Mi 内只有一个用于 private leg 的纯 Mieru proxy；
3. 确认 sidecar/Termux 进程绕过 Clash Mi TUN，避免 HY2 leg 被再次捕获；
4. Gray HY2 server port / TLS / auth secret；
5. Android binary SHA256 evidence；
6. 完整 client/server `sing-box check`；
7. Dual server Gray lifecycle、健康检查与回滚。

在这些门禁完成前：

```text
readyForRuntime = false
```

## 本轮明确不做

- 不安装 Android binary；
- 不启动 Termux sidecar；
- 不改 Clash Mi 配置；
- 不部署 Dual server；
- 不启动 Hysteria2；
- 不修改 Mita；
- 不写 systemd / firewall / route；
- 不调用 Agent；
- 不写 production DB；
- 不合并 PR #60。
