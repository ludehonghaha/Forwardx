from pathlib import Path

package = Path('package.json')
s = package.read_text()
old = '"version": "2.3.278"'
new = '"version": "2.3.279"'
if s.count(old) != 1:
    raise SystemExit('package version replacement mismatch')
package.write_text(s.replace(old, new, 1))

versions = Path('shared/versions.ts')
s = versions.read_text()
for old, new in [
    ('export const APP_VERSION = "2.3.278";', 'export const APP_VERSION = "2.3.279";'),
    ('export const ANDROID_APK_RELEASE_VERSION = "2.3.278";', 'export const ANDROID_APK_RELEASE_VERSION = "2.3.279";'),
]:
    if s.count(old) != 1:
        raise SystemExit(f'version replacement mismatch: {old}')
    s = s.replace(old, new, 1)
versions.write_text(s)

changelog = Path('CHANGELOG.md')
s = changelog.read_text()
marker = '# Changelog\n\n'
section = '''## [2.3.279] - 2026-08-23

### 新增

- 「协议接入」在 Agent 托管模式选择主机时自动带出该主机公网地址，优先使用已启用 DDNS 域名，其次依次使用 entryIp、IPv4、主 IP 与 IPv6；自动填入后仍可手动覆盖。
- VLESS + Reality 创建表单新增可编辑的 Reality Server Name（SNI）与 Dest。默认仍为 `www.cloudflare.com` / `www.cloudflare.com:443`，可直接替换为自选伪装目标；UUID、X25519 密钥与 Short ID 继续自动生成。

### 版本

- 面板与 APK Release `2.3.279`，Agent `2.2.193`，ForwardX FXP runtime `2.2.114`，Android APP `2.3.97`。

'''
if s.count(marker) != 1:
    raise SystemExit('changelog marker mismatch')
changelog.write_text(s.replace(marker, marker + section, 1))
