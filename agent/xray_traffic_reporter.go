package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
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
	Payload   map[string]any        `json:"payload"`
	Identity  string                `json:"identity"`
	Baselines []xrayTrafficBaseline `json:"baselines"`
}

var xrayTrafficReporterMu sync.Mutex

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
	// Keep the token bytes exact: trafficReportIdentityForPanel and encrypted
	// Agent auth intentionally use the configured token without normalization.
	cfg := Config{PanelURL: panelURL, Token: token, Interval: 30}
	return cfg, panelURL, true
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

	current, err := collectXrayAssignmentTraffic()
	if err != nil {
		return err
	}
	if len(current) == 0 {
		return nil
	}
	acknowledged, err := loadXrayTrafficBaselines(identity)
	if err != nil {
		return fmt.Errorf("load Xray traffic baselines: %w", err)
	}
	deltas, nextBaselines := diffXrayAssignmentTraffic(current, acknowledged)
	if len(deltas) == 0 {
		return nil
	}

	protocolStats := make([]map[string]any, 0, len(deltas))
	for _, delta := range deltas {
		if delta.BytesIn > xrayTrafficMaxSafeInteger || delta.BytesOut > xrayTrafficMaxSafeInteger {
			return fmt.Errorf("Xray traffic delta exceeds Panel safe integer for assignment %d", delta.AssignmentID)
		}
		protocolStats = append(protocolStats, map[string]any{
			"assignmentId": delta.AssignmentID,
			"bytesIn":      delta.BytesIn,
			"bytesOut":     delta.BytesOut,
		})
	}

	report := pendingXrayTrafficReport{
		Payload: map[string]any{
			"stats":            []map[string]any{},
			"protocolStats":    protocolStats,
			"reportId":         newTrafficReportID(),
			"reportProducerId": trafficReportProducerID(identity),
		},
		Identity:  identity,
		Baselines: nextBaselines,
	}
	if err := savePendingXrayTrafficReport(report); err != nil {
		return fmt.Errorf("persist Xray traffic report: %w", err)
	}
	return sendPendingXrayTrafficReport(cfg, panelURL, report)
}

func collectXrayAssignmentTraffic() ([]xrayAssignmentTrafficStat, error) {
	ctx, cancel := context.WithTimeout(context.Background(), xrayTrafficQueryTimeout)
	defer cancel()

	ssOutput, err := exec.CommandContext(ctx, "ss", "-H", "-lntp").CombinedOutput()
	if err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("discover Xray stats API: %w", ctx.Err())
		}
		return nil, fmt.Errorf("discover Xray stats API: %w", err)
	}
	server, ok := parseXrayStatsAPIListen(string(ssOutput))
	if !ok {
		return nil, nil
	}

	queryCtx, queryCancel := context.WithTimeout(context.Background(), xrayTrafficQueryTimeout)
	defer queryCancel()
	output, err := exec.CommandContext(queryCtx, xrayBinaryPath, xrayStatsQueryArgs(server)...).CombinedOutput()
	if err != nil {
		if queryCtx.Err() != nil {
			return nil, fmt.Errorf("query Xray stats: %w", queryCtx.Err())
		}
		message := strings.TrimSpace(string(output))
		if message == "" {
			return nil, fmt.Errorf("query Xray stats: %w", err)
		}
		return nil, fmt.Errorf("query Xray stats: %w: %s", err, compactLogOutput(message))
	}
	stats, err := parseXrayAssignmentTrafficStats(output)
	if err != nil {
		return nil, fmt.Errorf("parse Xray stats: %w", err)
	}
	return stats, nil
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
	if xrayTrafficStringValue(report.Payload["reportId"]) == "" {
		return fmt.Errorf("Xray traffic report id is empty")
	}
	stats, ok := report.Payload["protocolStats"].([]map[string]any)
	if !ok || len(stats) == 0 {
		return fmt.Errorf("Xray traffic report has no protocol stats")
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
	if xrayTrafficStringValue(report.Payload["reportId"]) == "" {
		return nil, fmt.Errorf("pending Xray traffic report id is empty")
	}
	if stats, ok := report.Payload["protocolStats"].([]any); !ok || len(stats) == 0 {
		return nil, fmt.Errorf("pending Xray traffic report has no protocol stats")
	}
	return &report, nil
}

func sendPendingXrayTrafficReport(cfg Config, panelURL string, report pendingXrayTrafficReport) error {
	response := map[string]any{}
	if err := postToPanelURL(cfg, panelURL, "/api/agent/traffic", report.Payload, &response); err != nil {
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

func xrayTrafficStringValue(value any) string {
	if value == nil {
		return ""
	}
	text, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(text)
}
