package main

import (
	"encoding/json"
	"os"
	"strings"
)

const (
	xrayConfigDir   = "/etc/forwardx/xray"
	xrayConfigPath  = xrayConfigDir + "/config.json"
	xrayServiceName = "forwardx-xray"
)

type xrayRuntimeConfig struct {
	Inbounds []xrayRuntimeInbound `json:"inbounds"`
}

type xrayRuntimeInbound struct {
	Tag      string `json:"tag"`
	Listen   string `json:"listen"`
	Port     int    `json:"port"`
	Protocol string `json:"protocol"`
}

// readXrayRuntimeServiceListens extracts only the sockets that are authoritative
// for ForwardX local-runtime readiness. P0-2B uses Xray exclusively for managed
// VLESS+Reality, which is a TCP listener; unrelated/unsupported inbound types in
// a hand-edited config are ignored rather than reported as ForwardX work.
func readXrayRuntimeServiceListens(path string) ([]runtimeListenConfig, bool) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, false
	}
	var config xrayRuntimeConfig
	if err := json.Unmarshal(raw, &config); err != nil {
		return nil, false
	}
	listens := make([]runtimeListenConfig, 0, len(config.Inbounds))
	for _, inbound := range config.Inbounds {
		if inbound.Port <= 0 || inbound.Port > 65535 {
			continue
		}
		if strings.ToLower(strings.TrimSpace(inbound.Protocol)) != "vless" {
			continue
		}
		listen := strings.TrimSpace(inbound.Listen)
		if listen == "" || listen == "0.0.0.0" || listen == "::" || listen == "[::]" {
			listen = ""
		}
		addr := ":" + itoa(inbound.Port)
		if listen != "" {
			addr = listen + ":" + itoa(inbound.Port)
		}
		listens = append(listens, runtimeListenConfig{Addr: addr, Protocol: "tcp"})
	}
	return listens, true
}
