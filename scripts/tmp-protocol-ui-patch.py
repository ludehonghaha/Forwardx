from pathlib import Path

page = Path("client/src/pages/ProtocolAccess.tsx")
text = page.read_text()


def replace_once(old: str, new: str) -> None:
    global text
    if old not in text:
        raise SystemExit(f"patch target not found:\n{old[:240]}")
    text = text.replace(old, new, 1)


replace_once(
'''  mieruTrafficPattern: string;\n  sortOrder: string;''',
'''  mieruTrafficPattern: string;\n  realityServerName: string;\n  realityDest: string;\n  sortOrder: string;''',
)

replace_once(
'''  mieruTrafficPattern: "",\n  sortOrder: "0",''',
'''  mieruTrafficPattern: "",\n  realityServerName: "www.cloudflare.com",\n  realityDest: "www.cloudflare.com:443",\n  sortOrder: "0",''',
)

replace_once(
'''function endpointAddress(endpoint: any) {\n  const host = String(endpoint?.publicHost || "");\n  return `${host.includes(":") ? `[${host}]` : host}:${Number(endpoint?.publicPort || 0)}`;\n}\n''',
'''function recommendedHostAddress(host: any) {\n  const candidates = [\n    host?.ddnsEnabled ? host?.ddnsDomain : "",\n    host?.entryIp,\n    host?.ipv4,\n    host?.ip,\n    host?.ipv6,\n  ];\n  return candidates.map((value) => String(value || "").trim()).find(Boolean) || "";\n}\n\nfunction endpointAddress(endpoint: any) {\n  const host = String(endpoint?.publicHost || "");\n  return `${host.includes(":") ? `[${host}]` : host}:${Number(endpoint?.publicPort || 0)}`;\n}\n''',
)

replace_once(
'''    mieruTrafficPattern: typeof config.trafficPattern === "string" ? config.trafficPattern : "",\n    sortOrder: String(endpoint.sortOrder || 0),''',
'''    mieruTrafficPattern: typeof config.trafficPattern === "string" ? config.trafficPattern : "",\n    realityServerName: typeof config.serverName === "string" && config.serverName.trim() ? config.serverName : "www.cloudflare.com",\n    realityDest: typeof config.realityDest === "string" && config.realityDest.trim() ? config.realityDest : "www.cloudflare.com:443",\n    sortOrder: String(endpoint.sortOrder || 0),''',
)

replace_once(
'''    if (endpointForm.protocol === "mieru") {\n      const mtu = Number(endpointForm.mieruMtu);''',
'''    if (endpointForm.protocol === "vless_reality" && (!endpointForm.realityServerName.trim() || !endpointForm.realityDest.trim())) {\n      toast.error("Reality SNI 和 Dest 不能为空");\n      return;\n    }\n    if (endpointForm.protocol === "mieru") {\n      const mtu = Number(endpointForm.mieruMtu);''',
)

replace_once(
'''    } : endpointForm.protocol === "snell" || endpointForm.protocol === "vless_reality" || endpointForm.protocol === "hysteria2" ? {\n      ...endpointForm.sourceConfig,\n      ...(endpointForm.protocol !== "vless_reality" ? { password: endpointForm.password } : {}),\n      ...(endpointForm.protocol !== "hysteria2" ? { udp: endpointForm.udp } : {}),\n    } : {''',
'''    } : endpointForm.protocol === "snell" || endpointForm.protocol === "vless_reality" || endpointForm.protocol === "hysteria2" ? {\n      ...endpointForm.sourceConfig,\n      ...(endpointForm.protocol !== "vless_reality" ? { password: endpointForm.password } : {}),\n      ...(endpointForm.protocol !== "hysteria2" ? { udp: endpointForm.udp } : {}),\n      ...(endpointForm.protocol === "vless_reality" ? {\n        serverName: endpointForm.realityServerName.trim(),\n        realityDest: endpointForm.realityDest.trim(),\n      } : {}),\n    } : {''',
)

