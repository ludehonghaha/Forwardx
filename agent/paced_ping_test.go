package main

import (
	"reflect"
	"testing"
	"time"
)

func TestPreferPacedSystemPingOnlyForMultiSampleProbe(t *testing.T) {
	if preferPacedSystemPing(1) {
		t.Fatal("single-sample ping should keep the low-overhead native path")
	}
	if !preferPacedSystemPing(5) {
		t.Fatal("five-sample quality probe must use paced system ping")
	}
}

func TestPacedSystemPingArgsLinuxUsesOneSecondInterval(t *testing.T) {
	got := pacedSystemPingArgs("203.0.113.8", 2*time.Second, 5, "linux")
	want := []string{"-4", "-n", "-c", "5", "-i", "1", "-W", "2", "203.0.113.8"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("linux paced ping args = %#v, want %#v", got, want)
	}
}

func TestPacedSystemPingArgsWindowsKeepsPerReplyTimeout(t *testing.T) {
	got := pacedSystemPingArgs("203.0.113.8", 1500*time.Millisecond, 5, "windows")
	want := []string{"-4", "-n", "5", "-w", "1500", "203.0.113.8"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("windows paced ping args = %#v, want %#v", got, want)
	}
}
