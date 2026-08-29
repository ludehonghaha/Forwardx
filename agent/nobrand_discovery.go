package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
)

const noBrandStateRoot = "/var/lib/nobrand-oneclick"

const (
	noBrandRegistryMaxBytes    int64 = 64 * 1024
	noBrandInstallMaxBytes     int64 = 64 * 1024
	noBrandUsersMaxBytes       int64 = 2 * 1024 * 1024
	noBrandProtocolMaxBytes    int64 = 256 * 1024
	noBrandSnellMaxInstances         = 256
)

var noBrandSnellStateNamePattern = regexp.MustCompile(`^s[0-9a-f]{16}\.json$`)

type noBrandProviderSnapshot struct {
	Registry          json.RawMessage   `json:"registry"`
	MieruInstallState string            `json:"mieruInstallState,omitempty"`
	MieruUsers        json.RawMessage   `json:"mieruUsers,omitempty"`
	SnellStates       []json.RawMessage `json:"snellStates,omitempty"`
	Hysteria2State    json.RawMessage   `json:"hysteria2State,omitempty"`
	VlessSudokuState  json.RawMessage   `json:"vlessSudokuState,omitempty"`
}

type noBrandDiscoveryResult struct {
	Installed bool                     `json:"installed"`
	Snapshot  *noBrandProviderSnapshot `json:"snapshot,omitempty"`
}

type noBrandRegistryMarker struct {
	SchemaVersion int    `json:"schema_version"`
	Project       string `json:"project"`
	Ownership     string `json:"ownership"`
}

// discoverNoBrandProviderSnapshot is intentionally a fixed-path, read-only
// probe. It never executes NoBrand, sources shell state, changes permissions,
// or starts/stops a NoBrand-owned runtime.
func discoverNoBrandProviderSnapshot() (noBrandDiscoveryResult, error) {
	return discoverNoBrandProviderSnapshotAt(noBrandStateRoot)
}

// discoverNoBrandProviderSnapshotAt exists only to make the fixed-path probe
// testable. Callers outside tests must use discoverNoBrandProviderSnapshot.
func discoverNoBrandProviderSnapshotAt(root string) (noBrandDiscoveryResult, error) {
	registryPath := filepath.Join(root, "state.json")
	registry, err := readNoBrandRegularFile(registryPath, noBrandRegistryMaxBytes)
	if errors.Is(err, os.ErrNotExist) {
		return noBrandDiscoveryResult{Installed: false}, nil
	}
	if err != nil {
		return noBrandDiscoveryResult{Installed: true}, fmt.Errorf("read NoBrand registry: %w", err)
	}
	if !json.Valid(registry) {
		return noBrandDiscoveryResult{Installed: true}, errors.New("NoBrand state.json is not valid JSON")
	}

	var marker noBrandRegistryMarker
	if err := json.Unmarshal(registry, &marker); err != nil {
		return noBrandDiscoveryResult{Installed: true}, errors.New("NoBrand state.json marker cannot be decoded")
	}
	if marker.SchemaVersion != 3 || marker.Project != "NoBrand-OneClick" || marker.Ownership != "nobrand-v3" {
		// Critical fail-closed boundary: never read credential-bearing child state
		// until the root ownership marker is exact.
		return noBrandDiscoveryResult{Installed: true}, fmt.Errorf(
			"unsupported NoBrand ownership marker: schema=%d project=%q ownership=%q",
			marker.SchemaVersion,
			marker.Project,
			marker.Ownership,
		)
	}

	snapshot := &noBrandProviderSnapshot{Registry: cloneRawJSON(registry)}

	if data, ok, err := readOptionalNoBrandFile(filepath.Join(root, "mieru", "install-state.env"), noBrandInstallMaxBytes, false); err != nil {
		return noBrandDiscoveryResult{Installed: true}, err
	} else if ok {
		snapshot.MieruInstallState = string(data)
	}
	if data, ok, err := readOptionalNoBrandFile(filepath.Join(root, "mieru", "users.json"), noBrandUsersMaxBytes, true); err != nil {
		return noBrandDiscoveryResult{Installed: true}, err
	} else if ok {
		snapshot.MieruUsers = cloneRawJSON(data)
	}
	if states, err := readNoBrandSnellStates(filepath.Join(root, "snell", "instances")); err != nil {
		return noBrandDiscoveryResult{Installed: true}, err
	} else if len(states) > 0 {
		snapshot.SnellStates = states
	}
	if data, ok, err := readOptionalNoBrandFile(filepath.Join(root, "hysteria2", "state.json"), noBrandProtocolMaxBytes, true); err != nil {
		return noBrandDiscoveryResult{Installed: true}, err
	} else if ok {
		snapshot.Hysteria2State = cloneRawJSON(data)
	}
	if data, ok, err := readOptionalNoBrandFile(filepath.Join(root, "vless-sudoku", "state.json"), noBrandProtocolMaxBytes, true); err != nil {
		return noBrandDiscoveryResult{Installed: true}, err
	} else if ok {
		snapshot.VlessSudokuState = cloneRawJSON(data)
	}

	return noBrandDiscoveryResult{Installed: true, Snapshot: snapshot}, nil
}

func readNoBrandSnellStates(dir string) ([]json.RawMessage, error) {
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read NoBrand Snell state directory: %w", err)
	}

	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if !noBrandSnellStateNamePattern.MatchString(name) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return nil, fmt.Errorf("inspect NoBrand Snell state %q: %w", name, err)
		}
		if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("NoBrand Snell state %q is not a regular file", name)
		}
		names = append(names, name)
	}
	if len(names) > noBrandSnellMaxInstances {
		return nil, fmt.Errorf("too many NoBrand Snell instances: %d", len(names))
	}
	sort.Strings(names)

	states := make([]json.RawMessage, 0, len(names))
	for _, name := range names {
		data, err := readNoBrandRegularFile(filepath.Join(dir, name), noBrandProtocolMaxBytes)
		if err != nil {
			return nil, fmt.Errorf("read NoBrand Snell state %q: %w", name, err)
		}
		if !json.Valid(data) {
			return nil, fmt.Errorf("NoBrand Snell state %q is not valid JSON", name)
		}
		states = append(states, cloneRawJSON(data))
	}
	return states, nil
}

func readOptionalNoBrandFile(path string, limit int64, requireJSON bool) ([]byte, bool, error) {
	data, err := readNoBrandRegularFile(path, limit)
	if errors.Is(err, os.ErrNotExist) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("read NoBrand state %q: %w", filepath.Base(path), err)
	}
	if requireJSON && !json.Valid(data) {
		return nil, false, fmt.Errorf("NoBrand state %q is not valid JSON", filepath.Base(path))
	}
	return data, true, nil
}

func readNoBrandRegularFile(path string, limit int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return nil, errors.New("not a regular file")
	}
	if info.Size() > limit {
		return nil, fmt.Errorf("file exceeds %d-byte discovery limit", limit)
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	reader := io.LimitReader(file, limit+1)
	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("file exceeds %d-byte discovery limit", limit)
	}
	return bytes.Clone(data), nil
}

func cloneRawJSON(data []byte) json.RawMessage {
	return json.RawMessage(bytes.Clone(data))
}
