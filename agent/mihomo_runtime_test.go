package main

import (
	"os"
	"path/filepath"
	"testing"
)

func writeMihomoRuntimeTestConfig(t *testing.T, content string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestReadMihomoRuntimeServiceListens(t *testing.T) {
	path := writeMihomoRuntimeTestConfig(t, `{
  "listeners": [
    {"name":"snell","type":"snell","port":13501},
    {"name":"reality","type":"vless","port":40006},
    {"name":"hy2","type":"hysteria2","port":24443}
  ]
}`)
	listens, ok := readMihomoRuntimeServiceListens(path)
	if !ok {
		t.Fatal("expected valid Mihomo config")
	}
	if len(listens) != 3 {
		t.Fatalf("expected 3 listeners, got %d", len(listens))
	}
	want := []runtimeListenConfig{
		{Addr: ":13501", Protocol: "tcp"},
		{Addr: ":40006", Protocol: "tcp"},
		{Addr: ":24443", Protocol: "udp"},
	}
	for i := range want {
		if listens[i] != want[i] {
			t.Fatalf("listener %d = %#v, want %#v", i, listens[i], want[i])
		}
	}
}

func TestReadMihomoRuntimeServiceListensEmptyAndInvalid(t *testing.T) {
	empty := writeMihomoRuntimeTestConfig(t, `{"listeners":[]}`)
	listens, ok := readMihomoRuntimeServiceListens(empty)
	if !ok || len(listens) != 0 {
		t.Fatalf("valid empty config = %#v, %v", listens, ok)
	}
	invalid := writeMihomoRuntimeTestConfig(t, `{not-json`)
	if listens, ok := readMihomoRuntimeServiceListens(invalid); ok || listens != nil {
		t.Fatalf("invalid config unexpectedly parsed: %#v, %v", listens, ok)
	}
}
