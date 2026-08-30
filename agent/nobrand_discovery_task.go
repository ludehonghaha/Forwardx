package main

import (
	"fmt"
	"strings"
	"time"
)

type noBrandDiscoveryTask struct {
	TaskID    string `json:"taskId"`
	CreatedAt string `json:"createdAt,omitempty"`
}

type noBrandDiscoveryTaskResult struct {
	TaskID    string                     `json:"taskId"`
	Success   bool                       `json:"success"`
	Installed bool                       `json:"installed"`
	Snapshot  *noBrandProviderSnapshot   `json:"snapshot,omitempty"`
	Error     string                     `json:"error,omitempty"`
	UpdatedAt string                     `json:"updatedAt"`
}

type noBrandDiscoverFn func() (noBrandDiscoveryResult, error)

func runNoBrandDiscoveryTask(task noBrandDiscoveryTask) noBrandDiscoveryTaskResult {
	return runNoBrandDiscoveryTaskWith(task, discoverNoBrandProviderSnapshot)
}

func runNoBrandDiscoveryTaskWith(task noBrandDiscoveryTask, discover noBrandDiscoverFn) noBrandDiscoveryTaskResult {
	taskID := strings.TrimSpace(task.TaskID)
	result := noBrandDiscoveryTaskResult{
		TaskID:    taskID,
		Success:   false,
		Installed: false,
		UpdatedAt: time.Now().Format(time.RFC3339Nano),
	}
	if taskID == "" {
		result.Error = "invalid NoBrand discovery task id"
		return result
	}
	if discover == nil {
		result.Error = "NoBrand discovery is unavailable"
		return result
	}
	discovered, err := discover()
	if err != nil {
		// Do not include file contents or credentials in task errors.
		result.Error = fmt.Sprintf("NoBrand discovery failed: %v", err)
		if len(result.Error) > 1000 {
			result.Error = result.Error[:1000]
		}
		return result
	}
	result.Success = true
	result.Installed = discovered.Installed
	result.Snapshot = discovered.Snapshot
	return result
}

func handleNoBrandDiscoveryTask(cfg Config, task noBrandDiscoveryTask) {
	result := runNoBrandDiscoveryTask(task)
	if err := post(cfg, "/api/agent/nobrand-discovery-result", map[string]any{"result": result}, &map[string]any{}); err != nil {
		if isTransientAgentCommError(err) {
			logAgentCommError("nobrand-discovery-result", err)
			return
		}
		// Never log the result body: successful snapshots contain credentials.
		logf("NoBrand discovery result report failed task=%s: %v", result.TaskID, err)
	}
}
