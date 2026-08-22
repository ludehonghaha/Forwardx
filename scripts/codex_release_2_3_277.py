from pathlib import Path

pkg = Path("package.json")
text = pkg.read_text()
old = '"version": "2.3.276"'
if text.count(old) != 1:
    raise SystemExit(f"package version anchor count={text.count(old)}")
pkg.write_text(text.replace(old, '"version": "2.3.277"', 1))

versions = Path("shared/versions.ts")
text = versions.read_text()
replacements = {
    'export const APP_VERSION = "2.3.276";': 'export const APP_VERSION = "2.3.277";',
    'export const ANDROID_APK_RELEASE_VERSION = "2.3.276";': 'export const ANDROID_APK_RELEASE_VERSION = "2.3.277";',
}
for old, new in replacements.items():
    if text.count(old) != 1:
        raise SystemExit(f"versions anchor {old!r} count={text.count(old)}")
    text = text.replace(old, new, 1)
versions.write_text(text)

changelog = Path("CHANGELOG.md")
text = changelog.read_text()
anchor = "## [2.3.276]"
if text.count(anchor) != 1:
    raise SystemExit(f"changelog anchor count={text.count(anchor)}")
section = '''## [2.3.277] - 2026-08-23

### 新增

- 「协议接入」新增 Agent 托管 Snell、VLESS + Reality、Hysteria2，三种入口协议在同一主机共用一个 `forwardx-mihomo` 运行时。
- 托管 Reality 自动生成 UUID、X25519 密钥与 Short ID；Hysteria2 自动管理凭据和证书；统一订阅支持多协议节点并避免重复用户模型。

### 修复与优化

- Agent 升级到 `2.2.193`，增加 `forwardx-mihomo` 服务、配置和 TCP/UDP 监听状态上报及周期自愈；Mihomo 故障不会连带影响既有 GOST/Nginx 转发运行态。
- 新入口协议只有在 Agent 实际确认服务与监听就绪后才显示“运行正常”，并保留 Shadowsocks → GOST、Mieru → `forwardx-mita`、Realm/GOST/FXP 中转的既有架构。
- 面板与 Agent 发布继续使用单一现有流水线，不新增重复 Agent 编译链。

### 版本

- 面板与 APK Release `2.3.277`，Agent `2.2.193`，ForwardX FXP runtime `2.2.114`，Android APP `2.3.97`。

'''
changelog.write_text(text.replace(anchor, section + anchor, 1))
