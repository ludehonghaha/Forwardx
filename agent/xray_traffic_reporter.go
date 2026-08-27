package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	xrayTrafficReportPendingFile = "xray_traffic_report.pending"
	xrayTrafficReportInterval    = 10 * time.Second
	xrayTrafficReportStartupWait = 15 * time.Second
	xrayTrafficQueryTimeout      = 5 * time.Second
	xrayTrafficMaxSafeInteger    = uint64(9007199254740991)
)

type pendingXrayTrafficReport struct {
	Payload   map[string]any       `json:"payload"`
	Identity  string               `json:"identity"`
	Baselines []xrayTrafficBaseline `json:"baselines"`
}

var (
	xrayTrafficReporterMu            sync.Mutex
	collectXrayTrafficForReporter    = collectXrayAssignmentTraffic
	postXrayTrafficReportToPanel     = postToPanelURL
)

func init() {
	go runXrayTrafficReporter()
}

func xrayTrafficReportPendingPath() string {
	return filepath.Join(trafficStateDir, xrayTrafficReportPendingFile)
}

func currentXrayTrafficReportConfig() (Config, string, bool) {
	panelURL, _ := runtimePanelURL.Load().(string)
	token, _ := runtimeAgentToken.Load().(string)
	panelURL = strings.TrimRight(strings.TrimSpace(panelURL), "/")
	if panelURL == "" || strings.TrimSpace(token) == "" {
		return Config{}, "", false
	}
	return Config{PanelURL: panelURL, Token: token, Interval: 30}, panelURL, true
}

func runXrayTrafficReporter() {
	timer := time.NewTimer(xrayTrafficReportStartupWait)
	defer timer.Stop()
	<-timer.C

	ticker := time.NewTicker(xrayTrafficReportInterval)
	defer ticker.Stop()
	for {
		if err := reportXrayAssignmentTrafficOnce(); err != nil && shouldLogAgentReport("xray-traffic-report-failed", agentReportLogInterval) {
			logf("xray assignment traffic report failed: %v", err)
		}
		<-ticker.C
	}
}

func reportXrayAssignmentTrafficOnce() error {
	xrayTrafficReporterMu.Lock()
	defer xrayTrafficReporterMu.Unlock()

	if _, err := os.Stat(xrayConfigPath); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	cfg, panelURL, ok := currentXrayTrafficReportConfig()
	if !ok {
		return nil
	}
	identity := trafficReportIdentityForPanel(cfg, panelURL)
	if err := ensureTrafficReportIdentity(identity); err != nil {
		return fmt.Errorf("ensure traffic report identity: %w", err)
	}

	pending, err := loadPendingXrayTrafficReport()
	if err != nil {
		return fmt.Errorf("load pending Xray traffic report: %w", err)
	}
	if pending != nil && strings.TrimSpace(pending.Identity) != strings.TrimSpace(identity) {
		if err := removePendingXrayTrafficReport(); err != nil {
			return fmt.Errorf("discard stale Xray traffic report: %w", err)
		}
		pending = nil
	}
	if pending != nil {
		return sendPendingXrayTrafficReport(cfg, panelURL, *pending)
	}

	current, err := collectXrayTrafficForReporter()
	if err != nil {
		return err
	}
	if len(current) == 0 {
		return nil
	}
	acknowledged, err := loadXrayTrafficBaselines(identity)
	if errors.Is(err, errXrayTrafficBaselineIdentityMismatch) {
		// A Panel identity change must not replay a still-running Xray process's
		// cumulative counters into the replacement Panel. Re-anchor at the current
		// values and count only traffic observed after this point.
		_, nextBaselines := diffXrayAssignmentTraffic(current, map[int]xrayTrafficBaseline{})
		return commitXrayTrafficBaselines(identity, nextBaselines)
	}
	if err != nil {
		return fmt.Errorf("load Xray traffic baselines: %w", err)
	}
	deltas, nextBaselines := diffXrayAssignmentTraffic(current, acknowledged)
	if len(deltas) == 0 {
		return commitXrayTrafficBaselines(identity, nextBaselines)
	}

	report, err := buildPendingXrayTrafficReport(identity, deltas, nextBaselines)
	if err != nil {
		return err
	}
	if err := savePendingXrayTrafficReport(report); err != nil {
		return fmt.Errorf("persist Xray traffic report: %w", err)
	}
	return sendPendingXrayTrafficReport(cfg, panelURL, report)
}

func collectXrayAssignmentTraffic() ([]xrayAssignmentTrafficStat, error) {
	ssOutput, err := commandCombinedOutputWithTimeout(xrayTrafficQueryTimeout, "ss", "-H", "-lntp")
	if err != nil {
		if !managedServiceActive(xrayServiceName) {
			return nil, nil
		}
		return nil, fmt.Errorf("discover Xray StatsService listener: %w", err)
	}
	server, err := discoverXrayStatsAPIServer(ssOutput)
	if err != nil {
		if !managedServiceActive(xrayServiceName) {
			return nil, nil
		}
		return nil, err
	}
	args := xrayStatsQueryArgs(server)
	raw, err := commandCombinedOutputWithTimeout(xrayTrafficQueryTimeout, xrayBinaryPath, args...)
	if err != nil {
		if !managedServiceActive(xrayServiceName) {
			return nil, nil
		}
		message := strings.TrimSpace(string(raw))
		if message == "" {
			return nil, fmt.Errorf("query Xray assignment stats: %w", err)
		}
		return nil, fmt.Errorf("query Xray assignment stats: %w: %s", err, compactLogOutput(message))
	}
	return parseXrayAssignmentTrafficStats(raw)
}

