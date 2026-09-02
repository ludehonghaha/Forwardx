package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

func preferPacedSystemPing(count int) bool {
	return count > 1
}

func pacedSystemPingArgs(target string, timeout time.Duration, count int, goos string) []string {
	if count < 1 {
		count = 1
	}
	if timeout <= 0 {
		timeout = tcpingProbeTimeout
	}
	familyArg := pingFamilyArg(target)
	if goos == "windows" {
		args := []string{}
		if familyArg != "" {
			args = append(args, familyArg)
		}
		timeoutMillis := int(timeout.Milliseconds())
		if timeoutMillis < 1 {
			timeoutMillis = 1
		}
		return append(args, "-n", strconv.Itoa(count), "-w", strconv.Itoa(timeoutMillis), target)
	}

	timeoutSeconds := int((timeout + time.Second - 1) / time.Second)
	if timeoutSeconds < 1 {
		timeoutSeconds = 1
	}
	args := []string{}
	if familyArg != "" {
		args = append(args, familyArg)
	}
	// Explicit one-second pacing is intentional. Do not replace this with
	// flood/burst Ping: carrier probe targets commonly rate-limit ICMP.
	return append(args,
		"-n",
		"-c", strconv.Itoa(count),
		"-i", "1",
		"-W", strconv.Itoa(timeoutSeconds),
		target,
	)
}

// pacedSystemPingLatencyStatsWithCount runs a conventional paced ping
// for multi-sample quality measurements. The boolean reports whether
// the result is authoritative; false asks the caller to use the native
// ICMP fallback (for example when the ping binary is not installed).
func pacedSystemPingLatencyStatsWithCount(target string, timeout time.Duration, count int) (int, int, int, string, bool) {
	target = normalizeNetworkTargetHost(target)
	if target == "" {
		return 0, 0, maxPingCount(count), "目标为空", true
	}
	if count < 2 {
		return 0, 0, 0, "single-sample probe", false
	}
	if timeout <= 0 {
		timeout = tcpingProbeTimeout
	}
	if _, err := exec.LookPath("ping"); err != nil {
		return 0, 0, count, err.Error(), false
	}

	ctxTimeout := time.Duration(count-1)*time.Second + timeout + 2*time.Second
	if runtime.GOOS == "windows" {
		ctxTimeout = timeout*time.Duration(count) + 2*time.Second
	}
	ctx, cancel := context.WithTimeout(context.Background(), ctxTimeout)
	defer cancel()

	select {
	case systemPingSlots <- struct{}{}:
		defer func() { <-systemPingSlots }()
	case <-ctx.Done():
		return 0, 0, count, "system ping queue timeout", true
	}

	cmd := exec.CommandContext(ctx, "ping", pacedSystemPingArgs(target, timeout, count, runtime.GOOS)...)
	if runtime.GOOS != "windows" {
		cmd.Env = append(os.Environ(), "LC_ALL=C", "LANG=C")
	}
	output, err := cmd.CombinedOutput()
	text := string(output)
	if ctx.Err() == context.DeadlineExceeded {
		return 0, 0, count, "timeout", true
	}

	if sent, received, ok := parsePingPacketCounts(text); ok {
		total := count
		if sent > 0 && sent < total {
			total = sent
		}
		if received > total {
			received = total
		}
		latency := parsePingLatencyMs(text)
		if received == 0 {
			return 0, 0, total, "timeout", true
		}
		if latency <= 0 {
			return 0, 0, count, "unable to parse ping RTT", false
		}
		return latency, received, total - received, "", true
	}

	if errors.Is(err, exec.ErrNotFound) {
		return 0, 0, count, err.Error(), false
	}
	detail := strings.TrimSpace(text)
	if detail == "" && err != nil {
		detail = err.Error()
	}
	if detail == "" {
		detail = "unable to parse ping packet counters"
	}
	return 0, 0, count, detail, false
}

func maxPingCount(count int) int {
	if count < 1 {
		return 1
	}
	return count
}
