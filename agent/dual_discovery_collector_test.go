package main

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
)

type fakeDualDiscoveryCollectorProvider struct {
	platform   dualCollectorPlatformSnapshot
	interfaces []dualCollectorInterfaceSnapshot
	route      dualCollectorDefaultRouteSnapshot
	mita       *dualCollectorMitaRuntimeSnapshot
	binaries   dualCollectorInstalledBinariesSnapshot
	ports      map[int]string
	portErrors map[int]error
	platformErr error
	interfacesErr error
	routeErr error
	mitaErr error
	binariesErr error
}

func (f fakeDualDiscoveryCollectorProvider) Platform() (dualCollectorPlatformSnapshot, error) {
	return f.platform, f.platformErr
}

func (f fakeDualDiscoveryCollectorProvider) Interfaces() ([]dualCollectorInterfaceSnapshot, error) {
	return f.interfaces, f.interfacesErr
}

func (f fakeDualDiscoveryCollectorProvider) DefaultRoute() (dualCollectorDefaultRouteSnapshot, error) {
	return f.route, f.routeErr
}

func (f fakeDualDiscoveryCollectorProvider) MitaRuntime() (*dualCollectorMitaRuntimeSnapshot, error) {
	return f.mita, f.mitaErr
}

func (f fakeDualDiscoveryCollectorProvider) InstalledBinaries() (dualCollectorInstalledBinariesSnapshot, error) {
	return f.binaries, f.binariesErr
}

func (f fakeDualDiscoveryCollectorProvider) ProbeLoopbackTCP(port int) (string, error) {
	if err := f.portErrors[port]; err != nil {
		return "", err
	}
	if value, ok := f.ports[port]; ok {
		return value, nil
	}
	return "unknown", nil
}

func dualCollectorTestRequest(target string, candidates ...int) dualAgentDiscoveryRequest {
	return dualAgentDiscoveryRequest{
		Version:   dualAgentDiscoveryProtocolVersion,
		Operation: dualAgentDiscoveryOperation,
		RequestID: "req-collector-test",
		TargetID:  target,
		PortProbes: []dualAgentDiscoveryPortProbeRequest{{
			Address:    "127.0.0.1",
			Protocol:   "tcp",
			Candidates: candidates,
		}},
	}
}

func noBrandLikeCollectorProvider() fakeDualDiscoveryCollectorProvider {
	binary := "/usr/local/bin/mita"
	return fakeDualDiscoveryCollectorProvider{
		platform: dualCollectorPlatformSnapshot{Kernel: "linux", Architecture: "x86_64"},
		interfaces: []dualCollectorInterfaceSnapshot{
			{Name: "eth0", Addresses: []string{"87.86.22.221"}},
			{Name: "eth1", Addresses: []string{"172.16.4.114"}},
		},
		route: dualCollectorDefaultRouteSnapshot{Dev: "eth0", Via: "87.86.22.1", SourceAddress: "87.86.22.221"},
		mita: &dualCollectorMitaRuntimeSnapshot{
			BinaryPath:    &binary,
			ServiceStatus: "active",
			Listener:      dualCollectorListenerSnapshot{Network: "tcp", Listen: "*", Port: 11464},
		},
		binaries: dualCollectorInstalledBinariesSnapshot{SingBox: true, Hysteria: false, StandaloneMieru: false},
		ports: map[int]string{24001: "occupied", 24002: "available", 24003: "invalid-provider-value"},
		portErrors: map[int]error{24004: errors.New("probe unavailable")},
	}
}

func decodeCollectorObservations(t *testing.T, response dualAgentDiscoveryResponse) []map[string]any {
	t.Helper()
	if response.Evidence == nil {
		t.Fatalf("expected evidence, got %#v", response.Error)
	}
	result := make([]map[string]any, 0, len(response.Evidence.Observations))
	for _, raw := range response.Evidence.Observations {
		var observation map[string]any
		if err := json.Unmarshal(raw, &observation); err != nil {
			t.Fatalf("decode observation: %v", err)
		}
		result = append(result, observation)
	}
	return result
}

func findCollectorObservation(t *testing.T, observations []map[string]any, kind string, predicate func(map[string]any) bool) map[string]any {
	t.Helper()
	for _, observation := range observations {
		if observation["kind"] == kind && (predicate == nil || predicate(observation)) {
			return observation
		}
	}
	t.Fatalf("missing %s observation", kind)
	return nil
}

func TestCollectDualAgentDiscoveryNoBrandLikeFacts(t *testing.T) {
	request := dualCollectorTestRequest("nobrand-dual-current", 24001, 24002, 24003, 24004)
	response := collectDualAgentDiscovery(request, noBrandLikeCollectorProvider())

	if response.Status != "ok" {
		t.Fatalf("expected ok response, got %#v", response.Error)
	}
	if err := validateDualAgentDiscoveryExchange(request, response); err != nil {
		t.Fatalf("collector response must satisfy fixed protocol: %v", err)
	}
	if response.Evidence == nil || response.Evidence.Provenance != "agent-read-only" {
		t.Fatalf("collector evidence must be agent-read-only: %#v", response.Evidence)
	}

	observations := decodeCollectorObservations(t, response)
	privateSide := findCollectorObservation(t, observations, "private-side", nil)
	if privateSide["interfaceName"] != "eth1" || privateSide["sourceAddress"] != "172.16.4.114" {
		t.Fatalf("unexpected private side: %#v", privateSide)
	}
	mita := findCollectorObservation(t, observations, "mita-runtime", nil)
	listener, ok := mita["listener"].(map[string]any)
	if !ok {
		t.Fatalf("missing typed listener: %#v", mita)
	}
	if listener["network"] != "tcp" || listener["listen"] != "*" || listener["port"] != float64(11464) {
		t.Fatalf("unexpected Mita listener: %#v", listener)
	}

	expectedPorts := map[float64]string{
		24001: "occupied",
		24002: "available",
		24003: "unknown",
		24004: "unknown",
	}
	for port, availability := range expectedPorts {
		observation := findCollectorObservation(t, observations, "port-probe", func(candidate map[string]any) bool {
			return candidate["port"] == port
		})
		if observation["address"] != "127.0.0.1" || observation["protocol"] != "tcp" || observation["availability"] != availability {
			t.Fatalf("unexpected port evidence for %.0f: %#v", port, observation)
		}
	}
}

