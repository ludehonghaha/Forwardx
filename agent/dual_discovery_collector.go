package main

import (
	"encoding/json"
	"fmt"
	"net"
	"strings"
)

type dualCollectorPlatformSnapshot struct {
	Kernel       string
	Architecture string
}

type dualCollectorInterfaceSnapshot struct {
	Name      string
	Addresses []string
}

type dualCollectorDefaultRouteSnapshot struct {
	Dev           string
	Via           string
	SourceAddress string
}

type dualCollectorListenerSnapshot struct {
	Network string
	Listen  string
	Port    int
}

type dualCollectorMitaRuntimeSnapshot struct {
	BinaryPath    *string
	ServiceStatus string
	Listener      dualCollectorListenerSnapshot
}

type dualCollectorInstalledBinariesSnapshot struct {
	SingBox         bool
	Hysteria        bool
	StandaloneMieru bool
}

// dualDiscoveryCollectorProvider is deliberately capability-shaped rather than
// command-shaped. Production implementations may only supply these normalized,
// read-only facts; the collector never accepts shell text, argv, environment,
// working directories, or generic command execution.
type dualDiscoveryCollectorProvider interface {
	Platform() (dualCollectorPlatformSnapshot, error)
	Interfaces() ([]dualCollectorInterfaceSnapshot, error)
	DefaultRoute() (dualCollectorDefaultRouteSnapshot, error)
	MitaRuntime() (*dualCollectorMitaRuntimeSnapshot, error)
	InstalledBinaries() (dualCollectorInstalledBinariesSnapshot, error)
	ProbeLoopbackTCP(port int) (string, error)
}

type dualPlatformObservation struct {
	Kind         string `json:"kind"`
	Kernel       string `json:"kernel"`
	Architecture string `json:"architecture"`
}

type dualInterfaceObservation struct {
	Kind          string   `json:"kind"`
	InterfaceName string   `json:"interfaceName"`
	Addresses     []string `json:"addresses"`
}

type dualDefaultRouteObservation struct {
	Kind          string `json:"kind"`
	Dev           string `json:"dev"`
	Via           string `json:"via"`
	SourceAddress string `json:"sourceAddress"`
}

type dualPrivateSideObservation struct {
	Kind          string `json:"kind"`
	InterfaceName string `json:"interfaceName"`
	SourceAddress string `json:"sourceAddress"`
}

type dualMitaRuntimeObservation struct {
	Kind          string                        `json:"kind"`
	BinaryPath    *string                       `json:"binaryPath"`
	ServiceStatus string                        `json:"serviceStatus"`
	Listener      dualCollectorListenerSnapshot `json:"listener"`
	Lifecycle     string                        `json:"lifecycle"`
}

type dualInstalledBinariesObservation struct {
	Kind            string `json:"kind"`
	SingBox         bool   `json:"singBox"`
	Hysteria        bool   `json:"hysteria"`
	StandaloneMieru bool   `json:"standaloneMieru"`
}

type dualPortProbeObservation struct {
	Kind         string `json:"kind"`
	Address      string `json:"address"`
	Protocol     string `json:"protocol"`
	Port         int    `json:"port"`
	Availability string `json:"availability"`
}

