from pathlib import Path

p = Path("agent/main.go")
s = p.read_text()


def rep(old: str, new: str, label: str) -> None:
    global s
    count = s.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, got {count}")
    s = s.replace(old, new, 1)


rep('var Version = "2.2.192"', 'var Version = "2.2.193"', "agent version")

rep(
    'const mieruServiceName = "forwardx-mita"\nconst runtimeConfigPath = "/etc/forwardx/runtime/gost.json"',
    'const mieruServiceName = "forwardx-mita"\nconst mihomoServiceName = "forwardx-mihomo"\nconst runtimeConfigPath = "/etc/forwardx/runtime/gost.json"',
    "mihomo service constant",
)
rep(
    'const mieruConfigPath = "/etc/forwardx/mita/server.json"\nconst mimicConfigDir = "/etc/mimic"',
    'const mieruConfigPath = "/etc/forwardx/mita/server.json"\nconst mihomoConfigPath = "/etc/forwardx/mihomo/config.yaml"\nconst mimicConfigDir = "/etc/mimic"',
    "mihomo config constant",
)

rep(
    "\tmieruRuntimePorts          map[int]bool\n\tgostRuntimePortProtocols",
    "\tmieruRuntimePorts          map[int]bool\n\tmihomoRuntimePorts         map[int]bool\n\tgostRuntimePortProtocols",
    "readiness port field",
)
rep(
    "\tmieruRuntimePortProtocols  map[int]map[string]bool\n\tgostRuntimeReady",
    "\tmieruRuntimePortProtocols  map[int]map[string]bool\n\tmihomoRuntimePortProtocols map[int]map[string]bool\n\tgostRuntimeReady",
    "readiness protocol field",
)
rep(
    "\tmieruRuntimeReady          bool\n\tsharedRuntimeReady",
    "\tmieruRuntimeReady          bool\n\tmihomoRuntimeReady         bool\n\tsharedRuntimeReady",
    "readiness ready field",
)

rep(
    "\t\tmieruRuntimePorts:          map[int]bool{},\n\t\tgostRuntimePortProtocols:",
    "\t\tmieruRuntimePorts:          map[int]bool{},\n\t\tmihomoRuntimePorts:         map[int]bool{},\n\t\tgostRuntimePortProtocols:",
    "readiness port init",
)
rep(
    "\t\tmieruRuntimePortProtocols:  map[int]map[string]bool{},\n\t\tgostRuntimeReady:",
    "\t\tmieruRuntimePortProtocols:  map[int]map[string]bool{},\n\t\tmihomoRuntimePortProtocols: map[int]map[string]bool{},\n\t\tgostRuntimeReady:",
    "readiness protocol init",
)
rep(
    "\t\tmieruRuntimeReady:          true,\n\t\tsharedRuntimeReady:",
    "\t\tmieruRuntimeReady:          true,\n\t\tmihomoRuntimeReady:         true,\n\t\tsharedRuntimeReady:",
    "readiness ready init",
)

rep(
    '\t\t{mieruConfigPath, mieruServiceName, "mieru"},\n\t}',
    '\t\t{mieruConfigPath, mieruServiceName, "mieru"},\n\t\t{mihomoConfigPath, mihomoServiceName, "mihomo"},\n\t}',
    "runtime config list",
)
rep(
    '\t\t} else if cfg.kind == "mieru" {\n\t\t\tlistens, ok = readMieruRuntimeServiceListens(cfg.path)\n\t\t} else {',
    '\t\t} else if cfg.kind == "mieru" {\n\t\t\tlistens, ok = readMieruRuntimeServiceListens(cfg.path)\n\t\t} else if cfg.kind == "mihomo" {\n\t\t\tlistens, ok = readMihomoRuntimeServiceListens(cfg.path)\n\t\t} else {',
    "runtime config parser selection",
)
rep(
    '\t\t\t\tcase "mieru":\n\t\t\t\t\treadiness.mieruRuntimePorts[port] = true\n\t\t\t\t\taddRuntimePortProtocol(readiness.mieruRuntimePortProtocols, port, protocol)\n\t\t\t\tcase "nginx":',
    '\t\t\t\tcase "mieru":\n\t\t\t\t\treadiness.mieruRuntimePorts[port] = true\n\t\t\t\t\taddRuntimePortProtocol(readiness.mieruRuntimePortProtocols, port, protocol)\n\t\t\t\tcase "mihomo":\n\t\t\t\t\treadiness.mihomoRuntimePorts[port] = true\n\t\t\t\t\taddRuntimePortProtocol(readiness.mihomoRuntimePortProtocols, port, protocol)\n\t\t\t\tcase "nginx":',
    "runtime port classification",
)
rep(
    '\t\tif hasWork && !active {\n\t\t\treadiness.sharedRuntimeReady = false\n\t\t\tswitch cfg.kind {\n\t\t\tcase "mieru":\n\t\t\t\treadiness.mieruRuntimeReady = false\n\t\t\tcase "nginx":',
    '\t\tif hasWork && !active {\n\t\t\tif cfg.kind != "mihomo" {\n\t\t\t\treadiness.sharedRuntimeReady = false\n\t\t\t}\n\t\t\tswitch cfg.kind {\n\t\t\tcase "mieru":\n\t\t\t\treadiness.mieruRuntimeReady = false\n\t\t\tcase "mihomo":\n\t\t\t\treadiness.mihomoRuntimeReady = false\n\t\t\tcase "nginx":',
    "runtime inactive classification",
)

