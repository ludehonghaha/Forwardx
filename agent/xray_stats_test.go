package main

import (
	"reflect"
	"testing"
)

func TestParseXrayStatsAPIListen(t *testing.T) {
	output := `LISTEN 0 4096 0.0.0.0:32676 0.0.0.0:* users:(("forwardx-xray",pid=1234,fd=7))
LISTEN 0 4096 127.0.0.1:41731 0.0.0.0:* users:(("forwardx-xray",pid=1234,fd=8))
LISTEN 0 4096 127.0.0.1:9810 0.0.0.0:* users:(("forwardx-panel",pid=50,fd=9))`
	got, ok := parseXrayStatsAPIListen(output)
	if !ok || got != "127.0.0.1:41731" {
		t.Fatalf("API listen = %q, %v", got, ok)
	}
}

func TestParseXrayStatsAPIListenRejectsAmbiguousOrMissing(t *testing.T) {
	ambiguous := `LISTEN 0 4096 127.0.0.1:41001 0.0.0.0:* users:(("forwardx-xray",pid=1,fd=8))
LISTEN 0 4096 127.0.0.1:41002 0.0.0.0:* users:(("forwardx-xray",pid=1,fd=9))`
	if got, ok := parseXrayStatsAPIListen(ambiguous); ok || got != "" {
		t.Fatalf("ambiguous API listen unexpectedly accepted: %q, %v", got, ok)
	}
	if got, ok := parseXrayStatsAPIListen("LISTEN 0 4096 0.0.0.0:32676 0.0.0.0:* users:((\"forwardx-xray\",pid=1,fd=7))"); ok || got != "" {
		t.Fatalf("missing loopback API unexpectedly accepted: %q, %v", got, ok)
	}
}

func TestXrayStatsQueryArgsUsesSingleResetQuery(t *testing.T) {
	got := xrayStatsQueryArgs("127.0.0.1:41731")
	want := []string{"api", "statsquery", "--server=127.0.0.1:41731", "-pattern", xrayStatsPattern, "-reset"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("args = %#v, want %#v", got, want)
	}
}

func TestParseXrayAssignmentTrafficStats(t *testing.T) {
	raw := []byte(`{
  "stat": [
    {"name":"user>>>forwardx-assignment-5-user-2>>>traffic>>>uplink","value":"1200"},
    {"name":"user>>>forwardx-assignment-5-user-2>>>traffic>>>downlink","value":3400},
    {"name":"user>>>forwardx-assignment-6-user-3>>>traffic>>>uplink","value":"50"},
    {"name":"user>>>forwardx-parking-22>>>traffic>>>uplink","value":"999"},
    {"name":"inbound>>>fwx-reality-22>>>traffic>>>uplink","value":"999"}
  ]
}`)
	got, err := parseXrayAssignmentTrafficStats(raw)
	if err != nil {
		t.Fatal(err)
	}
	want := []xrayAssignmentTrafficStat{
		{AssignmentID: 5, BytesIn: 1200, BytesOut: 3400},
		{AssignmentID: 6, BytesIn: 50},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("stats = %#v, want %#v", got, want)
	}
}

func TestParseXrayAssignmentTrafficStatsRejectsBadCounter(t *testing.T) {
	raw := []byte(`{"stat":[{"name":"user>>>forwardx-assignment-5-user-2>>>traffic>>>uplink","value":"not-a-number"}]}`)
	if _, err := parseXrayAssignmentTrafficStats(raw); err == nil {
		t.Fatal("expected invalid counter to fail")
	}
}
