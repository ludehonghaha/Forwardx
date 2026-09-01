# ForwardX Dual：Windows + Server Gray 验证

> 仅用于离线与隔离 Gray 验证；不部署、不修改现有 Mita，`readyForRuntime=false`。

## Windows 拓扑

```text
127.0.0.1:24180
  -> pinned singbox-multipath
       leg0 -> SOCKS5 127.0.0.1:24181
                    -> ForwardX-managed official enfein/mieru client
                    -> verified client-visible Mieru ingress
                       current Gray evidence: 211.136.162.188:11464/TCP
       leg1 -> native Hysteria2 -> 87.86.22.221:61464/udp
```

`24181` 不再读取、修改或依赖 Clash Mi。现有通用 `7890` 不参与该拓扑。

`172.16.4.114` 只表示 Dual 服务端自己的 `eth1` 地址。它不是 Windows 可见入口，不能被 Mieru client config 自动引用。当前 `211.136.162.188:11464/TCP` 来自 Windows established connection 与本地只读客户端配置的交叉核验，只作为可替换的 Gray discovery evidence，不是 generic schema 常量。

## Official Mieru pin

- repository: `enfein/mieru`
- version/tag: `3.36.0` / `v3.36.0`
- commit: `155ebbd60f86e472586a60d7ffe58ec8f8682cb1`
- Windows amd64 release ZIP SHA256: `f0136fa3bbfb1489a0a41c1ef5c3aa58ecf5b4793dc51d5a813cf7f5803017d1`
- extracted `mieru.exe` SHA256: `ed9dbf733321c3010f4e3431b46f65b7d1560f6b633f79a76f33219986d9e927`
- license: GPL-3.0

Windows artifact 同时包含原始许可证与 pinned commit 的对应源码归档。后续 Linux amd64 使用官方 tarball；OpenWrt 根据实际架构选择官方 Linux arm64、armv7 或 riscv64 tarball，仍需在目标机只读发现架构后决定，不能猜测。

## Mieru 配置边界

ForwardX 独立生成每次运行专用 JSON：

- `socks5Port=24181`
- `socks5ListenLAN=false`
- `rpcPort=0`
- private carrier destination 必须来自独立的 `verified-read-only` client-visible endpoint evidence
- endpoint 未解析时 materializer fail closed；禁止从 `serverTargetDiscovery.privateSide` 或 Mita 本地 listener 推导
- username/password 只接受 `dual.mieru.username`、`dual.mieru.password` secret reference

launcher 只把 `MIERU_CONFIG_JSON_FILE=<gray config>` 注入它创建的 Mieru 子进程并执行 `mieru run`，不调用 `mieru apply config`，因此不写用户全局 Mieru 配置。

仓库外 materialization：

```bash
node --import tsx scripts/materialize-dual-gray-local.ts \
  <outside-repo-output-dir> <certificate-path> <private-key-path> \
  <verified-private-carrier-client-endpoint-file> \
  <hy2-auth-file> <mieru-username-file> <mieru-password-file>
```

生成 `mieru-gray.json`、`dual-test.json`、`server-gray.json`；它们是 `0600` 的 secret-bearing 临时文件，禁止 commit 或上传。

## Launcher 与 artifact

`forwardx-dual-windows-amd64` 包含：

- official `mieru-windows-amd64.exe`
- pinned `sing-box-windows-amd64.exe`
- PowerShell 双进程 launcher 与 `.cmd` 入口
- README、metadata、SHA256 清单
- Mieru GPL-3.0 许可证和对应源码归档

不包含 Mieru credential、HY2 auth、TLS private key 或实际配置。

launcher 先检查 `24180/24181` 空闲，再启动 Mieru并等待 `24181` ready，之后启动 multipath 并等待 `24180` ready。任一子进程失败、Ctrl+C 或 launcher 退出时，只按它保存的两个 PID 清理 Gray 子进程。它不会停止 Clash Mi、修改系统代理、网卡、服务、防火墙或路由。

## Server Gray

- existing Mita `/usr/bin/mita`、unit `mita-oneclick@uc650fd438a46ab4e.service`、TCP `*:11464` 保持 `preserve`；
- HY2 candidate 仅绑定 `87.86.22.221:61464/udp`；
- multipath 仅监听 `127.0.0.1:39000`。

## 仍然阻塞

- 用户控制的本地客户端配置中可确认 credential material 存在，但尚未通过 ForwardX Gray secret resolver 安全注入；
- client-visible ingress 必须在每次真实 Gray 前刷新 read-only evidence，不能把当前观察值当作永久稳定地址；
- Windows 真机端口、官方 Mieru 启动、双进程清理尚未实机验收；
- server Gray 尚未获准部署，HY2/TLS/auth、网络可达性、健康检查和回滚尚未验收；
- `readyForRuntime=false`，PR 保持 Draft。
