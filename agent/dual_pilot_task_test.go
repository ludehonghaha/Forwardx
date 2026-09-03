package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestDualPilotRejectsUnknownAndInjectedActions(t *testing.T) {
	for _, action := range []string{"validate", "cleanup", "start; rm -rf /", "$(id)", ""} {
		result := runDualPilotTaskWith(dualPilotTask{TaskID: "task-safe", Action: action}, exec.CommandContext)
		if result.Success || result.Error != "unsupported Dual Pilot action" {
			t.Fatalf("action %q must be rejected, got %+v", action, result)
		}
	}
}

func TestDualPilotInvokesOnlyFixedLauncherAndArguments(t *testing.T) {
	dir := t.TempDir()
	launcher := filepath.Join(dir, "run-dual-pilot.sh")
	if err := os.WriteFile(launcher, []byte("#!/bin/sh\nprintf '%s\\n' \"$@\"\n"), 0700); err != nil {
		t.Fatal(err)
	}
	previous := dualPilotLauncherForTask
	dualPilotLauncherForTask = launcher
	t.Cleanup(func() { dualPilotLauncherForTask = previous })

	var gotName string
	var gotArgs []string
	command := func(ctx context.Context, name string, args ...string) *exec.Cmd {
		gotName = name
		gotArgs = append([]string(nil), args...)
		return exec.CommandContext(ctx, name, args...)
	}
	result := runDualPilotTaskWith(dualPilotTask{TaskID: "task-123", Action: "status"}, command)
	if !result.Success {
		t.Fatalf("expected success, got %+v", result)
	}
	if gotName != launcher {
		t.Fatalf("unexpected executable: %q", gotName)
	}
	wantArgs := []string{
		"server",
		"status",
		dualPilotConfigDir,
		dualPilotArtifactDir,
		dualPilotRuntimeDir,
	}
	if !reflect.DeepEqual(gotArgs, wantArgs) {
		t.Fatalf("unexpected args: %#v", gotArgs)
	}
	if strings.Contains(strings.Join(gotArgs, " "), "sh -c") {
		t.Fatal("Dual Pilot task must not use sh -c")
	}
}

func TestDualPilotReportsMissingRuntimeWithoutFallbackExecution(t *testing.T) {
	previous := dualPilotLauncherForTask
	dualPilotLauncherForTask = filepath.Join(t.TempDir(), "missing")
	t.Cleanup(func() { dualPilotLauncherForTask = previous })

	called := false
	command := func(ctx context.Context, name string, args ...string) *exec.Cmd {
		called = true
		return exec.CommandContext(ctx, name, args...)
	}
	result := runDualPilotTaskWith(dualPilotTask{TaskID: "task-missing", Action: "start"}, command)
	if result.Success || result.Error != "Dual Pilot runtime is not installed" {
		t.Fatalf("unexpected result: %+v", result)
	}
	if called {
		t.Fatal("missing runtime must not trigger fallback command execution")
	}
}

func TestDualPilotOutputIsBounded(t *testing.T) {
	text := boundedDualPilotOutput([]byte(strings.Repeat("x", dualPilotTaskOutputLimit+4096)))
	if !strings.Contains(text, "[输出已截断]") {
		t.Fatal("expected truncation marker")
	}
	if len(text) > dualPilotTaskOutputLimit+64 {
		t.Fatalf("bounded output is too large: %d", len(text))
	}
}