replace_once(
'''                        password: "",\n                        sourceConfig: {},\n                        udp: ["mieru", "snell", "vless_reality"].includes(protocol),\n                      } : {}),''',
'''                        password: "",\n                        sourceConfig: {},\n                        udp: ["mieru", "snell", "vless_reality"].includes(protocol),\n                        ...(protocol === "vless_reality" ? {\n                          realityServerName: "www.cloudflare.com",\n                          realityDest: "www.cloudflare.com:443",\n                        } : {}),\n                      } : {}),''',
)

replace_once(
'''                    <Select value={endpointForm.hostId} onValueChange={(hostId) => setEndpointForm({ ...endpointForm, hostId })}>''',
'''                    <Select\n                      value={endpointForm.hostId}\n                      onValueChange={(hostId) => {\n                        const host = hosts.find((item) => Number(item.id) === Number(hostId));\n                        const publicHost = recommendedHostAddress(host);\n                        setEndpointForm({\n                          ...endpointForm,\n                          hostId,\n                          ...(publicHost ? { publicHost } : {}),\n                        });\n                      }}\n                    >''',
)

replace_once(
'''              ) : endpointForm.protocol === "vless_reality" ? (\n                <div className="rounded-lg border p-3 text-xs leading-5 text-muted-foreground sm:col-span-2">\n                  托管 Reality 会自动生成 UUID、X25519 密钥和 Short ID；默认伪装目标为 www.cloudflare.com:443。保存后订阅自动包含客户端公钥参数。\n                </div>\n              ) : (''',
'''              ) : endpointForm.protocol === "vless_reality" ? (\n                <div className="grid gap-3 rounded-lg border p-3 sm:col-span-2 sm:grid-cols-2">\n                  <div className="space-y-2">\n                    <Label>Reality Server Name（SNI）</Label>\n                    <Input\n                      value={endpointForm.realityServerName}\n                      onChange={(event) => setEndpointForm({ ...endpointForm, realityServerName: event.target.value })}\n                      placeholder="www.cloudflare.com"\n                      autoComplete="off"\n                    />\n                  </div>\n                  <div className="space-y-2">\n                    <Label>Reality Dest</Label>\n                    <Input\n                      value={endpointForm.realityDest}\n                      onChange={(event) => setEndpointForm({ ...endpointForm, realityDest: event.target.value })}\n                      placeholder="www.cloudflare.com:443"\n                      autoComplete="off"\n                    />\n                  </div>\n                  <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">\n                    默认使用 Cloudflare；你可以直接改成自己的 SNI 和目标域名:端口。UUID、X25519 密钥与 Short ID 仍由 ForwardX 自动生成。\n                  </p>\n                </div>\n              ) : (''',
)

page.write_text(text)

baseline_ci = '''name: CI\n\non:\n  pull_request:\n  push:\n    branches:\n      - main\n\npermissions:\n  contents: read\n\nconcurrency:\n  group: forwardx-ci-${{ github.ref }}\n  cancel-in-progress: true\n\njobs:\n  verify:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Checkout\n        uses: actions/checkout@v4\n\n      - name: Setup pnpm\n        uses: pnpm/action-setup@v4\n        with:\n          version: 10.28.1\n\n      - name: Setup Node\n        uses: actions/setup-node@v4\n        with:\n          node-version: "22"\n          cache: pnpm\n\n      - name: Setup Go\n        uses: actions/setup-go@v5\n        with:\n          go-version: "1.23.x"\n          cache-dependency-path: |\n            agent/go.mod\n            forwardx-fxp/go.mod\n            forwardx-fxp/go.sum\n\n      - name: Install dependencies\n        run: pnpm install --frozen-lockfile\n\n      - name: Verify panel\n        run: |\n          pnpm check:versions\n          pnpm exec tsc --noEmit\n          node --import tsx --test server/agentCrypto.test.ts\n          pnpm test:protocol-access\n          pnpm test:server\n          pnpm build\n          pnpm docs:build\n\n      - name: Verify Agent and FXP\n        run: |\n          (cd agent && go test ./... && go vet ./...)\n          (cd forwardx-fxp && go test ./... && go vet ./...)\n'''
Path(".github/workflows/ci.yml").write_text(baseline_ci)
Path(__file__).unlink()
