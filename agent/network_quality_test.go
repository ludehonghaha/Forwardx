package main

import (
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

func TestSummarizeHostNetworkQualityNormalRTT(t *testing.T) {
	window := summarizeHostNetworkQualitySamples([]time.Duration{
		10 * time.Millisecond,
		20 * time.Millisecond,
		30 * time.Millisecond,
		40 * time.Millisecond,
		50 * time.Millisecond,
	}, 0)
	if window.LatencyMs == nil || *window.LatencyMs != 30 {
		t.Fatalf("latency=%v want=30", window.LatencyMs)
	}
	if window.SuccessCount != 5 || window.LossCount != 0 || window.PacketLossPercent != 0 {
		t.Fatalf("unexpected window: %+v", window)
	}
}

func TestSummarizeHostNetworkQualityPartialLoss(t *testing.T) {
	window := summarizeHostNetworkQualitySamples([]time.Duration{10 * time.Millisecond, 20 * time.Millisecond, 30 * time.Millisecond}, 2)
	if window.LatencyMs == nil || *window.LatencyMs != 20 {
		t.Fatalf("latency=%v want=20", window.LatencyMs)
	}
	if window.SuccessCount != 3 || window.LossCount != 2 || window.PacketLossPercent != 40.0 {
		t.Fatalf("unexpected partial-loss window: %+v", window)
	}
}

func TestSummarizeHostNetworkQualityAllFailed(t *testing.T) {
	window := summarizeHostNetworkQualitySamples(nil, 5)
	if window.LatencyMs != nil {
		t.Fatalf("all-failed latency=%v want=nil", *window.LatencyMs)
	}
	if window.SuccessCount != 0 || window.LossCount != 5 || window.PacketLossPercent != 100.0 {
		t.Fatalf("unexpected all-failed window: %+v", window)
	}
}

func TestHostNetworkQualityUsesOutboundPanelPathForNATAgent(t *testing.T) {
	resetHostNetworkQualityTestState()
	t.Cleanup(resetHostNetworkQualityTestState)

	cfg := Config{PanelURL: "https://panel.example.test", Token: "token"}
	for index := 1; index <= 5; index++ {
		recordHostNetworkQualityPresenceSample(time.Duration(index)*time.Millisecond, index != 4)
	}
	reported := make(chan hostNetworkQualityWindow, 1)
	if !scheduleHostNetworkQualityCollectionWith(
		cfg, func(got Config, value hostNetworkQualityWindow) error {
			if got.PanelURL != cfg.PanelURL {
				t.Fatalf("report panel=%q want=%q", got.PanelURL, cfg.PanelURL)
			}
			reported <- value
			return nil
		},
	) {
		t.Fatal("five outbound presence samples should schedule one report")
	}
	select {
	case window := <-reported:
		if window.SuccessCount != 4 || window.LossCount != 1 || window.PacketLossPercent != 20.0 {
			t.Fatalf("unexpected outbound presence window=%+v", window)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for outbound network quality report")
	}
}

func TestHostNetworkQualityNoDataDoesNotSchedule(t *testing.T) {
	resetHostNetworkQualityTestState()
	t.Cleanup(resetHostNetworkQualityTestState)
	if scheduleHostNetworkQualityCollectionWith(Config{}, func(Config, hostNetworkQualityWindow) error {
		return errors.New("must not report")
	}) {
		t.Fatal("no-data window must not be reported as packet loss")
	}
}

func TestHostNetworkQualitySkipsPresenceRequestsThatWereNotSent(t *testing.T) {
	resetHostNetworkQualityTestState()
	t.Cleanup(resetHostNetworkQualityTestState)
	if recordHostNetworkQualityPresenceResult(time.Millisecond, errHeartbeatRequestInFlight) {
		t.Fatal("in-flight coordinator skip must not become packet loss")
	}
	if recordHostNetworkQualityPresenceResult(time.Millisecond, errHeartbeatRetrySuperseded) {
		t.Fatal("superseded retry must not become packet loss")
	}
	if !recordHostNetworkQualityPresenceResult(time.Second, errors.New("actual request timeout")) {
		t.Fatal("an actual failed outbound request must become a loss sample")
	}
	hostNetworkQualityMu.Lock()
	defer hostNetworkQualityMu.Unlock()
	if len(hostNetworkQualityPending) != 1 || hostNetworkQualityPending[0].success {
		t.Fatalf("unexpected presence samples: %+v", hostNetworkQualityPending)
	}
}

func resetHostNetworkQualityTestState() {
	hostNetworkQualityMu.Lock()
	hostNetworkQualityPending = nil
	lastHostNetworkQualityAt = time.Time{}
	hostNetworkQualityMu.Unlock()
	atomic.StoreInt32(&hostNetworkQualityRunning, 0)
}

func TestParsePingPacketCounts(t *testing.T) {
	tests := []struct {
		name     string
		output   string
		sent     int
		received int
	}{
		{name: "linux partial", output: "5 packets transmitted, 3 received, 40% packet loss", sent: 5, received: 3},
		{name: "mac all failed", output: "5 packets transmitted, 0 packets received, 100.0% packet loss", sent: 5, received: 0},
		{name: "windows success", output: "Packets: Sent = 5, Received = 5, Lost = 0 (0% loss)", sent: 5, received: 5},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			sent, received, ok := parsePingPacketCounts(test.output)
			if !ok || sent != test.sent || received != test.received {
				t.Fatalf("got sent=%d received=%d ok=%v", sent, received, ok)
			}
		})
	}
}
