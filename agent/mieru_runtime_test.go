package main

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestReadMieruRuntimeServiceListens(t *testing.T) {
	path := filepath.Join(t.TempDir(), "server.json")
	raw := []byte(`{"portBindings":[{"port":22226,"protocol":"TCP"}],"users":[{"name":"forwardx","password":"secret"}],"mtu":1400}`)
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	got, ok := readMieruRuntimeServiceListens(path)
	want := []runtimeListenConfig{{Addr: ":22226", Protocol: "tcp"}}
	if !ok || !reflect.DeepEqual(got, want) {
		t.Fatalf("listens=%#v ok=%v, want=%#v", got, ok, want)
	}
}

func TestReadMieruRuntimeServiceListensRejectsDuplicateOrInvalidBindings(t *testing.T) {
	for name, raw := range map[string]string{
		"missing":   `{}`,
		"duplicate": `{"portBindings":[{"port":22226,"protocol":"TCP"},{"port":22226,"protocol":"tcp"}]}`,
		"protocol":  `{"portBindings":[{"port":22226,"protocol":"BOTH"}]}`,
		"port":      `{"portBindings":[{"port":0,"protocol":"TCP"}]}`,
	} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "server.json")
			if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
				t.Fatalf("write fixture: %v", err)
			}
			if listens, ok := readMieruRuntimeServiceListens(path); ok || listens != nil {
				t.Fatalf("invalid config accepted: %#v", listens)
			}
		})
	}
}

func TestManagedMieruConfigDoesNotFallThroughToGostParser(t *testing.T) {
	path := filepath.Join(t.TempDir(), "server.json")
	if err := os.WriteFile(path, []byte(`{"portBindings":[{"port":22226,"protocol":"UDP"}]}`), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	listens, ok := managedConfigRuntimeListens(managedConfigSpec{
		Path:        path,
		Format:      "json",
		ServiceName: "forwardx-mita",
	})
	if !ok || len(listens) != 1 || listens[0].Protocol != "udp" {
		t.Fatalf("managed Mieru config parsed as wrong runtime: ok=%v listens=%#v", ok, listens)
	}
}
