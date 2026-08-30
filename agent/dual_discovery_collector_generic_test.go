package main

import "testing"

func TestCollectDualAgentDiscoveryDoesNotRequireRFC1918CarrierAddress(t *testing.T) {
	provider := fakeDualDiscoveryCollectorProvider{
		platform: dualCollectorPlatformSnapshot{Kernel: "linux", Architecture: "x86_64"},
		interfaces: []dualCollectorInterfaceSnapshot{
			{Name: "wan0", Addresses: []string{"198.51.100.20"}},
			{Name: "carrier0", Addresses: []string{"100.64.12.8"}},
		},
		route:    dualCollectorDefaultRouteSnapshot{Dev: "wan0", Via: "198.51.100.1", SourceAddress: "198.51.100.20"},
		binaries: dualCollectorInstalledBinariesSnapshot{},
		ports:    map[int]string{26001: "available"},
	}

	response := collectDualAgentDiscovery(dualCollectorTestRequest("synthetic-carrier-range", 26001), provider)
	if response.Status != "ok" {
		t.Fatalf("generic Dual carrier address must not require a vendor-specific CIDR: %#v", response.Error)
	}
	observations := decodeCollectorObservations(t, response)
	privateSide := findCollectorObservation(t, observations, "private-side", nil)
	if privateSide["interfaceName"] != "carrier0" || privateSide["sourceAddress"] != "100.64.12.8" {
		t.Fatalf("unexpected carrier side: %#v", privateSide)
	}
}
