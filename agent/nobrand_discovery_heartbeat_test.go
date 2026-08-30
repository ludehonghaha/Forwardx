package main

import (
	"encoding/json"
	"testing"
)

func TestHeartbeatResponseDispatchesNoBrandDiscoveryTasks(t *testing.T) {
	previous := noBrandDiscoveryHeartbeatDispatch
	defer func() { noBrandDiscoveryHeartbeatDispatch = previous }()

	var captured []noBrandDiscoveryTask
	noBrandDiscoveryHeartbeatDispatch = func(tasks []noBrandDiscoveryTask) {
		captured = append(captured, tasks...)
	}

	var response heartbeatResp
	if err := json.Unmarshal([]byte("{\"noBrandDiscoveryTasks\":[{\"taskId\":\"nb-task-1\",\"createdAt\":\"2026-08-30T00:00:00Z\"}]}"), &response); err != nil {
		t.Fatalf("unmarshal heartbeat: %v", err)
	}
	if len(captured) != 1 || captured[0].TaskID != "nb-task-1" {
		t.Fatalf("unexpected captured tasks: %#v", captured)
	}
}

func TestHeartbeatResponseWithoutNoBrandTasksDoesNotDispatch(t *testing.T) {
	previous := noBrandDiscoveryHeartbeatDispatch
	defer func() { noBrandDiscoveryHeartbeatDispatch = previous }()

	called := false
	noBrandDiscoveryHeartbeatDispatch = func(tasks []noBrandDiscoveryTask) {
		called = true
	}

	var response heartbeatResp
	if err := json.Unmarshal([]byte("{\"nextInterval\":30}"), &response); err != nil {
		t.Fatalf("unmarshal heartbeat: %v", err)
	}
	if called {
		t.Fatal("unexpected NoBrand discovery dispatch")
	}
}