mieru_ready = '''func (r *localRuntimeReadiness) mieruReadyForPort(port int, protocol string) bool {
\tif r == nil || port <= 0 {
\t\treturn false
\t}
\treturn r.mieruRuntimeReady &&
\t\tr.mieruRuntimePorts[port] &&
\t\truntimePortProtocolConfigured(r.mieruRuntimePortProtocols, port, protocol) &&
\t\truntimeListenPortReady(r.listenSnapshot, port, protocol, []string{"mita", "forwardx-mita"})
}
'''
rep(
    mieru_ready,
    mieru_ready
    + '''
func (r *localRuntimeReadiness) mihomoReadyForPort(port int, protocol string) bool {
\tif r == nil || port <= 0 {
\t\treturn false
\t}
\treturn r.mihomoRuntimeReady &&
\t\tr.mihomoRuntimePorts[port] &&
\t\truntimePortProtocolConfigured(r.mihomoRuntimePortProtocols, port, protocol) &&
\t\truntimeListenPortReady(r.listenSnapshot, port, protocol, []string{"mihomo", "forwardx-mihomo"})
}
''',
    "mihomo ready function",
)

rep(
    '\tappendStates("mieru", readiness.mieruRuntimePortProtocols, readiness.mieruReadyForPort)\n\tsort.Slice',
    '\tappendStates("mieru", readiness.mieruRuntimePortProtocols, readiness.mieruReadyForPort)\n\tappendStates("mihomo", readiness.mihomoRuntimePortProtocols, readiness.mihomoReadyForPort)\n\tsort.Slice',
    "listener state append",
)

rep(
    '\tcase "mieru-runtime-sync":\n\t\tservices = requiredMieruRuntimeServicesFromLocalConfig()\n\tcase "nginx-runtime-sync":',
    '\tcase "mieru-runtime-sync":\n\t\tservices = requiredMieruRuntimeServicesFromLocalConfig()\n\tcase "mihomo-runtime-sync":\n\t\tservices = requiredMihomoRuntimeServicesFromLocalConfig()\n\tcase "nginx-runtime-sync":',
    "runtime action health services",
)
rep(
    'case "gost-runtime-sync", "nginx-runtime-sync", "mieru-runtime-sync":',
    'case "gost-runtime-sync", "nginx-runtime-sync", "mieru-runtime-sync", "mihomo-runtime-sync":',
    "managed sync verification list",
)
rep(
    '\t\tif strings.Contains(strings.ToLower(service), "mita") || strings.Contains(strings.ToLower(spec.Path), "mieru") || strings.Contains(strings.ToLower(spec.Path), "/mita/") {\n\t\t\tneedles = []string{"mita", "forwardx-mita"}\n\t\t} else if strings.Contains(strings.ToLower(service), "nginx")',
    '\t\tif strings.Contains(strings.ToLower(service), "mita") || strings.Contains(strings.ToLower(spec.Path), "mieru") || strings.Contains(strings.ToLower(spec.Path), "/mita/") {\n\t\t\tneedles = []string{"mita", "forwardx-mita"}\n\t\t} else if strings.Contains(strings.ToLower(service), "mihomo") || strings.Contains(strings.ToLower(spec.Path), "/mihomo/") {\n\t\t\tneedles = []string{"mihomo", "forwardx-mihomo"}\n\t\t} else if strings.Contains(strings.ToLower(service), "nginx")',
    "managed sync process needles",
)

