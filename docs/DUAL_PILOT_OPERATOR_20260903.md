# ForwardX Dual Pilot 操作手册（2026-09-03）

> 状态：实验 Pilot。`readyToDeploy=false` / `productionReady=false`。
>
> 已证明：单 TCP 会话可以先走 Mieru leg0，随后由 HY2 leg1 加入同一 multipath session。
>
> 未关闭阻塞：256 MiB 长流 / 重复会话仍存在提前终止问题。

## 1. 安全边界

Pilot 必须保持以下边界：

- 不修改生产 Mita `11464` 的配置、用户或进程。
- 不创建或修改现有 HY2；继续复用已经验证的 HY2 runtime。
- 不修改 `systemd`、防火墙、系统默认路由、OpenClash 或生产数据库。
- Server multipath 只监听 `127.0.0.1:39000`。
- Pilot Mita 使用独立端口、独立 JSON、独立 `MITA_UDS_PATH`、独立用户，并只给该 Pilot 用户 `allowLoopbackIP=true`。
- `tcp_fast_open=false`。
- 面板只允许向已明确选择的在线 ForwardX Agent 下发 `start` / `stop` / `status` 三种固定动作；请求中不存在 executable、path、role、shell 或自由参数。

## 2. 离线准备（不要把 secret 放进 Git）

所有真实凭据文件和 materialized 输出必须位于 ForwardX 仓库之外。

使用：

```bash
pnpm exec tsx scripts/materialize-dual-existing-hy2-pilot-local.ts \
  <outside-repo-output-dir> \
  <verified-pilot-mieru-endpoint.json> \
  <verified-existing-hy2-discovery.json> \
  <hy2-auth-file> \
  <hy2-obfs-password-file> \
  <mieru-username-file> \
  <mieru-password-file>
```

必须得到至少：

- `server-gray.json`
- `mita-pilot.json`
- `dual-test.json`
- `mieru-gray.json`
- `materialization-metadata.json`

materializer 会在输出前拒绝误用受保护的生产 Mita 端口。

## 3. 构建 pinned Linux amd64 multipath artifact

```bash
bash scripts/build-dual-linux-sidecar.sh <outside-repo-artifact-dir>
```

构建来源固定为：

- `WuSiYu/singbox-multipath`
- commit `1c36787d956d750f2ee58d73710d8006a11ccf2c`
- 必须包含 `with_quic` build tag

不要使用系统自带普通 sing-box 替换这个 artifact。

## 4. Server Pilot 一次性安装

把以下内容放到 7CM Dual 上的临时工作目录：

- 当前分支的 `scripts/run-dual-pilot.sh`
- 当前分支的 `scripts/install-dual-pilot-server.sh`
- materialized config 目录
- built artifact 目录

然后只执行安装：

```bash
bash scripts/install-dual-pilot-server.sh <materialized-config-dir> <built-artifact-dir>
```

安装器只会写入 Pilot 专用位置：

- `/usr/local/lib/forwardx/dual-pilot/run-dual-pilot.sh`
- `/usr/local/lib/forwardx/dual-pilot/artifacts/sing-box-linux-amd64`
- `/etc/forwardx/dual-pilot/server-gray.json`
- `/etc/forwardx/dual-pilot/mita-pilot.json`
- `/var/lib/forwardx-agent/dual-pilot/`

安装器最后只执行 `server validate`，**不会启动任何 Pilot 进程**。

如果发现：

- `tcp_fast_open=true`
- server listener 不是 `127.0.0.1:39000`
- Pilot Mita 没有 `allowLoopbackIP=true`
- Pilot Mita 端口等于受保护的 `11464`
- pinned sing-box `check` 失败
- Mita 不可执行
- 已有 Pilot PID 仍存活

则安装直接失败。

## 5. 面板操作

进入 **Dual 聚合 → 服务端 Pilot**：

1. 手动选择真实的 7CM Dual ForwardX Agent。不要根据 IP 或客户端 Host 猜测。
2. 先点 **检查状态**。
3. Agent 在线且 runtime 已安装后，才点 **启动 Pilot**。
4. 结果通过现有加密 Agent 通道回传。
5. 需要停止时点 **停止 Pilot**。

Agent 端只执行固定命令形状：

```text
/usr/local/lib/forwardx/dual-pilot/run-dual-pilot.sh \
  server <start|stop|status> \
  /etc/forwardx/dual-pilot \
  /usr/local/lib/forwardx/dual-pilot/artifacts \
  /var/lib/forwardx-agent/dual-pilot
```

不存在 `sh -c`，也不会接受面板提供自定义路径或额外参数。

## 6. Pilot 启动后的验证顺序

在长流阻塞修复前只做受控 Gray/Pilot 验证：

1. `status` 确认 Server sing-box 与 Pilot Mita 都属于 Pilot runtime。
2. 小流量验证：1 MiB，新连接应保持 leg0/Mieru 私网优先，leg1/HY2 不参与 payload。
3. 中等流量验证：64 MiB、单 HTTP/1.1 TCP connection，确认 `NUM_CONNECTS=1`，leg1 在同一 session 后加入。
4. 检查 fatal / replay / unrecoverable reorder / unexpected reconnect。
5. 验证结束后停止 Pilot。

## 7. 当前禁止事项

在 256 MiB 长流、重复连接和 soak 尚未通过前：

- 不设 `readyToDeploy=true`。
- 不自动部署生产。
- 不自动启动 Pilot。
- 不生成“生产已就绪”的订阅入口。
- 不合并 PR #60 到 main。
- 不把实验 Pilot 变成 systemd 常驻服务。

下一阶段仍然是 P1-E3：定位并修复 256 MiB 长流 / repeated-session premature termination，然后执行长流与 soak 回归矩阵。
