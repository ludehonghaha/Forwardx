from pathlib import Path

root = Path(__file__).resolve().parent

pkg_path = root / "package.json"
pkg = pkg_path.read_text()
old_pkg = '"version": "2.3.280"'
new_pkg = '"version": "2.3.281"'
if new_pkg not in pkg:
    if old_pkg not in pkg:
        raise SystemExit("package.json release version anchor missing")
    pkg = pkg.replace(old_pkg, new_pkg, 1)
    pkg_path.write_text(pkg)

versions_path = root / "shared/versions.ts"
versions = versions_path.read_text()
versions = versions.replace('export const APP_VERSION = "2.3.280";', 'export const APP_VERSION = "2.3.281";', 1)
versions = versions.replace('export const ANDROID_APK_RELEASE_VERSION = "2.3.280";', 'export const ANDROID_APK_RELEASE_VERSION = "2.3.281";', 1)
if 'export const APP_VERSION = "2.3.281";' not in versions or 'export const ANDROID_APK_RELEASE_VERSION = "2.3.281";' not in versions:
    raise SystemExit("shared/versions.ts release anchors missing")
versions_path.write_text(versions)

changelog_path = root / "CHANGELOG.md"
changelog = changelog_path.read_text()
heading = "## [2.3.281] - 2026-08-23"
if heading not in changelog:
    anchor = "# Changelog\n\n"
    if not changelog.startswith(anchor):
        raise SystemExit("CHANGELOG header anchor missing")
    section = """## [2.3.281] - 2026-08-23

### 修复

- 修复 Agent 托管 Mihomo 在 `systemctl restart` 后立即只检查一次监听端口造成的启动竞态：Reality / Snell / Hysteria2 现在会在配置校验通过后等待服务与预期 TCP/UDP socket 就绪，再决定是否回滚，避免 Mihomo 已正常启动却因监听尚未完成而被错误停止。
- Mihomo 运行时测试新增 POSIX `/bin/sh` 语法覆盖，并验证就绪检测包含有限次数重试、真实 TCP/UDP socket 检查及失败退出。

### 版本

- 面板与 APK Release `2.3.281`，Agent `2.2.193`，ForwardX FXP runtime `2.2.114`，Android APP `2.3.97`。

"""
    changelog_path.write_text(anchor + section + changelog[len(anchor):])

ci_path = root / ".github/workflows/ci.yml"
ci = ci_path.read_text()
ci = ci.replace("permissions:\n  contents: write\n", "permissions:\n  contents: read\n", 1)
step = '''      - name: Apply staged v2.3.281 release metadata
        if: ${{ github.event_name == 'pull_request' && hashFiles('.ci-release-281.py') != '' }}
        run: |
          python3 .ci-release-281.py
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add -A
          if ! git diff --cached --quiet; then
            git commit -m "chore(release): v2.3.281"
            git push origin HEAD:${{ github.head_ref }}
          fi

'''
if step not in ci:
    raise SystemExit("temporary CI release step anchor missing")
ci_path.write_text(ci.replace(step, "", 1))

Path(__file__).unlink()
