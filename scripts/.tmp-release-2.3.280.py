from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"expected release text missing in {path}: {old!r}")
    p.write_text(text.replace(old, new, 1))

replace_once("package.json", '"version": "2.3.279"', '"version": "2.3.280"')
replace_once("shared/versions.ts", 'export const APP_VERSION = "2.3.279";', 'export const APP_VERSION = "2.3.280";')
replace_once("shared/versions.ts", 'export const ANDROID_APK_RELEASE_VERSION = "2.3.279";', 'export const ANDROID_APK_RELEASE_VERSION = "2.3.280";')

changelog = Path("CHANGELOG.md")
text = changelog.read_text()
marker = "# Changelog\n\n"
entry = '''## [2.3.280] - 2026-08-23

### 修复

- 修复 Agent 托管 Snell / VLESS + Reality / Hysteria2 首次安装 Mihomo 时生成的 POSIX shell 命令缺少复合命令分隔符，导致 `/bin/sh` 报 `Syntax error: "if" unexpected`、Mihomo 未下载且协议端口不监听的问题。
- 协议运行时测试新增真实 `sh -n` 语法校验，后续生成的 Mihomo 安装命令若无法被 `/bin/sh` 解析会直接在 CI 阶段失败。

### 新增

- 「协议接入」用户订阅地址增加浏览器本地生成的二维码，可直接使用支持订阅扫码的客户端导入；订阅 Token 不会发送到第三方二维码服务。

### 版本

- 面板与 APK Release `2.3.280`，Agent `2.2.193`，ForwardX FXP runtime `2.2.114`，Android APP `2.3.97`。

'''
if marker not in text:
    raise SystemExit("CHANGELOG marker missing")
changelog.write_text(text.replace(marker, marker + entry, 1))

# Restore normal CI and remove this temporary release patch before committing.
Path(".github/workflows/ci.yml").write_text('''name: CI

on:
  pull_request:
  push:
    branches:
      - main

permissions:
  contents: read

concurrency:
  group: forwardx-ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10.28.1

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: pnpm

      - name: Setup Go
        uses: actions/setup-go@v5
        with:
          go-version: "1.23.x"
          cache-dependency-path: |
            agent/go.mod
            forwardx-fxp/go.mod
            forwardx-fxp/go.sum

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Verify panel
        run: |
          pnpm check:versions
          pnpm exec tsc --noEmit
          node --import tsx --test server/agentCrypto.test.ts
          pnpm test:protocol-access
          pnpm test:server
          pnpm build
          pnpm docs:build

      - name: Verify Agent and FXP
        run: |
          (cd agent && go test ./... && go vet ./...)
          (cd forwardx-fxp && go test ./... && go vet ./...)
''')
Path("scripts/.tmp-release-2.3.280.py").unlink()
