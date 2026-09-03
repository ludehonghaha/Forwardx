package multipath

import (
	"context"
	"io"
	"net"
	"testing"
	"time"
)

const forwardXLongFlowBytes int64 = 256 << 20

type forwardXZeroReader struct{}

func (forwardXZeroReader) Read(p []byte) (int, error) {
	for i := range p {
		p[i] = 0
	}
	return len(p), nil
}

type forwardXReadResult struct {
	n   int64
	err error
}

func forwardXGrayCoreConfig() coreConfig {
	cfg := testCoreConfig()
	cfg.ChunkSize = 64 << 10
	cfg.QueueFrames = 256
	cfg.QueueBytes = int64(cfg.ChunkSize * cfg.QueueFrames)
	cfg.MaxReorderFrames = 2048
	cfg.MaxReorderBytes = 64 << 20
	cfg.ReplayBytes = 64 << 20
	cfg.ReplayTimeout = 5 * time.Second
	cfg.ActivationAfterBytes = 8 << 20
	return cfg
}

func forwardXStartDrain(conn net.Conn, timeout time.Duration) <-chan forwardXReadResult {
	result := make(chan forwardXReadResult, 1)
	go func() {
		_ = conn.SetReadDeadline(time.Now().Add(timeout))
		n, err := io.Copy(io.Discard, conn)
		result <- forwardXReadResult{n: n, err: err}
	}()
	return result
}

func forwardXWaitForActivation(t *testing.T, core *mpCore) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !core.active.Load() && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !core.active.Load() {
		t.Fatal("multipath did not activate after the 8 MiB threshold")
	}
}

// TestForwardXCoreLongFlow256MiB is intentionally streamed: it verifies the
// multipath core can carry a 256 MiB logical TCP byte stream without allocating
// a 256 MiB payload in CI. It uses the same 64 KiB chunk, 256-frame queue,
// 64 MiB reorder/replay bounds and 8 MiB activation point used by the ForwardX
// Gray runtime.
func TestForwardXCoreLongFlow256MiB(t *testing.T) {
	cfg := forwardXGrayCoreConfig()
	left, leftApp := newCore(context.Background(), cfg)
	right, rightApp := newCore(context.Background(), cfg)
	defer left.Close()
	defer right.Close()

	leg0Left, leg0Right := net.Pipe()
	countedLeg0 := &countingConn{Conn: leg0Left}
	connectTestLeg(t, left, right, 0, countedLeg0, leg0Right)

	leg1Left, leg1Right := net.Pipe()
	countedLeg1 := &countingConn{Conn: leg1Left}
	connectTestLeg(t, left, right, 1, countedLeg1, leg1Right)

	readResult := forwardXStartDrain(rightApp, 90*time.Second)
	_ = leftApp.SetWriteDeadline(time.Now().Add(90 * time.Second))
	reader := forwardXZeroReader{}
	const activationProbeBytes int64 = 16 << 20
	if n, err := io.CopyN(leftApp, reader, activationProbeBytes); err != nil {
		t.Fatalf("initial write failed after %d bytes: %v", n, err)
	}
	forwardXWaitForActivation(t, left)

	remaining := forwardXLongFlowBytes - activationProbeBytes
	if n, err := io.CopyN(leftApp, reader, remaining); err != nil {
		t.Fatalf("long-flow write failed after %d of %d remaining bytes: %v", n, remaining, err)
	}
	closeTestWrite(t, leftApp)

	result := <-readResult
	if result.err != nil {
		t.Fatalf("long-flow read failed after %d of %d bytes: %v", result.n, forwardXLongFlowBytes, result.err)
	}
	if result.n != forwardXLongFlowBytes {
		t.Fatalf("long-flow length mismatch: received %d of %d bytes", result.n, forwardXLongFlowBytes)
	}
	if countedLeg0.written.Load() == 0 {
		t.Fatal("preferred leg carried no wire bytes")
	}
	if countedLeg1.written.Load() == 0 {
		t.Fatal("booster leg carried no wire bytes")
	}
}

// TestForwardXCoreLongFlowLeg1StallFallback256MiB models the important Gray
// failure shape: after aggregation activates, the booster accepts a scheduled
// frame but its write stalls while the preferred leg continues to carry later
// sequence numbers. The core must survive the production 5s replay timeout,
// fail only the booster, reinject its replay history through leg 0 and complete
// the original logical stream without reset/reconnect.
func TestForwardXCoreLongFlowLeg1StallFallback256MiB(t *testing.T) {
	cfg := forwardXGrayCoreConfig()
	left, leftApp := newCore(context.Background(), cfg)
	right, rightApp := newCore(context.Background(), cfg)
	defer left.Close()
	defer right.Close()

	leg0Left, leg0Right := net.Pipe()
	// Roughly constrain the preferred in-memory leg so the test has sustained
	// traffic during the 5s replay window instead of finishing instantaneously.
	countedLeg0 := &countingConn{Conn: &delayedWriteConn{Conn: leg0Left, delay: 2 * time.Millisecond}}
	connectTestLeg(t, left, right, 0, countedLeg0, leg0Right)

	leg1Left, leg1Right := net.Pipe()
	stalledLeg1 := newStallingConn(leg1Left)
	countedLeg1 := &countingConn{Conn: stalledLeg1}
	connectTestLeg(t, left, right, 1, countedLeg1, leg1Right)

	readResult := forwardXStartDrain(rightApp, 120*time.Second)
	_ = leftApp.SetWriteDeadline(time.Now().Add(120 * time.Second))
	reader := forwardXZeroReader{}
	const activationProbeBytes int64 = 16 << 20
	if n, err := io.CopyN(leftApp, reader, activationProbeBytes); err != nil {
		t.Fatalf("initial write failed after %d bytes: %v", n, err)
	}
	forwardXWaitForActivation(t, left)

	select {
	case <-stalledLeg1.started:
	case <-time.After(5 * time.Second):
		t.Fatal("booster did not receive a scheduled frame after activation")
	}

	remaining := forwardXLongFlowBytes - activationProbeBytes
	if n, err := io.CopyN(leftApp, reader, remaining); err != nil {
		t.Fatalf("stall-fallback write failed after %d of %d remaining bytes: %v", n, remaining, err)
	}
	closeTestWrite(t, leftApp)

	result := <-readResult
	if result.err != nil {
		t.Fatalf("stall-fallback read failed after %d of %d bytes: %v", result.n, forwardXLongFlowBytes, result.err)
	}
	if result.n != forwardXLongFlowBytes {
		t.Fatalf("stall-fallback length mismatch: received %d of %d bytes", result.n, forwardXLongFlowBytes)
	}
	if countedLeg0.written.Load() == 0 {
		t.Fatal("preferred leg carried no wire bytes")
	}
	if countedLeg1.written.Load() != 0 {
		t.Fatalf("stalled booster unexpectedly completed %d wire bytes", countedLeg1.written.Load())
	}
	if left.getLeg(1) != nil {
		t.Fatal("stalled booster should have been removed after replay timeout")
	}
}