func TestCollectDualAgentDiscoverySyntheticInterfaceNamesNeedNoSchemaChange(t *testing.T) {
	binary := "/opt/mita/bin/mita"
	provider := fakeDualDiscoveryCollectorProvider{
		platform: dualCollectorPlatformSnapshot{Kernel: "linux", Architecture: "amd64"},
		interfaces: []dualCollectorInterfaceSnapshot{
			{Name: "ens3", Addresses: []string{"203.0.113.20"}},
			{Name: "ens8", Addresses: []string{"10.44.0.12"}},
		},
		route: dualCollectorDefaultRouteSnapshot{Dev: "ens3", Via: "203.0.113.1", SourceAddress: "203.0.113.20"},
		mita: &dualCollectorMitaRuntimeSnapshot{
			BinaryPath: &binary, ServiceStatus: "active",
			Listener: dualCollectorListenerSnapshot{Network: "tcp", Listen: "0.0.0.0", Port: 22464},
		},
		binaries: dualCollectorInstalledBinariesSnapshot{},
		ports: map[int]string{25001: "available"},
	}
	request := dualCollectorTestRequest("synthetic-dual-b", 25001)
	response := collectDualAgentDiscovery(request, provider)
	if response.Status != "ok" {
		t.Fatalf("expected synthetic Dual to collect without source changes: %#v", response.Error)
	}
	observations := decodeCollectorObservations(t, response)
	privateSide := findCollectorObservation(t, observations, "private-side", nil)
	if privateSide["interfaceName"] != "ens8" || privateSide["sourceAddress"] != "10.44.0.12" {
		t.Fatalf("unexpected synthetic private side: %#v", privateSide)
	}
	mita := findCollectorObservation(t, observations, "mita-runtime", nil)
	listener := mita["listener"].(map[string]any)
	if listener["port"] != float64(22464) {
		t.Fatalf("unexpected synthetic Mita listener: %#v", listener)
	}
}

func TestCollectDualAgentDiscoveryFailsClosedOnAmbiguousPrivateSide(t *testing.T) {
	provider := noBrandLikeCollectorProvider()
	provider.interfaces = append(provider.interfaces, dualCollectorInterfaceSnapshot{Name: "eth2", Addresses: []string{"10.0.0.8"}})
	response := collectDualAgentDiscovery(dualCollectorTestRequest("ambiguous", 24001), provider)
	if response.Status != "failed" || response.Error == nil || response.Error.Code != "collection-failed" {
		t.Fatalf("ambiguous private side must fail closed: %#v", response)
	}
	if !strings.Contains(response.Error.Message, "ambiguous") {
		t.Fatalf("expected ambiguity reason, got %q", response.Error.Message)
	}
}

func TestCollectDualAgentDiscoveryFailsClosedWhenDefaultRouteDoesNotBind(t *testing.T) {
	provider := noBrandLikeCollectorProvider()
	provider.route.SourceAddress = "87.86.22.222"
	response := collectDualAgentDiscovery(dualCollectorTestRequest("route-mismatch", 24001), provider)
	if response.Status != "failed" || response.Error == nil {
		t.Fatalf("route/source mismatch must fail closed: %#v", response)
	}
	if !strings.Contains(response.Error.Message, "not assigned") {
		t.Fatalf("expected source binding reason, got %q", response.Error.Message)
	}
}

func TestCollectDualAgentDiscoveryAllowsMissingMitaAsEvidenceGap(t *testing.T) {
	provider := noBrandLikeCollectorProvider()
	provider.mita = nil
	response := collectDualAgentDiscovery(dualCollectorTestRequest("mita-missing", 24002), provider)
	if response.Status != "ok" {
		t.Fatalf("missing Mita should remain an evidence gap for readiness, not be fabricated: %#v", response.Error)
	}
	observations := decodeCollectorObservations(t, response)
	for _, observation := range observations {
		if observation["kind"] == "mita-runtime" {
			t.Fatalf("collector must not fabricate Mita runtime: %#v", observation)
		}
	}
}

func TestDualDiscoveryCollectorCoreHasNoCommandExecutionSurface(t *testing.T) {
	source, err := os.ReadFile("dual_discovery_collector.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	for _, forbidden := range []string{"os/exec", "exec.Command", "systemctl", "iptables", "nftables", "ip route", "/bin/sh", "bash -c"} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("collector core must remain pure; found forbidden runtime surface %q", forbidden)
		}
	}
}
