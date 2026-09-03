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

// TestForwardXCoreLongFlow256MiB is intentionally streamed: it verifies the
// multipath core can carry a 256 MiB logical TCP byte stream without allocating
// a 256 MiB payload in CI. It uses the same 64 KiB chunk, 256-frame queue,
// 64 MiB reorder/replay bounds and 8 MiB activation point used by the ForwardX
// Gray runtime.
func TestForwardXCoreLongFlow256MiB(t *testing.T) {
	cfg := testCoreConfig()
	cfg.ChunkSize = 64 << 10
	cfg.QueueFrames = 256
	cfg.QueueBytes = int64(cfg.ChunkSize * cfg.QueueFrames)
	cfg.MaxReorderFrames = 2048
	cfg.MaxReorderBytes = 64 << 20
	cfg.ReplayBytes = 64 << 20
	cfg.ReplayTimeout = 5 * time.Second
	cfg.ActivationAfterBytes = 8 << 20

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

	readResult := make(chan forwardXReadResult, 1)
	go func() {
		_ = rightApp.SetReadDeadline(time.Now().Add(90 * time.Second))
		n, err := io.Copy(io.Discard, rightApp)
		readResult <- forwardXReadResult{n: n, err: err}
	}()

	_ = leftApp.SetWriteDeadline(time.Now().Add(90 * time.Second))
	reader := forwardXZeroReader{}
	const activationProbeBytes int64 = 16 << 20
	if n, err := io.CopyN(leftApp, reader, activationProbeBytes); err != nil {
		t.Fatalf("initial write failed after %d bytes: %v", n, err)
	}

	activationDeadline := time.Now().Add(3 * time.Second)
	for !left.active.Load() && time.Now().Before(activationDeadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if !left.active.Load() {
		t.Fatal("multipath did not activate after the 8 MiB threshold")
	}

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
