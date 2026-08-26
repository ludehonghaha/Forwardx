package main

import (
	"reflect"
	"testing"
)

func TestXrayCounterDeltaHandlesRuntimeReset(t *testing.T) {
	if got := xrayCounterDelta(130, 100); got != 30 {
		t.Fatalf("normal delta = %d, want 30", got)
	}
	if got := xrayCounterDelta(15, 900); got != 15 {
		t.Fatalf("reset delta = %d, want 15", got)
	}
}

func TestDiffXrayAssignmentTrafficUsesAcknowledgedBaseline(t *testing.T) {
	current := []xrayAssignmentTrafficStat{
		{AssignmentID: 6, BytesIn: 75, BytesOut: 80},
		{AssignmentID: 5, BytesIn: 130, BytesOut: 260},
	}
	acknowledged := map[int]xrayTrafficBaseline{
		5: {AssignmentID: 5, BytesIn: 100, BytesOut: 200},
		6: {AssignmentID: 6, BytesIn: 75, BytesOut: 80},
	}

	deltas, next := diffXrayAssignmentTraffic(current, acknowledged)
	wantDeltas := []xrayAssignmentTrafficStat{
		{AssignmentID: 5, BytesIn: 30, BytesOut: 60},
	}
	wantNext := []xrayTrafficBaseline{
		{AssignmentID: 5, BytesIn: 130, BytesOut: 260},
		{AssignmentID: 6, BytesIn: 75, BytesOut: 80},
	}
	if !reflect.DeepEqual(deltas, wantDeltas) {
		t.Fatalf("deltas = %#v, want %#v", deltas, wantDeltas)
	}
	if !reflect.DeepEqual(next, wantNext) {
		t.Fatalf("next baselines = %#v, want %#v", next, wantNext)
	}
}

func TestDiffXrayAssignmentTrafficReportsNewEpochAfterReset(t *testing.T) {
	current := []xrayAssignmentTrafficStat{
		{AssignmentID: 5, BytesIn: 15, BytesOut: 20},
		{AssignmentID: 7, BytesIn: 9, BytesOut: 11},
	}
	acknowledged := map[int]xrayTrafficBaseline{
		5: {AssignmentID: 5, BytesIn: 900, BytesOut: 800},
	}

	deltas, next := diffXrayAssignmentTraffic(current, acknowledged)
	wantDeltas := []xrayAssignmentTrafficStat{
		{AssignmentID: 5, BytesIn: 15, BytesOut: 20},
		{AssignmentID: 7, BytesIn: 9, BytesOut: 11},
	}
	wantNext := []xrayTrafficBaseline{
		{AssignmentID: 5, BytesIn: 15, BytesOut: 20},
		{AssignmentID: 7, BytesIn: 9, BytesOut: 11},
	}
	if !reflect.DeepEqual(deltas, wantDeltas) {
		t.Fatalf("reset deltas = %#v, want %#v", deltas, wantDeltas)
	}
	if !reflect.DeepEqual(next, wantNext) {
		t.Fatalf("reset baselines = %#v, want %#v", next, wantNext)
	}
}
