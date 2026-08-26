package main

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const (
	xrayBinaryPath   = "/usr/local/bin/forwardx-xray"
	xrayStatsPattern = "user>>>forwardx-assignment-"
)

var xrayAssignmentStatName = regexp.MustCompile(`^user>>>forwardx-assignment-([1-9][0-9]*)-user-([1-9][0-9]*)>>>traffic>>>(uplink|downlink)$`)
var xrayLoopbackListen = regexp.MustCompile(`(?:^|[[:space:]])127\.0\.0\.1:([0-9]{1,5})(?:[[:space:]]|$)`)

type xrayAssignmentTrafficStat struct {
	AssignmentID int    `json:"assignmentId"`
	BytesIn      uint64 `json:"bytesIn,omitempty"`
	BytesOut     uint64 `json:"bytesOut,omitempty"`
}

type xrayStatsQueryResponse struct {
	Stats []struct {
		Name  string          `json:"name"`
		Value json.RawMessage `json:"value"`
	} `json:"stat"`
}

// parseXrayStatsAPIListen discovers the ephemeral StatsService listener from
// `ss -H -lntp`. Managed Reality sockets bind 0.0.0.0, while the private API is
// deliberately the only forwardx-xray socket bound to 127.0.0.1.
func parseXrayStatsAPIListen(output string) (string, bool) {
	ports := map[int]bool{}
	for _, rawLine := range strings.Split(output, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || !strings.Contains(line, "forwardx-xray") {
			continue
		}
		match := xrayLoopbackListen.FindStringSubmatch(line)
		if len(match) != 2 {
			continue
		}
		port, err := strconv.Atoi(match[1])
		if err != nil || port < 1 || port > 65535 {
			continue
		}
		ports[port] = true
	}
	if len(ports) != 1 {
		return "", false
	}
	for port := range ports {
		return "127.0.0.1:" + strconv.Itoa(port), true
	}
	return "", false
}

func xrayStatsQueryArgs(server string) []string {
	return []string{
		"api",
		"statsquery",
		"--server=" + strings.TrimSpace(server),
		"-pattern", xrayStatsPattern,
	}
}

func parseXrayCounterValue(raw json.RawMessage) (uint64, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return 0, nil
	}
	var text string
	if err := json.Unmarshal(raw, &text); err == nil {
		value, err := strconv.ParseUint(strings.TrimSpace(text), 10, 64)
		if err != nil {
			return 0, err
		}
		return value, nil
	}
	var number json.Number
	if err := json.Unmarshal(raw, &number); err != nil {
		return 0, err
	}
	value, err := strconv.ParseUint(number.String(), 10, 64)
	if err != nil {
		return 0, err
	}
	return value, nil
}

// parseXrayAssignmentTrafficStats converts Xray's native user counter names to
// the only identity the Agent is allowed to report: ForwardX assignmentId.
// userId embedded in the Xray email is intentionally ignored for attribution;
// the Panel resolves assignment -> user from its own database.
func parseXrayAssignmentTrafficStats(raw []byte) ([]xrayAssignmentTrafficStat, error) {
	var response xrayStatsQueryResponse
	if err := json.Unmarshal(raw, &response); err != nil {
		return nil, err
	}
	byAssignment := map[int]*xrayAssignmentTrafficStat{}
	for _, item := range response.Stats {
		match := xrayAssignmentStatName.FindStringSubmatch(strings.TrimSpace(item.Name))
		if len(match) != 4 {
			continue
		}
		assignmentID64, err := strconv.ParseInt(match[1], 10, 32)
		if err != nil || assignmentID64 <= 0 {
			continue
		}
		value, err := parseXrayCounterValue(item.Value)
		if err != nil {
			return nil, fmt.Errorf("invalid Xray counter %q: %w", item.Name, err)
		}
		assignmentID := int(assignmentID64)
		stat := byAssignment[assignmentID]
		if stat == nil {
			stat = &xrayAssignmentTrafficStat{AssignmentID: assignmentID}
			byAssignment[assignmentID] = stat
		}
		switch match[3] {
		case "uplink":
			if ^uint64(0)-stat.BytesIn < value {
				return nil, fmt.Errorf("Xray uplink counter overflow for assignment %d", assignmentID)
			}
			stat.BytesIn += value
		case "downlink":
			if ^uint64(0)-stat.BytesOut < value {
				return nil, fmt.Errorf("Xray downlink counter overflow for assignment %d", assignmentID)
			}
			stat.BytesOut += value
		}
	}

	ids := make([]int, 0, len(byAssignment))
	for assignmentID := range byAssignment {
		ids = append(ids, assignmentID)
	}
	sort.Ints(ids)
	result := make([]xrayAssignmentTrafficStat, 0, len(ids))
	for _, assignmentID := range ids {
		result = append(result, *byAssignment[assignmentID])
	}
	return result, nil
}