func buildPendingXrayTrafficReport(
	identity string,
	deltas []xrayAssignmentTrafficStat,
	baselines []xrayTrafficBaseline,
) (pendingXrayTrafficReport, error) {
	identity = strings.TrimSpace(identity)
	if identity == "" {
		return pendingXrayTrafficReport{}, fmt.Errorf("Xray traffic report identity is empty")
	}
	if len(deltas) == 0 || len(baselines) == 0 {
		return pendingXrayTrafficReport{}, fmt.Errorf("Xray traffic report has no traffic")
	}
	protocolStats := make([]map[string]any, 0, len(deltas))
	for _, delta := range deltas {
		if delta.AssignmentID <= 0 {
			return pendingXrayTrafficReport{}, fmt.Errorf("Xray traffic assignment id is invalid")
		}
		if delta.BytesIn > xrayTrafficMaxSafeInteger || delta.BytesOut > xrayTrafficMaxSafeInteger {
			return pendingXrayTrafficReport{}, fmt.Errorf("Xray traffic delta exceeds Panel safe integer for assignment %d", delta.AssignmentID)
		}
		if delta.BytesIn == 0 && delta.BytesOut == 0 {
			continue
		}
		protocolStats = append(protocolStats, map[string]any{
			"assignmentId": delta.AssignmentID,
			"bytesIn":      delta.BytesIn,
			"bytesOut":     delta.BytesOut,
		})
	}
	if len(protocolStats) == 0 {
		return pendingXrayTrafficReport{}, fmt.Errorf("Xray traffic report has no non-zero stats")
	}
	return pendingXrayTrafficReport{
		Payload: map[string]any{
			"stats":            []map[string]any{},
			"protocolStats":    protocolStats,
			"reportId":         newTrafficReportID(),
			"reportProducerId": trafficReportProducerID(identity),
		},
		Identity:  identity,
		Baselines: baselines,
	}, nil
}

func xrayProtocolStatsCount(payload map[string]any) int {
	switch stats := payload["protocolStats"].(type) {
	case []map[string]any:
		return len(stats)
	case []any:
		return len(stats)
	default:
		return 0
	}
}

func savePendingXrayTrafficReport(report pendingXrayTrafficReport) error {
	if strings.TrimSpace(report.Identity) == "" {
		return fmt.Errorf("Xray traffic report identity is empty")
	}
	if len(report.Baselines) == 0 {
		return fmt.Errorf("Xray traffic report has no baselines")
	}
	if _, err := normalizeXrayTrafficBaselines(report.Baselines); err != nil {
		return err
	}
	if strings.TrimSpace(fmt.Sprint(report.Payload["reportId"])) == "" {
		return fmt.Errorf("Xray traffic report id is empty")
	}
	if xrayProtocolStatsCount(report.Payload) == 0 {
		return fmt.Errorf("Xray traffic report has no protocolStats")
	}
	raw, err := json.Marshal(report)
	if err != nil {
		return err
	}
	return writeTrafficStateFile(xrayTrafficReportPendingPath(), raw, 0600)
}

func loadPendingXrayTrafficReport() (*pendingXrayTrafficReport, error) {
	raw, err := os.ReadFile(xrayTrafficReportPendingPath())
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var report pendingXrayTrafficReport
	if err := json.Unmarshal(raw, &report); err != nil {
		return nil, err
	}
	if strings.TrimSpace(report.Identity) == "" || len(report.Baselines) == 0 {
		return nil, fmt.Errorf("invalid pending Xray traffic report")
	}
	if _, err := normalizeXrayTrafficBaselines(report.Baselines); err != nil {
		return nil, err
	}
	if strings.TrimSpace(fmt.Sprint(report.Payload["reportId"])) == "" {
		return nil, fmt.Errorf("pending Xray traffic report id is empty")
	}
	if xrayProtocolStatsCount(report.Payload) == 0 {
		return nil, fmt.Errorf("pending Xray traffic report has no protocolStats")
	}
	return &report, nil
}

func sendPendingXrayTrafficReport(cfg Config, panelURL string, report pendingXrayTrafficReport) error {
	response := map[string]any{}
	if err := postXrayTrafficReportToPanel(cfg, panelURL, "/api/agent/traffic", report.Payload, &response); err != nil {
		return err
	}
	if err := commitXrayTrafficBaselines(report.Identity, report.Baselines); err != nil {
		return fmt.Errorf("commit Xray traffic baseline after ACK: %w", err)
	}
	if err := removePendingXrayTrafficReport(); err != nil {
		return fmt.Errorf("remove acknowledged Xray traffic report: %w", err)
	}
	return nil
}

func removePendingXrayTrafficReport() error {
	err := os.Remove(xrayTrafficReportPendingPath())
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if os.IsNotExist(err) {
		return nil
	}
	return syncTrafficStateDirectoryAfterMutation(trafficStateDir)
}
