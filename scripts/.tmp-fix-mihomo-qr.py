from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f"expected text not found in {path}: {old[:120]!r}")
    p.write_text(text.replace(old, new, 1))

# 1) Fix POSIX /bin/sh syntax: the function definition and following `if`
# must be separated by a newline/command terminator. Joining generated shell
# fragments with newlines keeps compound commands parseable.
replace_once(
    "server/protocolMihomoRuntime.ts",
    '  ].join(" ");\n}\n\nexport function mihomoServiceUnit()',
    '  ].join("\\n");\n}\n\nexport function mihomoServiceUnit()',
)

# 2) Add a real shell-parser regression check so this exact failure is caught
# in protocol-access CI without downloading or executing Mihomo.
replace_once(
    "server/protocolRuntimePlan.test.ts",
    'import assert from "node:assert/strict";\nimport test from "node:test";',
    'import assert from "node:assert/strict";\nimport { spawnSync } from "node:child_process";\nimport test from "node:test";',
)
replace_once(
    "server/protocolRuntimePlan.test.ts",
    '  const install = ensureMihomoBinaryCmd();\n  assert.match(install, new RegExp(`MetaCubeX/mihomo/releases/download/v${MIHOMO_VERSION}`));',
    '  const install = ensureMihomoBinaryCmd();\n  const shellSyntax = spawnSync("sh", ["-n", "-c", install], { encoding: "utf8" });\n  assert.equal(shellSyntax.status, 0, shellSyntax.stderr || "generated Mihomo install command must parse with /bin/sh");\n  assert.match(install, new RegExp(`MetaCubeX/mihomo/releases/download/v${MIHOMO_VERSION}`));',
)

# 3) Generate subscription QR codes locally in the browser. No feed token is
# sent to an external QR service.
replace_once(
    "client/src/pages/ProtocolAccess.tsx",
    'import { trpc } from "@/lib/trpc";\n',
    'import { trpc } from "@/lib/trpc";\nimport QRCode from "qrcode";\n',
)
replace_once(
    "client/src/pages/ProtocolAccess.tsx",
    'import { useMemo, useState } from "react";',
    'import { useEffect, useMemo, useState } from "react";',
)
old_feed = '''function FeedLink({ label, description, value }: { label: string; description: string; value: string }) {
  const copy = async () => {
    const copied = await copyTextToClipboard(value);
    copied ? toast.success(`${label}已复制`) : toast.error("复制失败，请手动选择地址");
  };
  return (
    <div className="space-y-2 rounded-lg border border-border/60 p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="flex gap-2">
        <Input readOnly value={value} className="font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
        <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={copy} aria-label={`复制${label}`}>
          <Copy className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
'''
new_feed = '''function FeedLink({ label, description, value }: { label: string; description: string; value: string }) {
  const [qrDataUrl, setQrDataUrl] = useState("");

  useEffect(() => {
    let active = true;
    if (!value) {
      setQrDataUrl("");
      return () => { active = false; };
    }
    QRCode.toDataURL(value, { width: 224, margin: 1, errorCorrectionLevel: "M" })
      .then((dataUrl) => { if (active) setQrDataUrl(dataUrl); })
      .catch(() => { if (active) setQrDataUrl(""); });
    return () => { active = false; };
  }, [value]);

  const copy = async () => {
    const copied = await copyTextToClipboard(value);
    copied ? toast.success(`${label}已复制`) : toast.error("复制失败，请手动选择地址");
  };
  return (
    <div className="space-y-2 rounded-lg border border-border/60 p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 gap-2">
          <Input readOnly value={value} className="font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
          <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={copy} aria-label={`复制${label}`}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        {qrDataUrl ? (
          <img
            src={qrDataUrl}
            alt={`${label}二维码`}
            className="h-24 w-24 shrink-0 rounded-md border bg-white p-1 sm:h-28 sm:w-28"
          />
        ) : null}
      </div>
      <p className="text-[11px] leading-4 text-muted-foreground">二维码在浏览器本地生成，可直接用支持订阅扫码的客户端扫描。</p>
    </div>
  );
}
'''
replace_once("client/src/pages/ProtocolAccess.tsx", old_feed, new_feed)

# Restore CI workflow before committing so no temporary CI machinery remains.
ci = Path(".github/workflows/ci.yml")
ci.write_text('''name: CI

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
Path("scripts/.tmp-fix-mihomo-qr.py").unlink()
