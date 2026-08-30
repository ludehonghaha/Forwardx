package main

import (
	"errors"
	"strings"
	"testing"
)

func TestRunNoBrandDiscoveryTaskSuccess(t *testing.T) {
	snapshot := &noBrandProviderSnapshot{}
	result := runNoBrandDiscoveryTaskWith(noBrandDiscoveryTask{TaskID: "task-1"}, func() (noBrandDiscoveryResult, error) {
		return noBrandDiscoveryResult{Installed: true, Snapshot: snapshot}, nil
	})
	if !result.Success || !result.Installed || result.Snapshot != snapshot || result.TaskID != "task-1" || result.Error != "" {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunNoBrandDiscoveryTaskNotInstalledIsStillSuccess(t *testing.T) {
	result := runNoBrandDiscoveryTaskWith(noBrandDiscoveryTask{TaskID: "task-2"}, func() (noBrandDiscoveryResult, error) {
		return noBrandDiscoveryResult{Installed: false}, nil
	})
	if !result.Success || result.Installed || result.Snapshot != nil {
		t.Fatalf("unexpected result: %#v", result)
	}
}

func TestRunNoBrandDiscoveryTaskFailsWithoutTaskID(t *testing.T) {
	called := false
	result := runNoBrandDiscoveryTaskWith(noBrandDiscoveryTask{}, func() (noBrandDiscoveryResult, error) {
		called = true
		return noBrandDiscoveryResult{}, nil
	})
	if called || result.Success || !strings.Contains(result.Error, "task id") {
		t.Fatalf("unexpected result: %#v called=%v", result, called)
	}
}

func TestRunNoBrandDiscoveryTaskReportsBoundedError(t *testing.T) {
	result := runNoBrandDiscoveryTaskWith(noBrandDiscoveryTask{TaskID: "task-3"}, func() (noBrandDiscoveryResult, error) {
		return noBrandDiscoveryResult{}, errors.New(strings.Repeat("x", 2000))
	})
	if result.Success || len(result.Error) > 1000 || !strings.HasPrefix(result.Error, "NoBrand discovery failed:") {
		t.Fatalf("unexpected result: %#v", result)
	}
}
