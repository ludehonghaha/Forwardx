package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	mieruTrafficReportPendingFile = "mieru_traffic_report.pending"
	mieruTrafficBaselineFile      = "mieru_traffic_baselines.json"
	mieruTrafficReportInterval    = 10 * time.Second
	mieruTrafficReportStartupWait = 15 * time.Second
	mieruTrafficQueryTimeout      = 5 * time.Second
	mieruTrafficMaxSafeInteger    = uint64(9007199254740991)
	managedMieruBinaryPath        = "/usr/local/bin/forwardx-mita"
	managedMieruConfigPath        = "/etc/forwardx/mita/server.json"
)

type mieruAssignmentTrafficStat struct {
	Username string
	BytesIn  uint64
	BytesOut uint64
}

type mieruTrafficBaseline struct {
	Username string `json:"username"`
	BytesIn  uint64 `json:"bytesIn"`
	BytesOut uint64 `json:"bytesOut"`
}

type mieruTrafficBaselineState struct {
	Identity    string                 `json:"identity"`
	Initialized bool                   `json:"initialized"`
	Baselines   []mieruTrafficBaseline `json:"baselines"`
}

type pendingMieruTrafficReport struct {
	Payload   map[string]any         `json:"payload"`
	Identity  string                 `json:"identity"`
	Baselines []mieruTrafficBaseline `json:"baselines"`
}

type mieruMetricsEnvelope struct {
	Users map[string]map[string]uint64 `json:"users"`
}

var mieruTrafficReporterMu sync.Mutex

func init() {
	go runMieruTrafficReporter()
}

func mieruTrafficReportPendingPath() string {
	return filepath.Join(trafficStateDir, mieruTrafficReportPendingFile)
}

func mieruTrafficBaselinePath() string {
	return filepath.Join(trafficStateDir, mieruTrafficBaselineFile)
}

func currentMieruTrafficReportConfig() (Config, string, bool) {
	panelURL, _ := runtimePanelURL.Load().(string)
	token, _ := runtimeAgentToken.Load().(string)
	panelURL = strings.TrimRight(strings.TrimSpace(panelURL), "/")
	if panelURL == "" || strings.TrimSpace(token) == "" {
		return Config{}, "", false
	}
	cfg := Config{PanelURL: panelURL, Token: token, Interval: 30}
	return cfg, panelURL, true
}

func runMieruTrafficReporter() {
	timer := time.NewTimer(mieruTrafficReportStartupWait)
	defer timer.Stop()
	<-timer.C

	ticker := time.NewTicker(mieruTrafficReportInterval)
	defer ticker.Stop()
	for {
		if err := reportMieruAssignmentTrafficOnce(); err != nil && shouldLogAgentReport("mieru-traffic-report-failed", agentReportLogInterval) {
			logf("mieru assignment traffic report failed: %v", err)
		}
		<-ticker.C
	}
}

func reportMieruAssignmentTrafficOnce() error {
	mieruTrafficReporterMu.Lock()
	defer mieruTrafficReporterMu.Unlock()

	if _, err := os.Stat(managedMieruConfigPath); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	cfg, panelURL, ok := currentMieruTrafficReportConfig()
	if !ok {
		return nil
	}
	identity := trafficReportIdentityForPanel(cfg, panelURL)
	if err := ensureTrafficReportIdentity(identity); err != nil {
		return fmt.Errorf("ensure traffic report identity: %w", err)
	}

	pending, err := loadPendingMieruTrafficReport()
	if err != nil {
		return fmt.Errorf("load pending Mieru traffic report: %w", err)
	}
	if pending != nil && strings.TrimSpace(pending.Identity) != strings.TrimSpace(identity) {
		if err := removePendingMieruTrafficReport(); err != nil {
			return fmt.Errorf("discard stale Mieru traffic report: %w", err)
		}
		pending = nil
	}
	if pending != nil {
		return sendPendingMieruTrafficReport(cfg, panelURL, *pending)
	}

	current, err := collectMieruAssignmentTraffic()
	if err != nil {
		return err
	}
	if len(current) == 0 {
		return nil
	}
	acknowledged, initialized, err := loadMieruTrafficBaselines(identity)
	if err != nil {
		return fmt.Errorf("load Mieru traffic baselines: %w", err)
	}
	deltas, nextBaselines := diffMieruAssignmentTraffic(current, acknowledged, initialized)
	if !initialized || len(deltas) == 0 {
		// Only the reporter's first observation is baseline-only. Once that
		// baseline exists, a newly assigned username starts from zero and its
		// first observed bytes are real post-assignment traffic that must count.
		return commitMieruTrafficBaselines(identity, nextBaselines)
	}

	mieruStats := make([]map[string]any, 0, len(deltas))
	for _, delta := range deltas {
		if delta.BytesIn > mieruTrafficMaxSafeInteger || delta.BytesOut > mieruTrafficMaxSafeInteger {
			return fmt.Errorf("Mieru traffic delta exceeds Panel safe integer for user %q", delta.Username)
		}
		mieruStats = append(mieruStats, map[string]any{
			"username": delta.Username,
			"bytesIn":  delta.BytesIn,
			"bytesOut": delta.BytesOut,
		})
	}

	report := pendingMieruTrafficReport{
		Payload: map[string]any{
			"stats":            []map[string]any{},
			"mieruStats":       mieruStats,
			"reportId":         newTrafficReportID(),
			"reportProducerId": trafficReportProducerID(identity),
		},
		Identity:  identity,
		Baselines: nextBaselines,
	}
	if err := savePendingMieruTrafficReport(report); err != nil {
		return fmt.Errorf("persist Mieru traffic report: %w", err)
	}
	return sendPendingMieruTrafficReport(cfg, panelURL, report)
}

