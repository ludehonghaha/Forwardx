package main

import (
	"reflect"
	"testing"
)

func TestParseMieruAssignmentTrafficStats(t *testing.T) {
	raw := []byte(`2026/08/26 12:00:00 INFO {
  "traffic": {"UploadBytes": 999},
  "users": {
    "legacy-user": {"DownloadBytes": 200, "UploadBytes": 100},
    "forwardx-8-11": {"UploadBytes": 300, "DownloadBytes": 400}
  }
}`)
	stats, err := parseMieruAssignmentTrafficStats(raw)
	if err != nil {
		t.Fatal(err)
	}
	want := []mieruAssignmentTrafficStat{
		{Username: "forwardx-8-11", BytesIn: 300, BytesOut: 400},
		{Username: "legacy-user", BytesIn: 100, BytesOut: 200},
	}
	if !reflect.DeepEqual(stats, want) {
		t.Fatalf("stats = %#v, want %#v", stats, want)
	}
}

func TestDiffMieruAssignmentTrafficFirstObservationIsBaselineOnly(t *testing.T) {
	current := []mieruAssignmentTrafficStat{
		{Username: "legacy-user", BytesIn: 1000, BytesOut: 2000},
		{Username: "forwardx-8-11", BytesIn: 3000, BytesOut: 4000},
	}
	deltas, next := diffMieruAssignmentTraffic(current, map[string]mieruTrafficBaseline{}, false)
	if len(deltas) != 0 {
		t.Fatalf("first observation deltas = %#v, want none", deltas)
	}
	if len(next) != 2 {
		t.Fatalf("next baselines len = %d, want 2", len(next))
	}
}

func TestDiffMieruAssignmentTrafficCountsNewUserAfterInitialization(t *testing.T) {
	ack := map[string]mieruTrafficBaseline{
		"legacy-user": {Username: "legacy-user", BytesIn: 100, BytesOut: 200},
	}
	current := []mieruAssignmentTrafficStat{
		{Username: "legacy-user", BytesIn: 130, BytesOut: 260},
		{Username: "new-user", BytesIn: 11, BytesOut: 22},
	}
	deltas, _ := diffMieruAssignmentTraffic(current, ack, true)
	want := []mieruAssignmentTrafficStat{
		{Username: "legacy-user", BytesIn: 30, BytesOut: 60},
		{Username: "new-user", BytesIn: 11, BytesOut: 22},
	}
	if !reflect.DeepEqual(deltas, want) {
		t.Fatalf("deltas = %#v, want %#v", deltas, want)
	}
}

func TestDiffMieruAssignmentTrafficKeepsUsersIsolated(t *testing.T) {
	ack := map[string]mieruTrafficBaseline{
		"a": {Username: "a", BytesIn: 100, BytesOut: 200},
		"b": {Username: "b", BytesIn: 1000, BytesOut: 2000},
	}
	current := []mieruAssignmentTrafficStat{
		{Username: "a", BytesIn: 130, BytesOut: 260},
		{Username: "b", BytesIn: 1010, BytesOut: 2020},
	}
	deltas, _ := diffMieruAssignmentTraffic(current, ack, true)
	want := []mieruAssignmentTrafficStat{
		{Username: "a", BytesIn: 30, BytesOut: 60},
		{Username: "b", BytesIn: 10, BytesOut: 20},
	}
	if !reflect.DeepEqual(deltas, want) {
		t.Fatalf("deltas = %#v, want %#v", deltas, want)
	}
}

func TestDiffMieruAssignmentTrafficHandlesCounterReset(t *testing.T) {
	ack := map[string]mieruTrafficBaseline{
		"a": {Username: "a", BytesIn: 1000, BytesOut: 2000},
	}
	current := []mieruAssignmentTrafficStat{{Username: "a", BytesIn: 12, BytesOut: 34}}
	deltas, _ := diffMieruAssignmentTraffic(current, ack, true)
	want := []mieruAssignmentTrafficStat{{Username: "a", BytesIn: 12, BytesOut: 34}}
	if !reflect.DeepEqual(deltas, want) {
		t.Fatalf("reset deltas = %#v, want %#v", deltas, want)
	}
}

func TestDiffMieruAssignmentTrafficRetainsMissingBaseline(t *testing.T) {
	ack := map[string]mieruTrafficBaseline{
		"idle": {Username: "idle", BytesIn: 7, BytesOut: 9},
	}
	_, next := diffMieruAssignmentTraffic(nil, ack, true)
	if len(next) != 1 || next[0].Username != "idle" || next[0].BytesIn != 7 || next[0].BytesOut != 9 {
		t.Fatalf("retained baseline = %#v", next)
	}
}
