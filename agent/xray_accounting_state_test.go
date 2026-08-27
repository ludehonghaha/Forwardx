package main

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestDecodeXrayTrafficBaselineStateBindsIdentity(t *testing.T) {
	state := persistedXrayTrafficBaselineState{
		Schema:   xrayTrafficBaselineSchema,
		Identity: "panel-a",
		Baselines: []xrayTrafficBaseline{
			{AssignmentID: 6, BytesIn: 60, BytesOut: 70},
			{AssignmentID: 5, BytesIn: 10, BytesOut: 20},
		},
	}
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}

	got, err := decodeXrayTrafficBaselineState(raw, "panel-a")
	if err != nil {
		t.Fatal(err)
	}
	want := map[int]xrayTrafficBaseline{
		5: {AssignmentID: 5, BytesIn: 10, BytesOut: 20},
		6: {AssignmentID: 6, BytesIn: 60, BytesOut: 70},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("baselines = %#v, want %#v", got, want)
	}
	if _, err := decodeXrayTrafficBaselineState(raw, "panel-b"); err == nil {
		t.Fatal("expected identity mismatch to fail")
	}
}

func TestNormalizeXrayTrafficBaselinesRejectsDuplicateAssignment(t *testing.T) {
	_, err := normalizeXrayTrafficBaselines([]xrayTrafficBaseline{
		{AssignmentID: 5, BytesIn: 1},
		{AssignmentID: 5, BytesOut: 2},
	})
	if err == nil {
		t.Fatal("expected duplicate assignment baseline to fail")
	}
}
