package multipath

import (
	"context"
	"io"
	"net"
	"sync"
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

type forwardXGateWriteConn struct {
	net.Conn
	started     chan struct{}
	release     chan struct{}
	startedOnce sync.Once
	releaseOnce sync.Once
}

func newForwardXGateWriteConn(conn net.Conn) *forwardXGateWriteConn {
	return &forwardXGateWriteConn{
		Conn:    conn,
		started: make(chan struct{}),
		release: make(chan struct{}),
	}
}

func (c *forwardXGateWriteConn) Write(buffer []byte) (int, error) {
	c.startedOnce.Do(func() { close(c.started) })
	<-c.release
	return c.Conn.Write(buffer)
}

func (c *forwardXGateWriteConn) Release() {
	c.releaseOnce.Do(func() { close(c.release) })
}

func (c *forwardXGateWriteConn) Close() error {
	c.Release()
	return c.Conn.Close()
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

// TestForwardXCoreBoundsUnackedWindow reproduces the mechanism behind the
// real-carrier reset without depending on WAN timing. A child transport can
// accept writes into its own buffers much faster than the peer receives them.
// Without an ACK-bounded send window, txSeq advances beyond the receiver's
// reorder capacity even though the local leg queues appear empty.
func TestForwardXCoreBoundsUnackedWindow(t *testing.T) {
	cfg := forwardXGrayCoreConfig()
	core, appConn := newCore(context.Background(), cfg)

	coreConn, peerConn := net.Pipe()
	if _, err := core.addLeg(0, coreConn, nil); err != nil {
		t.Fatal(err)
	}
	peerDrainDone := make(chan struct{})
	go func() {
		_, _ = io.Copy(io.Discard, peerConn)
		close(peerDrainDone)
	}()

	window := uint64(cfg.QueueFrames)
	writeDone := make(chan error, 1)
	go func() {
		_, err := io.CopyN(appConn, forwardXZeroReader{}, int64(window+32)*int64(cfg.ChunkSize))
		writeDone <- err
	}()

	deadline := time.Now().Add(3 * time.Second)
	for core.txSeq.Load() < window && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if got := core.txSeq.Load(); got != window {
		t.Fatalf("unacked send window mismatch: got=%d want=%d", got, window)
	}
	select {
	case err := <-writeDone:
		t.Fatalf("write escaped unacked window before ACK: %v", err)
	default:
	}

	core.Close()
	_ = peerConn.Close()
	select {
	case <-writeDone:
	case <-time.After(time.Second):
		t.Fatal("blocked logical writer did not stop with the core")
	}
	select {
	case <-peerDrainDone:
	case <-time.After(time.Second):
		t.Fatal("peer drain did not stop")
	}
}

// TestForwardXCoreHOLReplayKeepsBoosterAttached models a healthy booster whose
// successfully written frame is held behind an earlier preferred-leg frame at
// the receiver. A cumulative ACK cannot distinguish that head-of-line delay
// from packet loss. The replay timeout must send a fallback copy on leg 0
// without detaching and reconnecting the healthy booster.
func TestForwardXCoreHOLReplayKeepsBoosterAttached(t *testing.T) {
	cfg := forwardXGrayCoreConfig()
	cfg.ReplayTimeout = 100 * time.Millisecond
	failures := make(chan legFailureStage, 1)
	cfg.OnLegFailure = func(_ uint8, stage legFailureStage, _ error) {
		failures <- stage
	}
	left, leftApp := newCore(context.Background(), cfg)
	right, rightApp := newCore(context.Background(), cfg)
	defer left.Close()
	defer right.Close()

	leg0Left, leg0Right := net.Pipe()
	gatedLeg0 := newForwardXGateWriteConn(leg0Left)
	connectTestLeg(t, left, right, 0, gatedLeg0, leg0Right)
	leg1Left, leg1Right := net.Pipe()
	booster, _ := connectTestLeg(t, left, right, 1, leg1Left, leg1Right)

	received := make(chan forwardXReadResult, 1)
	go func() {
		buffer := make([]byte, 2*cfg.ChunkSize)
		n, err := io.ReadFull(rightApp, buffer)
		received <- forwardXReadResult{n: int64(n), err: err}
	}()

	first := left.getBuffer()
	second := left.getBuffer()
	for index := range first {
		first[index] = 0x11
		second[index] = 0x22
	}
	left.txSeq.Store(2)
	if !left.tryQueueNewFrame(left.getLeg(0), wireFrame{typ: frameTypeData, seq: 0, data: first}) {
		t.Fatal("failed to queue preferred frame")
	}
	select {
	case <-gatedLeg0.started:
	case <-time.After(time.Second):
		t.Fatal("preferred frame did not enter the gated write")
	}
	if !left.tryQueueNewFrame(left.getLeg(1), wireFrame{typ: frameTypeData, seq: 1, data: second}) {
		t.Fatal("failed to queue booster frame")
	}

	deadline := time.Now().Add(time.Second)
	for right.reorderCount.Load() == 0 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if right.reorderCount.Load() != 1 {
		t.Fatal("booster frame was not buffered behind the preferred frame")
	}
	time.Sleep(3 * cfg.ReplayTimeout)
	if current := left.getLeg(1); current != booster {
		t.Fatal("healthy booster was detached after cumulative ACK timeout")
	}
	select {
	case stage := <-failures:
		t.Fatalf("healthy booster reported failure at %s", stage)
	default:
	}

	gatedLeg0.Release()
	select {
	case result := <-received:
		if result.err != nil || result.n != int64(2*cfg.ChunkSize) {
			t.Fatalf("fallback delivery failed: n=%d err=%v", result.n, result.err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("fallback delivery timed out")
	}
	deadline = time.Now().Add(3 * time.Second)
	for left.ackedNext.Load() < 2 && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if left.ackedNext.Load() != 2 {
		t.Fatalf("fallback was not acknowledged: next=%d", left.ackedNext.Load())
	}
	if current := left.getLeg(1); current != booster {
		t.Fatal("healthy booster did not remain attached after fallback")
	}
	_ = leftApp
}

// TestForwardXCoreMixedReplayTimeoutDrains covers a scan containing both
// completed writes awaiting ACK and a genuinely stalled write. Every entry
// must reach fallback, including those visited before the stalled entry.
func TestForwardXCoreMixedReplayTimeoutDrains(t *testing.T) {
	for attempt := 0; attempt < 8; attempt++ {
		cfg := forwardXGrayCoreConfig()
		cfg.ReplayTimeout = 100 * time.Millisecond
		core, _ := newCore(context.Background(), cfg)
		primary, peer := net.Pipe()
		if _, err := core.addLeg(0, primary, nil); err != nil {
			t.Fatal(err)
		}
		booster, boosterPeer := net.Pipe()
		if _, err := core.addLeg(1, booster, nil); err != nil {
			t.Fatal(err)
		}
		go io.Copy(io.Discard, peer)
		old := time.Now().Add(-time.Second)
		core.replayMu.Lock()
		for seq := uint64(0); seq < 65; seq++ {
			entry := &replayEntry{frame: wireFrame{typ: frameTypeData, seq: seq, data: core.getBuffer()}, writeStartedAt: old, sentAt: old}
			if seq == 64 {
				entry.sentAt = time.Time{}
			}
			core.replay[seq] = entry
			core.replayBytes += int64(len(entry.frame.data))
		}
		core.replayMu.Unlock()
		deadline := time.Now().Add(time.Second)
		var remaining int
		for {
			core.replayMu.Lock()
			remaining = len(core.replay)
			core.replayMu.Unlock()
			if remaining == 0 || time.Now().After(deadline) {
				break
			}
			time.Sleep(time.Millisecond)
		}
		core.Close()
		peer.Close()
		boosterPeer.Close()
		if remaining != 0 {
			t.Fatalf("scan %d stranded %d replay frames", attempt, remaining)
		}
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
