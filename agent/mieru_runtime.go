package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

type mieruServerConfig struct {
	PortBindings *[]struct {
		Port     int    `json:"port"`
		Protocol string `json:"protocol"`
	} `json:"portBindings"`
}

func readMieruRuntimeServiceListens(path string) ([]runtimeListenConfig, bool) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, false
	}
	var cfg mieruServerConfig
	if err := json.Unmarshal(b, &cfg); err != nil {
		return nil, false
	}
	if cfg.PortBindings == nil {
		return nil, false
	}
	listens := make([]runtimeListenConfig, 0, len(*cfg.PortBindings))
	seen := map[string]bool{}
	for _, binding := range *cfg.PortBindings {
		protocol := strings.ToLower(strings.TrimSpace(binding.Protocol))
		if binding.Port < 1 || binding.Port > 65535 || (protocol != "tcp" && protocol != "udp") {
			return nil, false
		}
		key := fmt.Sprintf("%d:%s", binding.Port, protocol)
		if seen[key] {
			return nil, false
		}
		seen[key] = true
		listens = append(listens, runtimeListenConfig{
			Addr:     fmt.Sprintf(":%d", binding.Port),
			Protocol: protocol,
		})
	}
	return listens, true
}
