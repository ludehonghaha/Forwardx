package main

import (
	"os"
	"strings"
	"time"
)

// managedServiceActive is intentionally small and Linux-oriented. It is used
// only to suppress expected Mieru accounting noise while a managed runtime is
// being stopped or retired; runtime readiness remains owned by the existing
// Agent reconciliation code.
func managedServiceActive(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" {
		return false
	}
	if _, err := os.Stat("/run/systemd/system"); err == nil {
		_, err = commandOutputWithTimeout(2*time.Second, "systemctl", "is-active", "--quiet", name+".service")
		return err == nil
	}
	if _, err := os.Stat("/sbin/rc-service"); err == nil {
		_, err = commandOutputWithTimeout(2*time.Second, "rc-service", name, "status")
		return err == nil
	}
	return false
}
