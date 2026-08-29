package main

import (
	"os"
	"path/filepath"
	"testing"
)

func writeXrayRuntimeTestConfig(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestReadXrayRuntimeServiceListens(t *testing.T) {
	path := writeXrayRuntimeTestConfig(t, `{
  "inbounds": [
    {"tag":"reality-a","listen":"0.0.0.0","port":14285,"protocol":"vless"},
    {"tag":"reality-b","listen":"127.0.0.1","port":14336,"protocol":"vless"},
    {"tag":"ignored-socks","listen":"0.0.0.0","port":1080,"protocol":"socks"}
  ]
}`)
	listens, ok := readXrayRuntimeServiceListens(path)
	if !ok {
		t.Fatal("expected valid Xray config")
	}
	want := []runtimeListenConfig{
		{Addr: ":14285", Protocol: "tcp"},
		{Addr: "127.0.0.1:14336", Protocol: "tcp"},
	}
	if len(listens) != len(want) {
		t.Fatalf("expected %d listeners, got %d: %#v", len(want), len(listens), listens)
	}
	for i := range want {
		if listens[i] != want[i] {
			t.Fatalf("listener %d = %#v, want %#v", i, listens[i], want[i])
		}
	}
}

func TestReadXrayRuntimeServiceListensEmptyAndInvalid(t *testing.T) {
	empty := writeXrayRuntimeTestConfig(t, `{"inbounds":[]}`)
	listens, ok := readXrayRuntimeServiceListens(empty)
	if !ok || len(listens) != 0 {
		t.Fatalf("valid empty config = %#v, %v", listens, ok)
	}

	invalidPort := writeXrayRuntimeTestConfig(t, `{"inbounds":[{"protocol":"vless","port":70000}]}`)
	listens, ok = readXrayRuntimeServiceListens(invalidPort)
	if !ok || len(listens) != 0 {
		t.Fatalf("invalid port should be ignored: %#v, %v", listens, ok)
	}

	invalid := writeXrayRuntimeTestConfig(t, `{not-json`)
	if listens, ok := readXrayRuntimeServiceListens(invalid); ok || listens != nil {
		t.Fatalf("invalid config unexpectedly parsed: %#v, %v", listens, ok)
	}
}

func TestXrayRuntimePathsMatchPanelContract(t *testing.T) {
	if xrayConfigDir != "/etc/forwardx/xray" {
		t.Fatalf("xrayConfigDir = %q", xrayConfigDir)
	}
	if xrayConfigPath != "/etc/forwardx/xray/config.json" {
		t.Fatalf("xrayConfigPath = %q", xrayConfigPath)
	}
	if xrayServiceName != "forwardx-xray" {
		t.Fatalf("xrayServiceName = %q", xrayServiceName)
	}
}