func collectMieruAssignmentTraffic() ([]mieruAssignmentTrafficStat, error) {
	raw, err := commandOutputWithTimeout(mieruTrafficQueryTimeout, managedMieruBinaryPath, "get", "metrics")
	if err != nil {
		// An installed but currently idle/retired runtime is not an accounting
		// failure. Avoid noisy logs while reconciliation is stopping the service.
		if !managedServiceActive(mieruServiceName) {
			return nil, nil
		}
		message := strings.TrimSpace(string(raw))
		if message == "" {
			return nil, fmt.Errorf("query Mieru metrics: %w", err)
		}
		return nil, fmt.Errorf("query Mieru metrics: %w: %s", err, compactLogOutput(message))
	}
	return parseMieruAssignmentTrafficStats(raw)
}

func parseMieruAssignmentTrafficStats(raw []byte) ([]mieruAssignmentTrafficStat, error) {
	start := bytes.IndexByte(raw, '{')
	end := bytes.LastIndexByte(raw, '}')
	if start < 0 || end < start {
		return nil, fmt.Errorf("Mieru metrics output contains no JSON object")
	}
	var envelope mieruMetricsEnvelope
	if err := json.Unmarshal(raw[start:end+1], &envelope); err != nil {
		return nil, err
	}
	stats := make([]mieruAssignmentTrafficStat, 0, len(envelope.Users))
	for username, metrics := range envelope.Users {
		username = strings.TrimSpace(username)
		if username == "" || len(username) > 64 {
			continue
		}
		stats = append(stats, mieruAssignmentTrafficStat{
			Username: username,
			BytesIn:  metrics["UploadBytes"],
			BytesOut: metrics["DownloadBytes"],
		})
	}
	sort.Slice(stats, func(i, j int) bool { return stats[i].Username < stats[j].Username })
	return stats, nil
}

func mieruCounterDelta(current, acknowledged uint64) uint64 {
	if current < acknowledged {
		return current
	}
	return current - acknowledged
}

func diffMieruAssignmentTraffic(
	current []mieruAssignmentTrafficStat,
	acknowledged map[string]mieruTrafficBaseline,
	accountNewUsers bool,
) (deltas []mieruAssignmentTrafficStat, nextBaselines []mieruTrafficBaseline) {
	next := make(map[string]mieruTrafficBaseline, len(acknowledged)+len(current))
	for username, baseline := range acknowledged {
		if username == "" || baseline.Username != username {
			continue
		}
		next[username] = baseline
	}
	for _, stat := range current {
		if strings.TrimSpace(stat.Username) == "" {
			continue
		}
		previous, existed := acknowledged[stat.Username]
		if existed || accountNewUsers {
			delta := mieruAssignmentTrafficStat{
				Username: stat.Username,
				BytesIn:  stat.BytesIn,
				BytesOut: stat.BytesOut,
			}
			if existed {
				delta.BytesIn = mieruCounterDelta(stat.BytesIn, previous.BytesIn)
				delta.BytesOut = mieruCounterDelta(stat.BytesOut, previous.BytesOut)
			}
			if delta.BytesIn > 0 || delta.BytesOut > 0 {
				deltas = append(deltas, delta)
			}
		}
		next[stat.Username] = mieruTrafficBaseline{
			Username: stat.Username,
			BytesIn:  stat.BytesIn,
			BytesOut: stat.BytesOut,
		}
	}
	for _, baseline := range next {
		nextBaselines = append(nextBaselines, baseline)
	}
	sort.Slice(deltas, func(i, j int) bool { return deltas[i].Username < deltas[j].Username })
	sort.Slice(nextBaselines, func(i, j int) bool { return nextBaselines[i].Username < nextBaselines[j].Username })
	return deltas, nextBaselines
}

