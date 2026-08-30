package main

import (
	"encoding/json"
	"strings"
)

type heartbeatRespNoBrandAlias heartbeatResp

type heartbeatRespNoBrandEnvelope struct {
	*heartbeatRespNoBrandAlias
	NoBrandDiscoveryTasks []noBrandDiscoveryTask `json:"noBrandDiscoveryTasks"`
}

var noBrandDiscoveryHeartbeatDispatch = dispatchNoBrandDiscoveryHeartbeatTasks

// UnmarshalJSON extends the existing heartbeat response without changing the
// large core Agent file. Unknown/new panel fields remain backward-compatible,
// while NoBrand discovery tasks are dispatched immediately after authentication.
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
	return nil
}

func dispatchNoBrandDiscoveryHeartbeatTasks(tasks []noBrandDiscoveryTask) {
	path := strings.TrimSpace(activeConfigPath)
	if path == "" {
		path = defaultConfigPath
	}
	cfg, err := loadConfig(path)
	if err != nil {
		logf("NoBrand discovery task dispatch skipped: load Agent config: %v", err)
		return
	}
	for _, task := range tasks {
		task := task
		go handleNoBrandDiscoveryTask(cfg, task)
	}
}
