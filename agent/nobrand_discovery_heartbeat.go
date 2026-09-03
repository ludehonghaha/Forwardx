package main

import (
	"encoding/json"
	"strings"
)

type heartbeatRespNoBrandAlias heartbeatResp

type heartbeatRespNoBrandEnvelope struct {
	*heartbeatRespNoBrandAlias
	NoBrandDiscoveryTasks []noBrandDiscoveryTask `json:"noBrandDiscoveryTasks"`
	DualPilotTasks        []dualPilotTask         `json:"dualPilotTasks"`
}

var noBrandDiscoveryHeartbeatDispatch = dispatchNoBrandDiscoveryHeartbeatTasks
var dualPilotHeartbeatDispatch = dispatchDualPilotHeartbeatTasks

// UnmarshalJSON extends the existing heartbeat response without changing the
// large core Agent file. Unknown/new panel fields remain backward-compatible,
// while dedicated allowlisted tasks are dispatched immediately after authentication.
func (resp *heartbeatResp) UnmarshalJSON(data []byte) error {
	decoded := heartbeatRespNoBrandEnvelope{
		heartbeatRespNoBrandAlias: (*heartbeatRespNoBrandAlias)(resp),
	}
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	if len(decoded.NoBrandDiscoveryTasks) > 0 && noBrandDiscoveryHeartbeatDispatch != nil {
		noBrandDiscoveryHeartbeatDispatch(decoded.NoBrandDiscoveryTasks)
	}
	if len(decoded.DualPilotTasks) > 0 && dualPilotHeartbeatDispatch != nil {
		dualPilotHeartbeatDispatch(decoded.DualPilotTasks)
	}
	return nil
}

func loadDedicatedTaskConfig(label string) (Config, bool) {
	path := strings.TrimSpace(activeConfigPath)
	if path == "" {
		path = defaultConfigPath
	}
	cfg, err := loadConfig(path)
	if err != nil {
		logf("%s task dispatch skipped: load Agent config: %v", label, err)
		return Config{}, false
	}
	return cfg, true
}

func dispatchNoBrandDiscoveryHeartbeatTasks(tasks []noBrandDiscoveryTask) {
	cfg, ok := loadDedicatedTaskConfig("NoBrand discovery")
	if !ok {
		return
	}
	for _, task := range tasks {
		task := task
		go handleNoBrandDiscoveryTask(cfg, task)
	}
}

func dispatchDualPilotHeartbeatTasks(tasks []dualPilotTask) {
	cfg, ok := loadDedicatedTaskConfig("Dual Pilot")
	if !ok {
		return
	}
	for _, task := range tasks {
		task := task
		go handleDualPilotTask(cfg, task)
	}
}
