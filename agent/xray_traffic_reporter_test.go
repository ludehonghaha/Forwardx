package main

import (
	"errors"
	"os"
	"reflect"
	"testing"
)

func withXrayTrafficStateDir(t *testing.T) string {
	t.Helper()
	previous := trafficStateDir
	dir := t.TempDir()
	trafficStateDir = dir
	t.Cleanup(func() { trafficStateDir = previous })
	return dir
}

func TestBuildPendingXrayTrafficReportUsesProtocolAssignmentIds(t *testing.T) {
	report, err := buildPendingXrayTrafficReport(
		"panel-a",
		[]xrayAssignmentTrafficStat{
			{AssignmentID: 7, BytesIn: 11, BytesOut: 22},
			{AssignmentID: 9, BytesIn: 33, BytesOut: 44},
		},
		[]xrayTrafficBaseline{
			{AssignmentID: 7, BytesIn: 11, BytesOut: 22},
			{AssignmentID: 9, BytesIn: 33, BytesOut: 44},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	stats, ok := report.Payload["protocolStats"].([]map[string]any)
	if !ok || len(stats) != 2 {
		t.Fatalf("protocolStats = %#v", report.Payload["protocolStats"])
	}
	if got := stats[0]["assignmentId"]; got != 7 {
		t.Fatalf("first assignmentId = %#v, want 7", got)
	}
	if got := stats[1]["assignmentId"]; got != 9 {
		t.Fatalf("second assignmentId = %#v, want 9", got)
	}
	if report.Payload["reportId"] == "" || report.Payload["reportProducerId"] == "" {
		t.Fatalf("missing report identity fields: %#v", report.Payload)
	}
}

func TestPendingXrayReportDoesNotAdvanceBaselineBeforeAck(t *testing.T) {
	withXrayTrafficStateDir(t)
	identity := "panel-a"
	acknowledged := []xrayTrafficBaseline{{AssignmentID: 7, BytesIn: 100, BytesOut: 200}}
	if err := commitXrayTrafficBaselines(identity, acknowledged); err != nil {
		t.Fatal(err)
	}

	current := []xrayAssignmentTrafficStat{{AssignmentID: 7, BytesIn: 130, BytesOut: 260}}
	ackMap, err := loadXrayTrafficBaselines(identity)
	if err != nil {
		t.Fatal(err)
	}
	deltas, next := diffXrayAssignmentTraffic(current, ackMap)
	report, err := buildPendingXrayTrafficReport(identity, deltas, next)
	if err != nil {
		t.Fatal(err)
	}
	if err := savePendingXrayTrafficReport(report); err != nil {
		t.Fatal(err)
	}

	stillAcknowledged, err := loadXrayTrafficBaselines(identity)
	if err != nil {
		t.Fatal(err)
	}
	wantAck := map[int]xrayTrafficBaseline{7: {AssignmentID: 7, BytesIn: 100, BytesOut: 200}}
	if !reflect.DeepEqual(stillAcknowledged, wantAck) {
		t.Fatalf("baseline advanced before ACK: %#v", stillAcknowledged)
	}
	pending, err := loadPendingXrayTrafficReport()
	if err != nil {
		t.Fatal(err)
	}
	if pending == nil || pending.Identity != identity {
		t.Fatalf("pending report missing: %#v", pending)
	}

	// Simulate the post-ACK checkpoint ordering used by sendPendingXrayTrafficReport.
	if err := commitXrayTrafficBaselines(identity, pending.Baselines); err != nil {
		t.Fatal(err)
	}
	if err := removePendingXrayTrafficReport(); err != nil {
		t.Fatal(err)
	}
	advanced, err := loadXrayTrafficBaselines(identity)
	if err != nil {
		t.Fatal(err)
	}
	wantAdvanced := map[int]xrayTrafficBaseline{7: {AssignmentID: 7, BytesIn: 130, BytesOut: 260}}
	if !reflect.DeepEqual(advanced, wantAdvanced) {
		t.Fatalf("baseline after ACK = %#v, want %#v", advanced, wantAdvanced)
	}
	if _, err := os.Stat(xrayTrafficReportPendingPath()); !os.IsNotExist(err) {
		t.Fatalf("pending report still exists after completion: %v", err)
	}
}

func TestXrayBaselineIdentityMismatchIsRecognizableForReanchor(t *testing.T) {
	withXrayTrafficStateDir(t)
	if err := commitXrayTrafficBaselines("panel-a", []xrayTrafficBaseline{{AssignmentID: 5, BytesIn: 90, BytesOut: 120}}); err != nil {
		t.Fatal(err)
	}
	if _, err := loadXrayTrafficBaselines("panel-b"); !errors.Is(err, errXrayTrafficBaselineIdentityMismatch) {
		t.Fatalf("identity mismatch error = %v", err)
	}

	current := []xrayAssignmentTrafficStat{{AssignmentID: 5, BytesIn: 130, BytesOut: 150}}
	_, reanchor := diffXrayAssignmentTraffic(current, map[int]xrayTrafficBaseline{})
	if err := commitXrayTrafficBaselines("panel-b", reanchor); err != nil {
		t.Fatal(err)
	}
	got, err := loadXrayTrafficBaselines("panel-b")
	if err != nil {
		t.Fatal(err)
	}
	want := map[int]xrayTrafficBaseline{5: {AssignmentID: 5, BytesIn: 130, BytesOut: 150}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("reanchored baselines = %#v, want %#v", got, want)
	}
}
