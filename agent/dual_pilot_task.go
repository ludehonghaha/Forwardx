package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

const dualPilotLauncherPath = "/usr/local/lib/forwardx/dual-pilot/run-dual-pilot.sh"
const dualPilotConfigDir = "/etc/forwardx/dual-pilot"
const dualPilotArtifactDir = "/usr/local/lib/forwardx/dual-pilot/artifacts"
const dualPilotRuntimeDir = "/var/lib/forwardx-agent/dual-pilot"
const dualPilotTaskTimeout = 35 * time.Second
const dualPilotTaskOutputLimit = 16 * 1024

var dualPilotTaskIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
var dualPilotLauncherForTask = dualPilotLauncherPath

type dualPilotTask struct {
	TaskID    string `json:"taskId"`
	Action    string `json:"action"`
	CreatedAt string `json:"createdAt,omitempty"`
}

type dualPilotTaskResult struct {
	TaskID    string `json:"taskId"`
	Action    string `json:"action"`
	Success   bool   `json:"success"`
	Output    string `json:"output,omitempty"`
	Error     string `json:"error,omitempty"`
	ExitCode  *int   `json:"exitCode,omitempty"`
	TimedOut  bool   `json:"timedOut,omitempty"`
	UpdatedAt string `json:"updatedAt"`
}

type dualPilotCommandFn func(context.Context, string, ...string) *exec.Cmd

func validDualPilotAction(action string) bool {
	switch strings.TrimSpace(action) {
	case "start", "stop", "status":
		return true
	default:
		return false
	}
}

func boundedDualPilotOutput(data []byte) string {
	if len(data) > dualPilotTaskOutputLimit {
		return strings.TrimSpace(string(data[:dualPilotTaskOutputLimit])) + "\n[输出已截断]"
	}
	return strings.TrimSpace(string(data))
}

func runDualPilotTask(task dualPilotTask) dualPilotTaskResult {
	return runDualPilotTaskWith(task, exec.CommandContext)
}

func runDualPilotTaskWith(task dualPilotTask, command dualPilotCommandFn) dualPilotTaskResult {
	taskID := strings.TrimSpace(task.TaskID)
	action := strings.TrimSpace(task.Action)
	result := dualPilotTaskResult{
		TaskID: taskID,
		Action: action,
		Success: false,
		UpdatedAt: time.Now().Format(time.RFC3339Nano),
	}
	if !dualPilotTaskIDPattern.MatchString(taskID) {
		result.Error = "invalid Dual Pilot task id"
		return result
	}
	if !validDualPilotAction(action) {
		result.Error = "unsupported Dual Pilot action"
		return result
	}
	if command == nil {
		result.Error = "Dual Pilot executor is unavailable"
		return result
	}
	launcher := strings.TrimSpace(dualPilotLauncherForTask)
	info, err := os.Stat(launcher)
	if err != nil || info.IsDir() || info.Mode()&0111 == 0 {
		result.Error = "Dual Pilot runtime is not installed"
		return result
	}

	ctx, cancel := context.WithTimeout(context.Background(), dualPilotTaskTimeout)
	defer cancel()

	// Security boundary: no shell, no request-controlled executable/path/role
	// or free-form arguments. Only the validated lifecycle enum crosses into
	// the preinstalled Pilot launcher. dualPilotLauncherForTask differs from the
	// constant only inside unit tests.
	cmd := command(ctx,
		launcher,
		"server",
		action,
		dualPilotConfigDir,
		dualPilotArtifactDir,
		dualPilotRuntimeDir,
	)
	var stdout bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err = cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		result.TimedOut = true
		result.Error = "Dual Pilot action timed out"
		result.Output = boundedDualPilotOutput(stdout.Bytes())
		return result
	}

	result.Output = boundedDualPilotOutput(stdout.Bytes())
	if err == nil {
		zero := 0
		result.ExitCode = &zero
		result.Success = true
		return result
	}

	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		code := exitErr.ExitCode()
		result.ExitCode = &code
	}
	stderrText := boundedDualPilotOutput(stderr.Bytes())
	if stderrText != "" {
		result.Error = stderrText
	} else {
		result.Error = fmt.Sprintf("Dual Pilot action failed: %v", err)
	}
	if len(result.Error) > 1000 {
		result.Error = result.Error[:1000]
	}
	return result
}

func handleDualPilotTask(cfg Config, task dualPilotTask) {
	result := runDualPilotTask(task)
	if err := post(cfg, "/api/agent/plugin-action-result", map[string]any{"dualPilotResult": result}, &map[string]any{}); err != nil {
		if isTransientAgentCommError(err) {
			logAgentCommError("dual-pilot-result", err)
			return
		}
		logf("Dual Pilot result report failed task=%s action=%s: %v", result.TaskID, result.Action, err)
	}
}
