//go:build linux

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeReadonlyProviderFixtureFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func makeReadonlyProviderFixture(t *testing.T) (*dualLinuxReadonlyProvider, string) {
	t.Helper()
	root := t.TempDir()
	procRoot := filepath.Join(root, "proc")
	writeReadonlyProviderFixtureFile(t, filepath.Join(procRoot, "sys/kernel/osrelease"), "6.12.96-test\n")
	writeReadonlyProviderFixtureFile(t, filepath.Join(procRoot, "net/route"), strings.Join([]string{
		"Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT",
		"eth0 00000000 01165657 0003 0 0 100 00000000 0 0 0",
	}, "\n")+"\n")
	writeReadonlyProviderFixtureFile(t, filepath.Join(procRoot, "net/tcp"), strings.Join([]string{
		"  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode",
		"   0: 00000000:2CC8 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 12345 1",
		"   1: 0100007F:5DC1 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 99999 1",
	}, "\n")+"\n")
	writeReadonlyProviderFixtureFile(t, filepath.Join(procRoot, "net/tcp6"), "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode\n")

	mitaBinary := filepath.Join(root, "bin", "mita")
	writeReadonlyProviderFixtureFile(t, mitaBinary, "fixture")
	writeReadonlyProviderFixtureFile(t, filepath.Join(procRoot, "123/comm"), "mita\n")
	if err := os.Symlink(mitaBinary, filepath.Join(procRoot, "123/exe")); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(procRoot, "123/fd"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink("socket:[12345]", filepath.Join(procRoot, "123/fd/7")); err != nil {
		t.Fatal(err)
	}

	singBox := filepath.Join(root, "bin", "sing-box")
	writeReadonlyProviderFixtureFile(t, singBox, "fixture")

	provider := &dualLinuxReadonlyProvider{
		procRoot: procRoot,
		sysRoot:  filepath.Join(root, "sys"),
		interfacesFn: func() ([]dualCollectorInterfaceSnapshot, error) {
			return []dualCollectorInterfaceSnapshot{
				{Name: "eth0", Addresses: []string{"87.86.22.221"}},
				{Name: "eth1", Addresses: []string{"172.16.4.114"}},
			}, nil
		},
		binaryPaths: map[string][]string{
			"sing-box": {singBox},
			"hysteria": {filepath.Join(root, "bin", "hysteria")},
			"mieru":    {filepath.Join(root, "bin", "mieru")},
		},
	}
	return provider, root
}

func TestLinuxReadonlyProviderCollectsNoBrandLikeFactsWithoutCommands(t *testing.T) {
	provider, _ := makeReadonlyProviderFixture(t)

	platform, err := provider.Platform()
	if err != nil {
		t.Fatal(err)
	}
	if platform.Kernel != "6.12.96-test" || platform.Architecture == "" {
		t.Fatalf("unexpected platform: %#v", platform)
	}

	route, err := provider.DefaultRoute()
	if err != nil {
		t.Fatal(err)
	}
	if route.Dev != "eth0" || route.Via != "87.86.22.1" || route.SourceAddress != "87.86.22.221" {
		t.Fatalf("unexpected route: %#v", route)
	}

	mita, err := provider.MitaRuntime()
	if err != nil {
		t.Fatal(err)
	}
	if mita == nil || mita.ServiceStatus != "active" || mita.Listener.Port != 11464 || mita.Listener.Listen != "*" {
		t.Fatalf("unexpected Mita runtime: %#v", mita)
	}

	binaries, err := provider.InstalledBinaries()
	if err != nil {
		t.Fatal(err)
	}
	if !binaries.SingBox || binaries.Hysteria || binaries.StandaloneMieru {
		t.Fatalf("unexpected binary facts: %#v", binaries)
	}

	occupied, err := provider.ProbeLoopbackTCP(24001)
	if err != nil || occupied != "occupied" {
		t.Fatalf("expected occupied read-only probe, got %q err=%v", occupied, err)
	}
	available, err := provider.ProbeLoopbackTCP(24002)
	if err != nil || available != "available" {
		t.Fatalf("expected available read-only probe, got %q err=%v", available, err)
	}
}

func TestLinuxReadonlyProviderFeedsStrictCollectorEvidence(t *testing.T) {
	provider, _ := makeReadonlyProviderFixture(t)
	request := dualCollectorTestRequest("nobrand-dual-current", 24001, 24002)
	response := collectDualAgentDiscovery(request, provider)
	if response.Status != "ok" {
		t.Fatalf("expected provider-backed evidence: %#v", response.Error)
	}
	if err := validateDualAgentDiscoveryExchange(request, response); err != nil {
		t.Fatalf("provider evidence must satisfy fixed protocol: %v", err)
	}
	observations := decodeCollectorObservations(t, response)
	privateSide := findCollectorObservation(t, observations, "private-side", nil)
	if privateSide["interfaceName"] != "eth1" || privateSide["sourceAddress"] != "172.16.4.114" {
		t.Fatalf("unexpected private side: %#v", privateSide)
	}
	mita := findCollectorObservation(t, observations, "mita-runtime", nil)
	listener := mita["listener"].(map[string]any)
	if listener["port"] != float64(11464) {
		t.Fatalf("unexpected Mita listener: %#v", listener)
	}
}

func TestLinuxReadonlyProviderSupportsDifferentInterfaceNamesWithoutSourceChanges(t *testing.T) {
	provider, _ := makeReadonlyProviderFixture(t)
	writeReadonlyProviderFixtureFile(t, filepath.Join(provider.procRoot, "net/route"), strings.Join([]string{
		"Iface Destination Gateway Flags RefCnt Use Metric Mask MTU Window IRTT",
		"ens3 00000000 010071CB 0003 0 0 10 00000000 0 0 0",
	}, "\n")+"\n")
	provider.interfacesFn = func() ([]dualCollectorInterfaceSnapshot, error) {
		return []dualCollectorInterfaceSnapshot{
			{Name: "ens3", Addresses: []string{"203.113.0.20"}},
			{Name: "ens8", Addresses: []string{"10.44.0.12"}},
		}, nil
	}

	route, err := provider.DefaultRoute()
	if err != nil {
		t.Fatal(err)
	}
	if route.Dev != "ens3" || route.SourceAddress != "203.113.0.20" {
		t.Fatalf("unexpected synthetic route: %#v", route)
	}
	request := dualCollectorTestRequest("synthetic-linux-dual", 25001)
	response := collectDualAgentDiscovery(request, provider)
	if response.Status != "ok" {
		t.Fatalf("second Dual should need no schema/source literal: %#v", response.Error)
	}
	observations := decodeCollectorObservations(t, response)
	privateSide := findCollectorObservation(t, observations, "private-side", nil)
	if privateSide["interfaceName"] != "ens8" || privateSide["sourceAddress"] != "10.44.0.12" {
		t.Fatalf("unexpected synthetic private side: %#v", privateSide)
	}
}

func TestLinuxReadonlyProviderDoesNotFabricateMissingMita(t *testing.T) {
	provider, _ := makeReadonlyProviderFixture(t)
	if err := os.RemoveAll(filepath.Join(provider.procRoot, "123")); err != nil {
		t.Fatal(err)
	}
	mita, err := provider.MitaRuntime()
	if err != nil {
		t.Fatal(err)
	}
	if mita != nil {
		t.Fatalf("missing Mita process must remain absent evidence: %#v", mita)
	}
}

func TestLinuxReadonlyProviderFailsClosedOnMultipleMitaListeners(t *testing.T) {
	provider, _ := makeReadonlyProviderFixture(t)
	writeReadonlyProviderFixtureFile(t, filepath.Join(provider.procRoot, "net/tcp"), strings.Join([]string{
		"  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt uid timeout inode",
		"   0: 00000000:2CC8 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 12345 1",
		"   1: 00000000:2CC9 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 12346 1",
	}, "\n")+"\n")
	if err := os.Symlink("socket:[12346]", filepath.Join(provider.procRoot, "123/fd/8")); err != nil {
		t.Fatal(err)
	}
	if _, err := provider.MitaRuntime(); err == nil || !strings.Contains(err.Error(), "multiple") {
		t.Fatalf("multiple Mita listeners must fail closed, err=%v", err)
	}
}

func TestLinuxReadonlyProviderSourceHasNoMutationOrCommandExecutionSurface(t *testing.T) {
	source, err := os.ReadFile("dual_discovery_provider_linux.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	for _, forbidden := range []string{
		"os/exec", "exec.Command", "systemctl", "iptables", "nftables", "ip route", "/bin/sh", "bash -c",
		"os.WriteFile", "os.Create(", "os.OpenFile", "net.Listen", "syscall.Bind",
	} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("Linux provider must remain read-only; found forbidden surface %q", forbidden)
		}
	}
}