func normalizeMieruTrafficBaselines(rows []mieruTrafficBaseline) (map[string]mieruTrafficBaseline, error) {
	result := make(map[string]mieruTrafficBaseline, len(rows))
	for _, row := range rows {
		username := strings.TrimSpace(row.Username)
		if username == "" || len(username) > 64 {
			return nil, fmt.Errorf("invalid Mieru traffic baseline username")
		}
		if _, exists := result[username]; exists {
			return nil, fmt.Errorf("duplicate Mieru traffic baseline username %q", username)
		}
		row.Username = username
		result[username] = row
	}
	return result, nil
}

func loadMieruTrafficBaselines(identity string) (map[string]mieruTrafficBaseline, bool, error) {
	raw, err := os.ReadFile(mieruTrafficBaselinePath())
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]mieruTrafficBaseline{}, false, nil
		}
		return nil, false, err
	}
	var state mieruTrafficBaselineState
	if err := json.Unmarshal(raw, &state); err != nil {
		return nil, false, err
	}
	if strings.TrimSpace(state.Identity) != strings.TrimSpace(identity) {
		return map[string]mieruTrafficBaseline{}, false, nil
	}
	baselines, err := normalizeMieruTrafficBaselines(state.Baselines)
	if err != nil {
		return nil, false, err
	}
	// Older branch builds did not persist Initialized. A matching baseline file
	// with at least one row is nevertheless already initialized and must not
	// suppress the first bytes of a subsequently added assignment.
	initialized := state.Initialized || len(baselines) > 0
	return baselines, initialized, nil
}

func commitMieruTrafficBaselines(identity string, baselines []mieruTrafficBaseline) error {
	if strings.TrimSpace(identity) == "" {
		return fmt.Errorf("Mieru traffic baseline identity is empty")
	}
	if _, err := normalizeMieruTrafficBaselines(baselines); err != nil {
		return err
	}
	raw, err := json.Marshal(mieruTrafficBaselineState{
		Identity:    identity,
		Initialized: true,
		Baselines:   baselines,
	})
	if err != nil {
		return err
	}
	return writeTrafficStateFile(mieruTrafficBaselinePath(), raw, 0600)
}

func savePendingMieruTrafficReport(report pendingMieruTrafficReport) error {
	if strings.TrimSpace(report.Identity) == "" {
		return fmt.Errorf("Mieru traffic report identity is empty")
	}
	if len(report.Baselines) == 0 {
		return fmt.Errorf("Mieru traffic report has no baselines")
	}
	if _, err := normalizeMieruTrafficBaselines(report.Baselines); err != nil {
		return err
	}
	if strings.TrimSpace(fmt.Sprint(report.Payload["reportId"])) == "" {
		return fmt.Errorf("Mieru traffic report id is empty")
	}
	stats, ok := report.Payload["mieruStats"].([]map[string]any)
	if !ok || len(stats) == 0 {
		return fmt.Errorf("Mieru traffic report has no stats")
	}
	raw, err := json.Marshal(report)
	if err != nil {
		return err
	}
	return writeTrafficStateFile(mieruTrafficReportPendingPath(), raw, 0600)
}

func loadPendingMieruTrafficReport() (*pendingMieruTrafficReport, error) {
	raw, err := os.ReadFile(mieruTrafficReportPendingPath())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var report pendingMieruTrafficReport
	if err := json.Unmarshal(raw, &report); err != nil {
		return nil, err
	}
	if strings.TrimSpace(report.Identity) == "" || len(report.Baselines) == 0 {
		return nil, fmt.Errorf("invalid pending Mieru traffic report")
	}
	if _, err := normalizeMieruTrafficBaselines(report.Baselines); err != nil {
		return nil, err
	}
	if strings.TrimSpace(fmt.Sprint(report.Payload["reportId"])) == "" {
		return nil, fmt.Errorf("pending Mieru traffic report id is empty")
	}
	if stats, ok := report.Payload["mieruStats"].([]any); !ok || len(stats) == 0 {
		return nil, fmt.Errorf("pending Mieru traffic report has no stats")
	}
	return &report, nil
}

func sendPendingMieruTrafficReport(cfg Config, panelURL string, report pendingMieruTrafficReport) error {
	response := map[string]any{}
	if err := postToPanelURL(cfg, panelURL, "/api/agent/traffic", report.Payload, &response); err != nil {
		return err
	}
	if err := commitMieruTrafficBaselines(report.Identity, report.Baselines); err != nil {
		return fmt.Errorf("commit Mieru traffic baseline after ACK: %w", err)
	}
	if err := removePendingMieruTrafficReport(); err != nil {
		return fmt.Errorf("remove acknowledged Mieru traffic report: %w", err)
	}
	return nil
}

func removePendingMieruTrafficReport() error {
	err := os.Remove(mieruTrafficReportPendingPath())
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if os.IsNotExist(err) {
		return nil
	}
	return syncTrafficStateDirectoryAfterMutation(trafficStateDir)
}
