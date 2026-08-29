package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeNoBrandTestFile(t *testing.T, root, rel, content string) string {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(rel))
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}

func validNoBrandRegistry() string {
	return `{"schema_version":3,"project":"NoBrand-OneClick","ownership":"nobrand-v3"}`
}

func TestNoBrandDiscoveryMissingRootIsNotInstalled(t *testing.T) {
	result, err := discoverNoBrandProviderSnapshotAt(filepath.Join(t.TempDir(), "missing"))
	if err != nil {
		t.Fatal(err)
	}
	if result.Installed || result.Snapshot != nil {
		t.Fatalf("unexpected discovery result: %#v", result)
	}
}

func TestNoBrandDiscoveryReadsOnlyKnownV3State(t *testing.T) {
	root := t.TempDir()
	writeNoBrandTestFile(t, root, "state.json", validNoBrandRegistry())
	writeNoBrandTestFile(t, root, "mieru/install-state.env", "SCHEMA_VERSION=3\nOWNERSHIP=nobrand-v3\nINSTALL_METHOD=nobrand-v3\n")
	writeNoBrandTestFile(t, root, "mieru/users.json", `{"version":2,"deployment_model":"isolated-v2","users":[]}`)
	writeNoBrandTestFile(t, root, "snell/instances/s0123456789abcdef.json", `{"protocol":"snell","instance_id":"s0123456789abcdef","version":5}`)
	writeNoBrandTestFile(t, root, "snell/instances/README.txt", "ignore me")
	writeNoBrandTestFile(t, root, "hysteria2/state.json", `{"protocol":"hysteria2"}`)
	writeNoBrandTestFile(t, root, "vless-sudoku/state.json", `{"protocol":"vless-sudoku"}`)

	result, err := discoverNoBrandProviderSnapshotAt(root)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Installed || result.Snapshot == nil {
		t.Fatalf("expected installed snapshot: %#v", result)
	}
	if len(result.Snapshot.SnellStates) != 1 {
		t.Fatalf("expected one exact Snell instance, got %d", len(result.Snapshot.SnellStates))
	}
	if !json.Valid(result.Snapshot.Registry) || !json.Valid(result.Snapshot.MieruUsers) || !json.Valid(result.Snapshot.Hysteria2State) {
		t.Fatal("expected JSON child states to remain valid raw JSON")
	}
	if !strings.Contains(result.Snapshot.MieruInstallState, "OWNERSHIP=nobrand-v3") {
		t.Fatal("expected literal install-state contents")
	}
}

func TestNoBrandDiscoveryFailsClosedBeforeReadingChildren(t *testing.T) {
	root := t.TempDir()
	writeNoBrandTestFile(t, root, "state.json", `{"schema_version":2,"project":"NoBrand-OneClick","ownership":"legacy"}`)
	secretPath := writeNoBrandTestFile(t, root, "mieru/users.json", `{"password":"must-not-read"}`)
	if err := os.Chmod(secretPath, 0000); err != nil {
		t.Fatal(err)
	}

	result, err := discoverNoBrandProviderSnapshotAt(root)
	if err == nil || !strings.Contains(err.Error(), "unsupported NoBrand ownership marker") {
		t.Fatalf("expected ownership failure, got result=%#v err=%v", result, err)
	}
	if !result.Installed || result.Snapshot != nil {
		t.Fatalf("child state must not be returned: %#v", result)
	}
}

func TestNoBrandDiscoveryRejectsSymlinkedState(t *testing.T) {
	root := t.TempDir()
	writeNoBrandTestFile(t, root, "state.json", validNoBrandRegistry())
	target := writeNoBrandTestFile(t, root, "outside/users.json", `{"version":2}`)
	link := filepath.Join(root, "mieru", "users.json")
	if err := os.MkdirAll(filepath.Dir(link), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}

	result, err := discoverNoBrandProviderSnapshotAt(root)
	if err == nil || !strings.Contains(err.Error(), "not a regular file") {
		t.Fatalf("expected symlink rejection, got result=%#v err=%v", result, err)
	}
}

func TestNoBrandDiscoveryRejectsOversizedAndMalformedJSON(t *testing.T) {
	t.Run("oversized", func(t *testing.T) {
		root := t.TempDir()
		writeNoBrandTestFile(t, root, "state.json", validNoBrandRegistry())
		writeNoBrandTestFile(t, root, "hysteria2/state.json", strings.Repeat("x", int(noBrandProtocolMaxBytes)+1))
		if _, err := discoverNoBrandProviderSnapshotAt(root); err == nil || !strings.Contains(err.Error(), "exceeds") {
			t.Fatalf("expected size limit error, got %v", err)
		}
	})

	t.Run("malformed", func(t *testing.T) {
		root := t.TempDir()
		writeNoBrandTestFile(t, root, "state.json", validNoBrandRegistry())
		writeNoBrandTestFile(t, root, "hysteria2/state.json", `{not-json`)
		if _, err := discoverNoBrandProviderSnapshotAt(root); err == nil || !strings.Contains(err.Error(), "not valid JSON") {
			t.Fatalf("expected JSON validation error, got %v", err)
		}
	})
}
