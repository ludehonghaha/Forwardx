package main

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

type panicDualDiscoveryProvider struct{}

func (panicDualDiscoveryProvider) Platform() (dualCollectorPlatformSnapshot, error) {
	panic("provider must not be called")
}
func (panicDualDiscoveryProvider) Interfaces() ([]dualCollectorInterfaceSnapshot, error) {
	panic("provider must not be called")
}
func (panicDualDiscoveryProvider) DefaultRoute() (dualCollectorDefaultRouteSnapshot, error) {
	panic("provider must not be called")
}
func (panicDualDiscoveryProvider) MitaRuntime() (*dualCollectorMitaRuntimeSnapshot, error) {
	panic("provider must not be called")
}
func (panicDualDiscoveryProvider) InstalledBinaries() (dualCollectorInstalledBinariesSnapshot, error) {
	panic("provider must not be called")
}
func (panicDualDiscoveryProvider) ProbeLoopbackTCP(port int) (string, error) {
	panic("provider must not be called")
}

func TestDualAgentDiscoveryHandlerCoreRoundTrip(t *testing.T) {
	request := dualCollectorTestRequest("nobrand-dual-current", 24001, 24002)
	payload, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}

	handler := dualAgentDiscoveryHandlerCore{provider: noBrandLikeCollectorProvider()}
	encoded, err := handler.Handle(payload)
	if err != nil {
		t.Fatalf("handler failed: %v", err)
	}
	response, err := decodeDualAgentDiscoveryResponse(encoded)
	if err != nil {
		t.Fatalf("handler response must satisfy strict protocol: %v", err)
	}
	if err := validateDualAgentDiscoveryExchange(request, response); err != nil {
		t.Fatalf("handler exchange must remain bound to request: %v", err)
	}
	if response.Status != "ok" || response.Evidence == nil || response.Evidence.Provenance != "agent-read-only" {
		t.Fatalf("unexpected response: %#v", response)
	}
}

func TestDualAgentDiscoveryHandlerCoreRejectsUnknownRequestFieldsBeforeProvider(t *testing.T) {
	handler := dualAgentDiscoveryHandlerCore{provider: panicDualDiscoveryProvider{}}
	payload := []byte(`{"version":1}`)
	// Replace the intentionally small seed with valid JSON carrying one forbidden
	// field so the test exercises DisallowUnknownFields rather than malformed JSON.
	payload = []byte("{\"version\":1,\"operation\":\"dual-readonly-discovery\",\"requestId\":\"req-invalid\",\"targetId\":\"target-invalid\",\"portProbes\":[{\"address\":\"127.0.0.1\",\"protocol\":\"tcp\",\"candidates\":[24001]}],\"command\":\"whoami\"}")
	if _, err := handler.Handle(payload); err == nil {
		t.Fatal("unknown request fields must be rejected before provider execution")
	}
}

func TestDualAgentDiscoveryHandlerCoreEncodesCollectorFailure(t *testing.T) {
	provider := noBrandLikeCollectorProvider()
	provider.interfaces = append(provider.interfaces, dualCollectorInterfaceSnapshot{Name: "eth2", Addresses: []string{"10.0.0.8"}})
	request := dualCollectorTestRequest("ambiguous-handler-target", 24001)
	payload, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}

	handler := dualAgentDiscoveryHandlerCore{provider: provider}
	encoded, err := handler.Handle(payload)
	if err != nil {
		t.Fatalf("collector failure should be encoded as a typed protocol response: %v", err)
	}
	response, err := decodeDualAgentDiscoveryResponse(encoded)
	if err != nil {
		t.Fatalf("failed response must remain protocol-valid: %v", err)
	}
	if response.Status != "failed" || response.Error == nil || response.Error.Code != "collection-failed" {
		t.Fatalf("unexpected failed response: %#v", response)
	}
}

func TestDualAgentDiscoveryHandlerCoreHasNoTransportOrCommandSurface(t *testing.T) {
	source, err := os.ReadFile("dual_discovery_handler.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	for _, forbidden := range []string{"os/exec", "exec.Command", "net/http", "http.Handle", "systemctl", "/bin/sh", "bash -c", "ssh"} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("handler core must remain transport-free and command-free; found %q", forbidden)
		}
	}
}
