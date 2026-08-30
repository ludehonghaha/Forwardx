package main

import (
	"encoding/json"
	"fmt"
)

// dualAgentDiscoveryHandlerCore binds the fixed v1 wire contract to the pure
// collector. It intentionally has no transport registration and no command
// execution capability; callers must inject the narrow read-only provider.
type dualAgentDiscoveryHandlerCore struct {
	provider dualDiscoveryCollectorProvider
}

func (h dualAgentDiscoveryHandlerCore) Handle(payload []byte) ([]byte, error) {
	request, err := decodeDualAgentDiscoveryRequest(payload)
	if err != nil {
		return nil, fmt.Errorf("invalid Dual discovery request: %w", err)
	}

	response := collectDualAgentDiscovery(request, h.provider)
	if err := validateDualAgentDiscoveryExchange(request, response); err != nil {
		return nil, fmt.Errorf("invalid Dual discovery response: %w", err)
	}

	encoded, err := json.Marshal(response)
	if err != nil {
		return nil, fmt.Errorf("encode Dual discovery response: %w", err)
	}
	return encoded, nil
}
