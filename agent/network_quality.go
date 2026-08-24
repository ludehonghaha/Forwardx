package main

import (
	"errors"
	"fmt"
	"math"
	"sync"
	"sync/atomic"
	"time"
)

const (
	hostNetworkQualityInterval = 30 * time.Second
	hostNetworkQualitySamples  = 5
)

type hostNetworkQualityWindow struct {
	LatencyMs         *int    `json:"latencyMs"`
	SuccessCount      int     `json:"successCount"`
	LossCount         int     `json:"lossCount"`
	PacketLossPercent float64 `json:"packetLossPercent"`
}

type hostNetworkQualitySample struct {
	latency time.Duration
	success bool
}

type hostNetworkQualityReporter func(Config, hostNetworkQualityWindow) error

var (
	hostNetworkQualityRunning int32
	hostNetworkQualityMu      sync.Mutex
	hostNetworkQualityPending []hostNetworkQualitySample
	lastHostNetworkQualityAt  time.Time
)

func summarizeHostNetworkQualitySamples(samples []time.Duration, losses int) hostNetworkQualityWindow {
	latencyTotal := time.Duration(0)
	successCount := 0
	for _, latency := range samples {
		if latency <= 0 {
			continue
		}
		latencyTotal += latency
		successCount++
	}
	if losses < 0 {
		losses = 0
	}
	total := successCount + losses
	packetLossPercent := 0.0
	if total > 0 {
		packetLossPercent = math.Round(float64(losses)*1000/float64(total)) / 10
	}
	var latencyMs *int
	if successCount > 0 {
		value := int((latencyTotal / time.Duration(successCount)).Round(time.Millisecond) / time.Millisecond)
		if value < 1 {
			value = 1
		}
		latencyMs = &value
	}
	return hostNetworkQualityWindow{
		LatencyMs:         latencyMs,
		SuccessCount:      successCount,
		LossCount:         losses,
		PacketLossPercent: packetLossPercent,
	}
}

// Presence is already an authenticated, lightweight Agent-to-Panel request.
// Only completed network attempts become samples; coordinator skips never do.
func recordHostNetworkQualityPresenceResult(latency time.Duration, err error) bool {
	if errors.Is(err, errHeartbeatRequestInFlight) || errors.Is(err, errHeartbeatRetrySuperseded) {
		return false
	}
	return recordHostNetworkQualityPresenceSample(latency, err == nil)
}

func recordHostNetworkQualityPresenceSample(latency time.Duration, success bool) bool {
	hostNetworkQualityMu.Lock()
	defer hostNetworkQualityMu.Unlock()
	if len(hostNetworkQualityPending) >= hostNetworkQualitySamples {
		return false
	}
	if !success {
		latency = 0
	} else if latency <= 0 {
		return false
	}
	hostNetworkQualityPending = append(hostNetworkQualityPending, hostNetworkQualitySample{
		latency: latency,
		success: success,
	})
	return true
}

func reportHostNetworkQuality(cfg Config, window hostNetworkQualityWindow) error {
	return post(cfg, "/api/agent/network-quality", window, &map[string]any{})
}

func scheduleHostNetworkQualityCollectionWith(cfg Config, report hostNetworkQualityReporter) bool {
	hostNetworkQualityMu.Lock()
	due := lastHostNetworkQualityAt.IsZero() || time.Since(lastHostNetworkQualityAt) >= hostNetworkQualityInterval
	ready := len(hostNetworkQualityPending) >= hostNetworkQualitySamples
	if due && ready && atomic.CompareAndSwapInt32(&hostNetworkQualityRunning, 0, 1) {
		lastHostNetworkQualityAt = time.Now()
	} else {
		hostNetworkQualityMu.Unlock()
		return false
	}
	samples := append([]hostNetworkQualitySample(nil), hostNetworkQualityPending[:hostNetworkQualitySamples]...)
	hostNetworkQualityMu.Unlock()

	go func() {
		defer atomic.StoreInt32(&hostNetworkQualityRunning, 0)
		latencies := make([]time.Duration, 0, hostNetworkQualitySamples)
		losses := 0
		for _, sample := range samples {
			if sample.success && sample.latency > 0 {
				latencies = append(latencies, sample.latency)
			} else {
				losses++
			}
		}
		window := summarizeHostNetworkQualitySamples(latencies, losses)
		if err := report(cfg, window); err != nil {
			if isTransientAgentCommError(err) {
				logAgentCommError("network-quality-report", err)
			} else if shouldLogAgentReport("network-quality-report-failed", agentReportLogInterval) {
				logf("network quality report failed success=%d loss=%d: %v", window.SuccessCount, window.LossCount, err)
			}
			return
		}
		hostNetworkQualityMu.Lock()
		if len(hostNetworkQualityPending) >= hostNetworkQualitySamples {
			hostNetworkQualityPending = hostNetworkQualityPending[hostNetworkQualitySamples:]
		}
		hostNetworkQualityMu.Unlock()
	}()
	return true
}

func scheduleHostNetworkQualityCollection(cfg Config) bool {
	return scheduleHostNetworkQualityCollectionWith(cfg, reportHostNetworkQuality)
}

func validateHostNetworkQualityWindow(window hostNetworkQualityWindow) error {
	total := window.SuccessCount + window.LossCount
	if window.SuccessCount < 0 || window.LossCount < 0 || total <= 0 || total > 100 {
		return fmt.Errorf("invalid sample counts")
	}
	if window.SuccessCount > 0 && (window.LatencyMs == nil || *window.LatencyMs <= 0) {
		return fmt.Errorf("successful samples require latency")
	}
	if window.SuccessCount == 0 && window.LatencyMs != nil {
		return fmt.Errorf("failed samples must not contain latency")
	}
	return nil
}
