# ForwardX Dual：Windows + Server Gray 验证

> 这一层只用于真实聚合前的隔离 Gray 验证。它不写 v5 clientTarget、不部署、不修改现有 Mita。

## Windows 测试结构

Windows 版 `singbox-multipath` 不包含 Mieru 协议实现，因此专线腿不能直接写成 `type: mieru`。

```text
Windows 应用 / 浏览器
        ↓
127.0.0.1:<Dual Gray SOCKS>
        ↓
pinned singbox-multipath.exe
        ├─ leg0 → 127.0.0.1:<Mihomo dedicated SOCKS> → 唯一纯 Mieru
        └─ leg1 → native Hysteria2 → Dual 公网 IP
        ↓
      multipath
        ↓
Dual server 127.0.0.1:39000
```

Mihomo/Clash 只负责把 leg0 固定到现有 Mieru；HY2 与 multipath 都由 pinned `singbox-multipath` 运行。

## 服务端 Gray

服务端不改现有 Mita：

- 现有 Mita listener 保持原端口并 `preserve`；
- 新增 Gray HY2，只绑定 discovery 得到的公网地址；
- multipath inbound 继续只监听 `127.0.0.1:39000`；
- HY2/Mieru 两条 carrier 最终都把 multipath transport 送到该 loopback listener。

Gray HY2 使用独立新端口，不能复用 Mita 端口或 multipath 端口。

## TLS

为了先验证“聚合机制本身”，离线 Gray harness 支持明确的 `self-signed-gray` 模式：

- CI 生成一次性自签证书；
- Gray client 明确 `insecure: true`；
- 该模式只允许 Gray 测试，`productionTlsApproved=false`；
- 正式 runtime 仍必须走真实 TLS secret resolver / certificate evidence。

## CI 真实配置检查

CI 会：

1. 固定上游 commit `1c36787d956d750f2ee58d73710d8006a11ccf2c` 构建 Linux amd64 binary；
2. 生成一次性自签证书；
3. 使用与生产代码同一个 TypeScript bundle builder 生成 Windows/server Gray fixture；
4. 使用 pinned binary 对两份 JSON 执行 `sing-box check`；
5. 上传 Linux binary、SHA256 和 build metadata。

CI fixture 只含 `<secret:dual.hy2.auth>` 引用，不含真实密码、订阅、证书私钥内容或设备配置。

## 真机运行前仍缺

- Windows 本地端口空闲确认；
- Windows 上实际 Mieru-capable Mihomo/Clash 以及唯一纯 Mieru proxy 名称；
- Dual 服务端 Gray HY2 UDP 端口空闲确认；
- 真实 Gray HY2 auth secret；
- Gray TLS 文件部署；
- 真实 materialized client/server `sing-box check`；
- 服务启动、健康检查和回滚。

在这些完成前始终：

```text
readyForRuntime = false
```