managed_dispatch_anchor = '''func managedConfigRuntimeListens(spec managedConfigSpec) ([]runtimeListenConfig, bool) {
\tpath := strings.TrimSpace(spec.Path)
\tif strings.Contains(strings.ToLower(spec.ServiceName), "mita") || strings.Contains(strings.ToLower(path), "mieru") || strings.Contains(strings.ToLower(path), "/mita/") {
\t\treturn readMieruRuntimeServiceListens(path)
\t}
'''
mihomo_parser = '''func readMihomoRuntimeServiceListens(path string) ([]runtimeListenConfig, bool) {
\tb, err := os.ReadFile(path)
\tif err != nil {
\t\treturn nil, false
\t}
\tvar cfg struct {
\t\tListeners []struct {
\t\t\tType string `json:"type"`
\t\t\tPort int    `json:"port"`
\t\t} `json:"listeners"`
\t}
\tif err := json.Unmarshal(b, &cfg); err != nil {
\t\treturn nil, false
\t}
\tlistens := make([]runtimeListenConfig, 0, len(cfg.Listeners))
\tfor _, listener := range cfg.Listeners {
\t\tif listener.Port <= 0 || listener.Port > 65535 {
\t\t\tcontinue
\t\t}
\t\tprotocol := "tcp"
\t\tif strings.EqualFold(strings.TrimSpace(listener.Type), "hysteria2") {
\t\t\tprotocol = "udp"
\t\t}
\t\tlistens = append(listens, runtimeListenConfig{Addr: fmt.Sprintf(":%d", listener.Port), Protocol: protocol})
\t}
\treturn listens, true
}

'''
rep(
    managed_dispatch_anchor,
    mihomo_parser
    + managed_dispatch_anchor
    + '\tif strings.Contains(strings.ToLower(spec.ServiceName), "mihomo") || strings.Contains(strings.ToLower(path), "/mihomo/") {\n\t\treturn readMihomoRuntimeServiceListens(path)\n\t}\n',
    "mihomo parser and managed config dispatch",
)

rep(
    '\tservices = append(services, requiredMieruRuntimeServicesFromLocalConfig()...)\n\tservices = append(services, managedMimicServicesFromLocalConfig()...)',
    '\tservices = append(services, requiredMieruRuntimeServicesFromLocalConfig()...)\n\tservices = append(services, requiredMihomoRuntimeServicesFromLocalConfig()...)\n\tservices = append(services, managedMimicServicesFromLocalConfig()...)',
    "required runtime service aggregation",
)

mieru_required = '''func requiredMieruRuntimeServicesFromLocalConfig() []string {
\tlistens, ok := readMieruRuntimeServiceListens(mieruConfigPath)
\tif ok && len(listens) > 0 {
\t\treturn []string{mieruServiceName}
\t}
\treturn nil
}
'''
rep(
    mieru_required,
    mieru_required
    + '''
func requiredMihomoRuntimeServicesFromLocalConfig() []string {
\tlistens, ok := readMihomoRuntimeServiceListens(mihomoConfigPath)
\tif ok && len(listens) > 0 {
\t\treturn []string{mihomoServiceName}
\t}
\treturn nil
}
''',
    "required Mihomo service helper",
)

p.write_text(s)

Path("agent/mihomo_runtime_test.go").write_text(
    '''package main

import (
\t"os"
\t"path/filepath"
\t"testing"
)

func writeMihomoRuntimeTestConfig(t *testing.T, content string) string {
\tt.Helper()
\tpath := filepath.Join(t.TempDir(), "config.yaml")
\tif err := os.WriteFile(path, []byte(content), 0600); err != nil {
\t\tt.Fatal(err)
\t}
\treturn path
}

func TestReadMihomoRuntimeServiceListens(t *testing.T) {
\tpath := writeMihomoRuntimeTestConfig(t, `{
  "listeners": [
    {"name":"snell","type":"snell","port":13501},
    {"name":"reality","type":"vless","port":40006},
    {"name":"hy2","type":"hysteria2","port":24443}
  ]
}`)
\tlistens, ok := readMihomoRuntimeServiceListens(path)
\tif !ok {
\t\tt.Fatal("expected valid Mihomo config")
\t}
\tif len(listens) != 3 {
\t\tt.Fatalf("expected 3 listeners, got %d", len(listens))
\t}
\twant := []runtimeListenConfig{
\t\t{Addr: ":13501", Protocol: "tcp"},
\t\t{Addr: ":40006", Protocol: "tcp"},
\t\t{Addr: ":24443", Protocol: "udp"},
\t}
\tfor i := range want {
\t\tif listens[i] != want[i] {
\t\t\tt.Fatalf("listener %d = %#v, want %#v", i, listens[i], want[i])
\t\t}
\t}
}

func TestReadMihomoRuntimeServiceListensEmptyAndInvalid(t *testing.T) {
\tempty := writeMihomoRuntimeTestConfig(t, `{"listeners":[]}`)
\tlistens, ok := readMihomoRuntimeServiceListens(empty)
\tif !ok || len(listens) != 0 {
\t\tt.Fatalf("valid empty config = %#v, %v", listens, ok)
\t}
\tinvalid := writeMihomoRuntimeTestConfig(t, `{not-json`)
\tif listens, ok := readMihomoRuntimeServiceListens(invalid); ok || listens != nil {
\t\tt.Fatalf("invalid config unexpectedly parsed: %#v, %v", listens, ok)
\t}
}
'''
)
