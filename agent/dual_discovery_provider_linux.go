//go:build linux

package main

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
)

type dualLinuxReadonlyProvider struct {
	procRoot       string
	sysRoot        string
	interfacesFn   func() ([]dualCollectorInterfaceSnapshot, error)
	binaryPaths    map[string][]string
}

func newDualLinuxReadonlyProvider() *dualLinuxReadonlyProvider {
	return &dualLinuxReadonlyProvider{
		procRoot:     "/proc",
		sysRoot:      "/sys",
		interfacesFn: readLinuxInterfaceSnapshots,
		binaryPaths: map[string][]string{
			"sing-box": {"/usr/local/bin/sing-box", "/usr/bin/sing-box", "/usr/sbin/sing-box"},
			"hysteria": {"/usr/local/bin/hysteria", "/usr/bin/hysteria", "/usr/local/bin/hysteria2", "/usr/bin/hysteria2"},
			"mieru":    {"/usr/local/bin/mieru", "/usr/bin/mieru"},
		},
	}
}

func (p *dualLinuxReadonlyProvider) Platform() (dualCollectorPlatformSnapshot, error) {
	data, err := os.ReadFile(filepath.Join(p.procRoot, "sys/kernel/osrelease"))
	if err != nil {
		return dualCollectorPlatformSnapshot{}, err
	}
	release := strings.TrimSpace(string(data))
	if release == "" {
		return dualCollectorPlatformSnapshot{}, fmt.Errorf("empty kernel release")
	}
	return dualCollectorPlatformSnapshot{Kernel: release, Architecture: runtime.GOARCH}, nil
}

func (p *dualLinuxReadonlyProvider) Interfaces() ([]dualCollectorInterfaceSnapshot, error) {
	if p.interfacesFn == nil {
		return nil, fmt.Errorf("interface snapshot provider unavailable")
	}
	return p.interfacesFn()
}

func readLinuxInterfaceSnapshots() ([]dualCollectorInterfaceSnapshot, error) {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil, err
	}
	result := make([]dualCollectorInterfaceSnapshot, 0, len(interfaces))
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			return nil, fmt.Errorf("read interface %s addresses: %w", iface.Name, err)
		}
		ips := make([]string, 0, len(addrs))
		seen := map[string]struct{}{}
		for _, addr := range addrs {
			raw := addr.String()
			if host, _, err := net.ParseCIDR(raw); err == nil {
				raw = host.String()
			}
			ip := net.ParseIP(raw)
			if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsMulticast() {
				continue
			}
			if ip.To4() == nil {
				continue
			}
			normalized := ip.String()
			if _, ok := seen[normalized]; ok {
				continue
			}
			seen[normalized] = struct{}{}
			ips = append(ips, normalized)
		}
		if len(ips) == 0 {
			continue
		}
		sort.Strings(ips)
		result = append(result, dualCollectorInterfaceSnapshot{Name: iface.Name, Addresses: ips})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	return result, nil
}

func (p *dualLinuxReadonlyProvider) DefaultRoute() (dualCollectorDefaultRouteSnapshot, error) {
	data, err := os.ReadFile(filepath.Join(p.procRoot, "net/route"))
	if err != nil {
		return dualCollectorDefaultRouteSnapshot{}, err
	}
	type candidate struct {
		dev     string
		gateway string
		metric  int
	}
	var selected *candidate
	scanner := bufio.NewScanner(strings.NewReader(string(data)))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 8 || fields[0] == "Iface" || fields[1] != "00000000" {
			continue
		}
		flags, err := strconv.ParseUint(fields[3], 16, 32)
		if err != nil || flags&0x1 == 0 {
			continue
		}
		gateway, err := parseProcIPv4HexLE(fields[2])
		if err != nil {
			continue
		}
		metric, err := strconv.Atoi(fields[6])
		if err != nil {
			metric = int(^uint(0) >> 1)
		}
		current := candidate{dev: fields[0], gateway: gateway, metric: metric}
		if selected == nil || current.metric < selected.metric {
			copy := current
			selected = &copy
		}
	}
	if err := scanner.Err(); err != nil {
		return dualCollectorDefaultRouteSnapshot{}, err
	}
	if selected == nil {
		return dualCollectorDefaultRouteSnapshot{}, fmt.Errorf("default route not found")
	}
	interfaces, err := p.Interfaces()
	if err != nil {
		return dualCollectorDefaultRouteSnapshot{}, err
	}
	for _, iface := range interfaces {
		if iface.Name != selected.dev || len(iface.Addresses) == 0 {
			continue
		}
		for _, address := range iface.Addresses {
			if ip := net.ParseIP(address); ip != nil && ip.To4() != nil {
				return dualCollectorDefaultRouteSnapshot{Dev: selected.dev, Via: selected.gateway, SourceAddress: ip.String()}, nil
			}
	}
	return dualCollectorDefaultRouteSnapshot{}, fmt.Errorf("default route interface %q has no IPv4 source address", selected.dev)
}

func parseProcIPv4HexLE(value string) (string, error) {
	if len(value) != 8 {
		return "", fmt.Errorf("invalid IPv4 route hex %q", value)
	}
	bytesValue, err := hex.DecodeString(value)
	if err != nil {
		return "", err
	}
	for left, right := 0, len(bytesValue)-1; left < right; left, right = left+1, right-1 {
		bytesValue[left], bytesValue[right] = bytesValue[right], bytesValue[left]
	}
	return net.IP(bytesValue).String(), nil
}

