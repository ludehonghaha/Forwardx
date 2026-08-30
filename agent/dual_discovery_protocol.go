package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
)

const dualAgentDiscoveryProtocolVersion = 1
const dualAgentDiscoveryOperation = "dual-readonly-discovery"

type dualAgentDiscoveryPortProbeRequest struct {
	Address    string `json:"address"`
	Protocol   string `json:"protocol"`
	Candidates []int  `json:"candidates"`
}

type dualAgentDiscoveryRequest struct {
	Version    int                                  `json:"version"`
	Operation  string                               `json:"operation"`
	RequestID  string                               `json:"requestId"`
	TargetID   string                               `json:"targetId"`
	PortProbes []dualAgentDiscoveryPortProbeRequest `json:"portProbes"`
}

type dualAgentDiscoveryEvidence struct {
	Version      int               `json:"version"`
	TargetID     string            `json:"targetId"`
	EvidenceID   string            `json:"evidenceId"`
	Provenance   string            `json:"provenance"`
	Observations []json.RawMessage `json:"observations"`
}

type dualAgentDiscoveryError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type dualAgentDiscoveryResponse struct {
	Version   int                         `json:"version"`
	Operation string                      `json:"operation"`
	RequestID string                      `json:"requestId"`
	TargetID  string                      `json:"targetId"`
	Status    string                      `json:"status"`
	Evidence  *dualAgentDiscoveryEvidence `json:"evidence,omitempty"`
	Error     *dualAgentDiscoveryError    `json:"error,omitempty"`
}

func decodeDualAgentDiscoveryRequest(data []byte) (dualAgentDiscoveryRequest, error) {
	var request dualAgentDiscoveryRequest
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		return request, err
	}
	if err := requireJSONEOF(decoder); err != nil {
		return request, err
	}
	if err := validateDualAgentDiscoveryRequest(request); err != nil {
		return request, err
	}
	return request, nil
}

func decodeDualAgentDiscoveryResponse(data []byte) (dualAgentDiscoveryResponse, error) {
	var response dualAgentDiscoveryResponse
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&response); err != nil {
		return response, err
	}
	if err := requireJSONEOF(decoder); err != nil {
		return response, err
	}
	if err := validateDualAgentDiscoveryResponse(response); err != nil {
		return response, err
	}
	return response, nil
}

func requireJSONEOF(decoder *json.Decoder) error {
	var trailing json.RawMessage
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return fmt.Errorf("unexpected trailing JSON value")
		}
		return err
	}
	return nil
}

func validateDualAgentDiscoveryRequest(request dualAgentDiscoveryRequest) error {
	if request.Version != dualAgentDiscoveryProtocolVersion {
		return fmt.Errorf("unsupported Dual discovery protocol version %d", request.Version)
	}
	if request.Operation != dualAgentDiscoveryOperation {
		return fmt.Errorf("unsupported Dual discovery operation %q", request.Operation)
	}
	if strings.TrimSpace(request.RequestID) == "" || strings.TrimSpace(request.TargetID) == "" {
		return fmt.Errorf("requestId and targetId are required")
	}
	if len(request.PortProbes) > 8 {
		return fmt.Errorf("too many port probe groups")
	}
	for _, probe := range request.PortProbes {
		if probe.Address != "127.0.0.1" || probe.Protocol != "tcp" {
			return fmt.Errorf("Dual discovery port probes are restricted to 127.0.0.1/tcp")
		}
		if len(probe.Candidates) == 0 || len(probe.Candidates) > 128 {
			return fmt.Errorf("port probe candidates must contain 1..128 ports")
		}
		seen := make(map[int]struct{}, len(probe.Candidates))
		for _, port := range probe.Candidates {
			if port < 1 || port > 65535 {
				return fmt.Errorf("invalid candidate port %d", port)
			}
			if _, exists := seen[port]; exists {
				return fmt.Errorf("duplicate candidate port %d", port)
			}
			seen[port] = struct{}{}
		}
	}
	return nil
}

func validateDualAgentDiscoveryResponse(response dualAgentDiscoveryResponse) error {
	if response.Version != dualAgentDiscoveryProtocolVersion {
		return fmt.Errorf("unsupported Dual discovery protocol version %d", response.Version)
	}
	if response.Operation != dualAgentDiscoveryOperation {
		return fmt.Errorf("unsupported Dual discovery operation %q", response.Operation)
	}
	if strings.TrimSpace(response.RequestID) == "" || strings.TrimSpace(response.TargetID) == "" {
		return fmt.Errorf("requestId and targetId are required")
	}
	switch response.Status {
	case "ok":
		if response.Evidence == nil || response.Error != nil {
			return fmt.Errorf("ok response requires evidence and forbids error")
		}
		if response.Evidence.Version != 1 {
			return fmt.Errorf("unsupported evidence version %d", response.Evidence.Version)
		}
		if response.Evidence.TargetID != response.TargetID {
			return fmt.Errorf("evidence targetId mismatch")
		}
		if strings.TrimSpace(response.Evidence.EvidenceID) == "" {
			return fmt.Errorf("evidenceId is required")
		}
		if response.Evidence.Provenance != "agent-read-only" {
			return fmt.Errorf("agent response evidence must use agent-read-only provenance")
		}
		if len(response.Evidence.Observations) == 0 {
			return fmt.Errorf("evidence observations are required")
		}
	case "failed":
		if response.Error == nil || response.Evidence != nil {
			return fmt.Errorf("failed response requires error and forbids evidence")
		}
		switch response.Error.Code {
		case "invalid-request", "unsupported", "collection-failed":
		default:
			return fmt.Errorf("unsupported discovery error code %q", response.Error.Code)
		}
		if strings.TrimSpace(response.Error.Message) == "" {
			return fmt.Errorf("discovery error message is required")
		}
	default:
		return fmt.Errorf("unsupported discovery response status %q", response.Status)
	}
	return nil
}

func validateDualAgentDiscoveryExchange(request dualAgentDiscoveryRequest, response dualAgentDiscoveryResponse) error {
	if err := validateDualAgentDiscoveryRequest(request); err != nil {
		return err
	}
	if err := validateDualAgentDiscoveryResponse(response); err != nil {
		return err
	}
	if response.RequestID != request.RequestID {
		return fmt.Errorf("Dual discovery requestId mismatch")
	}
	if response.TargetID != request.TargetID {
		return fmt.Errorf("Dual discovery targetId mismatch")
	}
	return nil
}