func collectDualAgentDiscovery(request dualAgentDiscoveryRequest, provider dualDiscoveryCollectorProvider) dualAgentDiscoveryResponse {
	failed := func(message string) dualAgentDiscoveryResponse {
		return dualAgentDiscoveryResponse{
			Version:   dualAgentDiscoveryProtocolVersion,
			Operation: dualAgentDiscoveryOperation,
			RequestID: request.RequestID,
			TargetID:  request.TargetID,
			Status:    "failed",
			Error: &dualAgentDiscoveryError{
				Code:    "collection-failed",
				Message: message,
			},
		}
	}

	if provider == nil {
		return failed("Dual discovery provider is unavailable")
	}
	if err := validateDualAgentDiscoveryRequest(request); err != nil {
		return dualAgentDiscoveryResponse{
			Version:   dualAgentDiscoveryProtocolVersion,
			Operation: dualAgentDiscoveryOperation,
			RequestID: request.RequestID,
			TargetID:  request.TargetID,
			Status:    "failed",
			Error: &dualAgentDiscoveryError{
				Code:    "invalid-request",
				Message: err.Error(),
			},
		}
	}

	platform, err := provider.Platform()
	if err != nil {
		return failed("platform discovery failed")
	}
	if strings.TrimSpace(platform.Kernel) == "" || strings.TrimSpace(platform.Architecture) == "" {
		return failed("platform discovery returned incomplete facts")
	}

	interfaces, err := provider.Interfaces()
	if err != nil {
		return failed("interface discovery failed")
	}
	if len(interfaces) < 2 {
		return failed("Dual discovery requires at least two interfaces")
	}
	if err := validateDualCollectorInterfaces(interfaces); err != nil {
		return failed(err.Error())
	}

	defaultRoute, err := provider.DefaultRoute()
	if err != nil {
		return failed("default route discovery failed")
	}
	if err := validateDualCollectorDefaultRoute(defaultRoute, interfaces); err != nil {
		return failed(err.Error())
	}

	privateSide, err := deriveDualPrivateSide(interfaces, defaultRoute.Dev)
	if err != nil {
		return failed(err.Error())
	}

	binaries, err := provider.InstalledBinaries()
	if err != nil {
		return failed("installed binary discovery failed")
	}

	mita, err := provider.MitaRuntime()
	if err != nil {
		return failed("Mita runtime discovery failed")
	}
	if mita != nil {
		if err := validateDualCollectorMitaRuntime(*mita); err != nil {
			return failed(err.Error())
		}
	}

	observations := make([]json.RawMessage, 0, 5+len(interfaces)+len(request.PortProbes)*4)
	appendObservation := func(value any) bool {
		encoded, marshalErr := json.Marshal(value)
		if marshalErr != nil {
			return false
		}
		observations = append(observations, encoded)
		return true
	}

	if !appendObservation(dualPlatformObservation{Kind: "platform", Kernel: platform.Kernel, Architecture: platform.Architecture}) {
		return failed("platform observation encoding failed")
	}
	for _, iface := range interfaces {
		if !appendObservation(dualInterfaceObservation{Kind: "interface", InterfaceName: iface.Name, Addresses: append([]string(nil), iface.Addresses...)}) {
			return failed("interface observation encoding failed")
		}
	}
	if !appendObservation(dualDefaultRouteObservation{Kind: "default-route", Dev: defaultRoute.Dev, Via: defaultRoute.Via, SourceAddress: defaultRoute.SourceAddress}) {
		return failed("default route observation encoding failed")
	}
	if !appendObservation(dualPrivateSideObservation{Kind: "private-side", InterfaceName: privateSide.Name, SourceAddress: privateSide.SourceAddress}) {
		return failed("private side observation encoding failed")
	}
	if mita != nil {
		if !appendObservation(dualMitaRuntimeObservation{
			Kind:          "mita-runtime",
			BinaryPath:    mita.BinaryPath,
			ServiceStatus: mita.ServiceStatus,
			Listener:      mita.Listener,
			Lifecycle:     "preserve",
		}) {
			return failed("Mita runtime observation encoding failed")
		}
	}
	if !appendObservation(dualInstalledBinariesObservation{
		Kind:            "installed-binaries",
		SingBox:         binaries.SingBox,
		Hysteria:        binaries.Hysteria,
		StandaloneMieru: binaries.StandaloneMieru,
	}) {
		return failed("installed binary observation encoding failed")
	}

	for _, probe := range request.PortProbes {
		for _, port := range probe.Candidates {
			availability, probeErr := provider.ProbeLoopbackTCP(port)
			if probeErr != nil || !validDualPortAvailability(availability) {
				availability = "unknown"
			}
			if !appendObservation(dualPortProbeObservation{
				Kind:         "port-probe",
				Address:      "127.0.0.1",
				Protocol:     "tcp",
				Port:         port,
				Availability: availability,
			}) {
				return failed("port observation encoding failed")
			}
		}
	}

	return dualAgentDiscoveryResponse{
		Version:   dualAgentDiscoveryProtocolVersion,
		Operation: dualAgentDiscoveryOperation,
		RequestID: request.RequestID,
		TargetID:  request.TargetID,
		Status:    "ok",
		Evidence: &dualAgentDiscoveryEvidence{
			Version:      1,
			TargetID:     request.TargetID,
			EvidenceID:   request.RequestID,
			Provenance:   "agent-read-only",
			Observations: observations,
		},
	}
}