func (p *dualLinuxReadonlyProvider) InstalledBinaries() (dualCollectorInstalledBinariesSnapshot, error) {
	return dualCollectorInstalledBinariesSnapshot{
		SingBox:         firstExistingPath(p.binaryPaths["sing-box"]) != "",
		Hysteria:        firstExistingPath(p.binaryPaths["hysteria"]) != "",
		StandaloneMieru: firstExistingPath(p.binaryPaths["mieru"]) != "",
	}, nil
}

func firstExistingPath(paths []string) string {
	for _, path := range paths {
		info, err := os.Stat(path)
		if err == nil && !info.IsDir() {
			return path
		}
	}
	return ""
}

func (p *dualLinuxReadonlyProvider) MitaRuntime() (*dualCollectorMitaRuntimeSnapshot, error) {
	entries, err := os.ReadDir(p.procRoot)
	if err != nil {
		return nil, err
	}
	listeners, err := readProcTCPListeners(p.procRoot)
	if err != nil {
		return nil, err
	}
	var matches []dualCollectorMitaRuntimeSnapshot
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		pid := entry.Name()
		if _, err := strconv.Atoi(pid); err != nil {
			continue
		}
		comm, err := os.ReadFile(filepath.Join(p.procRoot, pid, "comm"))
		if err != nil || strings.TrimSpace(string(comm)) != "mita" {
			continue
		}
		exePath, _ := os.Readlink(filepath.Join(p.procRoot, pid, "exe"))
		exePath = strings.TrimSuffix(exePath, " (deleted)")
		inodes, err := readProcessSocketInodes(filepath.Join(p.procRoot, pid, "fd"))
		if err != nil {
			return nil, fmt.Errorf("read Mita process sockets: %w", err)
		}
		for inode := range inodes {
			listener, ok := listeners[inode]
			if !ok {
				continue
			}
			pathCopy := exePath
			var binaryPath *string
			if strings.TrimSpace(pathCopy) != "" {
				binaryPath = &pathCopy
			}
			matches = append(matches, dualCollectorMitaRuntimeSnapshot{
				BinaryPath: binaryPath,
				ServiceStatus: "active",
				Listener: dualCollectorListenerSnapshot{Network: "tcp", Listen: listener.address, Port: listener.port},
			})
		}
	}
	if len(matches) == 0 {
		return nil, nil
	}
	if len(matches) > 1 {
		return nil, fmt.Errorf("Mita runtime has multiple listening sockets; refusing to guess")
	}
	return &matches[0], nil
}

type procTCPListener struct {
	address string
	port    int
}

func readProcTCPListeners(procRoot string) (map[string]procTCPListener, error) {
	result := map[string]procTCPListener{}
	for _, name := range []string{"tcp", "tcp6"} {
		path := filepath.Join(procRoot, "net", name)
		data, err := os.ReadFile(path)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		scanner := bufio.NewScanner(strings.NewReader(string(data)))
		for scanner.Scan() {
			fields := strings.Fields(scanner.Text())
			if len(fields) < 10 || fields[0] == "sl" || fields[3] != "0A" {
				continue
			}
			address, port, err := parseProcTCPLocal(fields[1], name == "tcp6")
			if err != nil {
				continue
			}
			inode := fields[9]
			if inode == "0" || inode == "" {
				continue
			}
			result[inode] = procTCPListener{address: address, port: port}
		}
		if err := scanner.Err(); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func parseProcTCPLocal(value string, ipv6 bool) (string, int, error) {
	parts := strings.Split(value, ":")
	if len(parts) != 2 {
		return "", 0, fmt.Errorf("invalid proc tcp local address")
	}
	portValue, err := strconv.ParseUint(parts[1], 16, 16)
	if err != nil {
		return "", 0, err
	}
	if !ipv6 {
		address, err := parseProcIPv4HexLE(parts[0])
		if err != nil {
			return "", 0, err
		}
		if address == "0.0.0.0" {
			address = "*"
		}
		return address, int(portValue), nil
	}
	if strings.Trim(parts[0], "0") == "" {
		return "*", int(portValue), nil
	}
	return "::", int(portValue), nil
}

func readProcessSocketInodes(fdRoot string) (map[string]struct{}, error) {
	entries, err := os.ReadDir(fdRoot)
	if err != nil {
		return nil, err
	}
	result := map[string]struct{}{}
	for _, entry := range entries {
		target, err := os.Readlink(filepath.Join(fdRoot, entry.Name()))
		if err != nil {
			continue
		}
		if strings.HasPrefix(target, "socket:[") && strings.HasSuffix(target, "]") {
			inode := strings.TrimSuffix(strings.TrimPrefix(target, "socket:["), "]")
			if inode != "" {
				result[inode] = struct{}{}
			}
		}
	return result, nil
}

func (p *dualLinuxReadonlyProvider) ProbeLoopbackTCP(port int) (string, error) {
	if port < 1 || port > 65535 {
		return "unknown", fmt.Errorf("invalid port %d", port)
	}
	listeners, err := readProcTCPListeners(p.procRoot)
	if err != nil {
		return "unknown", err
	}
	for _, listener := range listeners {
		if listener.port == port {
			return "occupied", nil
		}
	}
	// This is a read-only snapshot from /proc rather than a temporary bind.
	// A later deployment step must re-check before committing the port.
	return "available", nil
}
