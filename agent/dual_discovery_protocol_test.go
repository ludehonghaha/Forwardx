package main

import (
	"os"
	"strings"
	"testing"
)

func readDualDiscoveryFixture(t *testing.T, name string) []byte {
	t.Helper()
	data, err := os.ReadFile("../shared/fixtures/" + name)
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return data
}

func TestDualAgentDiscoveryRequestFixture(t *testing.T) {
	request, err := decodeDualAgentDiscoveryRequest(readDualDiscoveryFixture(t, "dual-agent-discovery-request-v1.json"))
	if err != nil {
		t.Fatalf("decode request: %v", err)
	}
	if request.Version != dualAgentDiscoveryProtocolVersion || request.Operation != dualAgentDiscoveryOperation {
		t.Fatalf("unexpected protocol: version=%d operation=%q", request.Version, request.Operation)
	}
	if request.RequestID != "fixture-request-1" || request.TargetID != "fixture-dual-agent" {
		t.Fatalf("unexpected binding: request=%q target=%q", request.RequestID, request.TargetID)
	}
	if len(request.PortProbes) != 1 || len(request.PortProbes[0].Candidates) != 2 {
		t.Fatalf("unexpected port probes: %#v", request.PortProbes)
	}
	if request.PortProbes[0].Address != "127.0.0.1" || request.PortProbes[0].Protocol != "tcp" {
		t.Fatalf("port probe escaped loopback/tcp boundary: %#v", request.PortProbes[0])
	}
}

func TestDualAgentDiscoveryResponseFixtureAndBinding(t *testing.T) {
	request, err := decodeDualAgentDiscoveryRequest(readDualDiscoveryFixture(t, "dual-agent-discovery-request-v1.json"))
	if err != nil {
		t.Fatalf("decode request: %v", err)
	}
	response, err := decodeDualAgentDiscoveryResponse(readDualDiscoveryFixture(t, "dual-agent-discovery-response-v1.json"))
	if err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if err := validateDualAgentDiscoveryExchange(request, response); err != nil {
		t.Fatalf("validate exchange: %v", err)
	}
	if response.Status != "ok" || response.Evidence == nil {
		t.Fatalf("expected ok evidence response: %#v", response)
	}
	if response.Evidence.Provenance != "agent-read-only" || response.Evidence.TargetID != request.TargetID {
		t.Fatalf("unexpected evidence provenance/target: %#v", response.Evidence)
	}
}

func TestDualAgentDiscoveryExchangeRejectsBindingMismatch(t *testing.T) {
	request, err := decodeDualAgentDiscoveryRequest(readDualDiscoveryFixture(t, "dual-agent-discovery-request-v1.json"))
	if err != nil {
		t.Fatalf("decode request: %v", err)
	}
	response, err := decodeDualAgentDiscoveryResponse(readDualDiscoveryFixture(t, "dual-agent-discovery-response-v1.json"))
	if err != nil {
		t.Fatalf("decode response: %v", err)
	}
	response.RequestID = "other-request"
	if err := validateDualAgentDiscoveryExchange(request, response); err == nil || !strings.Contains(err.Error(), "requestId mismatch") {
		t.Fatalf("expected requestId mismatch, got %v", err)
	}
}

func TestDualAgentDiscoveryRequestRejectsUnknownExecutorField(t *testing.T) {
	payload := []byte(`{
		"version":1,
		"operation":"dual-readonly-discovery",
		"requestId":"r1",
		"targetId":"t1",
		"portProbes":[],
		"command":"ip route"
	}`)
	if _, err := decodeDualAgentDiscoveryRequest(payload); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("expected strict unknown-field rejection, got %v", err)
	}
}

func TestDualAgentDiscoveryRequestRejectsUnsafeOrAmbiguousPorts(t *testing.T) {
	unsafe := dualAgentDiscoveryRequest{
		Version: dualAgentDiscoveryProtocolVersion,
		Operation: dualAgentDiscoveryOperation,
		RequestID: "r1",
		TargetID: "t1",
		PortProbes: []dualAgentDiscoveryPortProbeRequest{{Address: "0.0.0.0", Protocol: "tcp", Candidates: []int{24001}}},
	}
	if err := validateDualAgentDiscoveryRequest(unsafe); err == nil {
		t.Fatal("expected non-loopback probe rejection")
	}
	duplicate := dualAgentDiscoveryRequest{
		Version: dualAgentDiscoveryProtocolVersion,
		Operation: dualAgentDiscoveryOperation,
		RequestID: "r1",
		TargetID: "t1",
		PortProbes: []dualAgentDiscoveryPortProbeRequest{{Address: "127.0.0.1", Protocol: "tcp", Candidates: []int{24001, 24001}}},
	}
	if err := validateDualAgentDiscoveryRequest(duplicate); err == nil {
		t.Fatal("expected duplicate candidate rejection")
	}
}

func TestDualAgentDiscoveryProtocolSourceHasNoExecutor(t *testing.T) {
	source, err := os.ReadFile("dual_discovery_protocol.go")
	if err != nil {
		t.Fatalf("read source: %v", err)
	}
	text := string(source)
	for _, forbidden := range []string{"os/exec", "exec.Command", "sh -c", "bash -c", "systemctl", "iptables", "nft ", "sudo "} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("read-only protocol unexpectedly contains executor surface %q", forbidden)
		}
	}
}
