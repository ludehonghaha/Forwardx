package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
)

const (
	xrayTrafficBaselineSchema = 1
	xrayTrafficBaselineFile   = "xray_traffic_baseline.state"
)

var errXrayTrafficBaselineIdentityMismatch = errors.New("xray traffic baseline identity mismatch")

type persistedXrayTrafficBaselineState struct {
	Schema    int                   `json:"schema"`
	Identity  string                `json:"identity"`
	Baselines []xrayTrafficBaseline `json:"baselines"`
}

var xrayTrafficBaselineMu sync.Mutex

func xrayTrafficBaselinePath() string {
	return trafficStateDir + "/" + xrayTrafficBaselineFile
}

func normalizeXrayTrafficBaselines(baselines []xrayTrafficBaseline) ([]xrayTrafficBaseline, error) {
	byAssignment := make(map[int]xrayTrafficBaseline, len(baselines))
	for _, baseline := range baselines {
		if baseline.AssignmentID <= 0 {
			return nil, fmt.Errorf("xray traffic baseline assignment id is invalid")
		}
		if _, exists := byAssignment[baseline.AssignmentID]; exists {
			return nil, fmt.Errorf("duplicate xray traffic baseline assignment %d", baseline.AssignmentID)
		}
		byAssignment[baseline.AssignmentID] = baseline
	}
	result := make([]xrayTrafficBaseline, 0, len(byAssignment))
	for _, baseline := range byAssignment {
		result = append(result, baseline)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].AssignmentID < result[j].AssignmentID
	})
	return result, nil
}

func decodeXrayTrafficBaselineState(raw []byte, identity string) (map[int]xrayTrafficBaseline, error) {
	var state persistedXrayTrafficBaselineState
	if err := json.Unmarshal(raw, &state); err != nil {
		return nil, err
	}
	if state.Schema != xrayTrafficBaselineSchema {
		return nil, fmt.Errorf("unsupported xray traffic baseline schema %d", state.Schema)
	}
	expectedIdentity := strings.TrimSpace(identity)
	if expectedIdentity == "" || strings.TrimSpace(state.Identity) != expectedIdentity {
		return nil, errXrayTrafficBaselineIdentityMismatch
	}
	normalized, err := normalizeXrayTrafficBaselines(state.Baselines)
	if err != nil {
		return nil, err
	}
	result := make(map[int]xrayTrafficBaseline, len(normalized))
	for _, baseline := range normalized {
		result[baseline.AssignmentID] = baseline
	}
	return result, nil
}

func loadXrayTrafficBaselines(identity string) (map[int]xrayTrafficBaseline, error) {
	xrayTrafficBaselineMu.Lock()
	defer xrayTrafficBaselineMu.Unlock()

	raw, err := os.ReadFile(xrayTrafficBaselinePath())
	if err != nil {
		if os.IsNotExist(err) {
			return map[int]xrayTrafficBaseline{}, nil
		}
		return nil, err
	}
	return decodeXrayTrafficBaselineState(raw, identity)
}

// commitXrayTrafficBaselines is intentionally a post-ACK operation. The caller
// must persist the pending traffic report, including these next baselines,
// before sending it to the Panel; otherwise an Agent crash could acknowledge
// bytes without leaving enough state to advance the checkpoint on restart.
func commitXrayTrafficBaselines(identity string, baselines []xrayTrafficBaseline) error {
	xrayTrafficBaselineMu.Lock()
	defer xrayTrafficBaselineMu.Unlock()

	identity = strings.TrimSpace(identity)
	if identity == "" {
		return fmt.Errorf("xray traffic baseline identity is empty")
	}
	normalized, err := normalizeXrayTrafficBaselines(baselines)
	if err != nil {
		return err
	}
	raw, err := json.Marshal(persistedXrayTrafficBaselineState{
		Schema:    xrayTrafficBaselineSchema,
		Identity:  identity,
		Baselines: normalized,
	})
	if err != nil {
		return err
	}
	return writeTrafficStateFile(xrayTrafficBaselinePath(), raw, 0600)
}