type dualDerivedPrivateSide struct {
	Name          string
	SourceAddress string
}

func deriveDualPrivateSide(interfaces []dualCollectorInterfaceSnapshot, defaultDev string) (dualDerivedPrivateSide, error) {
	candidates := make([]dualDerivedPrivateSide, 0, 1)
	for _, iface := range interfaces {
		if iface.Name == defaultDev {
			continue
		}
		for _, rawAddress := range iface.Addresses {
			ip := net.ParseIP(strings.TrimSpace(rawAddress))
			if ip == nil || ip.To4() == nil || !ip.IsPrivate() || ip.IsLoopback() {
				continue
			}
			candidates = append(candidates, dualDerivedPrivateSide{Name: iface.Name, SourceAddress: ip.String()})
			break
		}
	}
	if len(candidates) == 0 {
		return dualDerivedPrivateSide{}, fmt.Errorf("private carrier interface could not be derived")
	}
	if len(candidates) > 1 {
		return dualDerivedPrivateSide{}, fmt.Errorf("private carrier interface is ambiguous")
	}
	return candidates[0], nil
}

func validateDualCollectorInterfaces(interfaces []dualCollectorInterfaceSnapshot) error {
	seen := make(map[string]struct{}, len(interfaces))
	for _, iface := range interfaces {
		name := strings.TrimSpace(iface.Name)
		if name == "" {
			return fmt.Errorf("interface discovery returned an empty interface name")
		}
		if _, exists := seen[name]; exists {
			return fmt.Errorf("interface discovery returned duplicate interface %q", name)
		}
		seen[name] = struct{}{}
		if len(iface.Addresses) == 0 {
			return fmt.Errorf("interface %q has no discovered addresses", name)
		}
		for _, address := range iface.Addresses {
			if net.ParseIP(strings.TrimSpace(address)) == nil {
				return fmt.Errorf("interface %q returned invalid address %q", name, address)
			}
		}
	}
	return nil
}

func validateDualCollectorDefaultRoute(route dualCollectorDefaultRouteSnapshot, interfaces []dualCollectorInterfaceSnapshot) error {
	if strings.TrimSpace(route.Dev) == "" || net.ParseIP(strings.TrimSpace(route.Via)) == nil || net.ParseIP(strings.TrimSpace(route.SourceAddress)) == nil {
		return fmt.Errorf("default route discovery returned incomplete facts")
	}
	var matched *dualCollectorInterfaceSnapshot
	for index := range interfaces {
		if interfaces[index].Name == route.Dev {
			matched = &interfaces[index]
			break
		}
	}
	if matched == nil {
		return fmt.Errorf("default route references unknown interface %q", route.Dev)
	}
	for _, address := range matched.Addresses {
		if net.ParseIP(address).Equal(net.ParseIP(route.SourceAddress)) {
			return nil
		}
	}
	return fmt.Errorf("default route source address is not assigned to interface %q", route.Dev)
}

func validateDualCollectorMitaRuntime(mita dualCollectorMitaRuntimeSnapshot) error {
	switch mita.ServiceStatus {
	case "active", "inactive", "failed", "unknown":
	default:
		return fmt.Errorf("Mita runtime returned unsupported service status %q", mita.ServiceStatus)
	}
	if mita.Listener.Network != "tcp" || strings.TrimSpace(mita.Listener.Listen) == "" || mita.Listener.Port < 1 || mita.Listener.Port > 65535 {
		return fmt.Errorf("Mita runtime returned invalid listener facts")
	}
	return nil
}

func validDualPortAvailability(value string) bool {
	switch value {
	case "available", "occupied", "unknown":
		return true
	default:
		return false
	}
}
