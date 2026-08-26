package main

import "sort"

// xrayTrafficBaseline is the last cumulative Xray counter that the Panel has
// acknowledged for one ForwardX assignment. It is deliberately keyed only by
// assignmentId; user ownership is resolved by the Panel from its own database.
type xrayTrafficBaseline struct {
	AssignmentID int    `json:"assignmentId"`
	BytesIn      uint64 `json:"bytesIn"`
	BytesOut     uint64 `json:"bytesOut"`
}

// xrayCounterDelta converts a cumulative runtime counter into an unacknowledged
// delta. A lower current value means Xray started a new counter epoch (for
// example after a restart), so the current value itself is the new delta.
func xrayCounterDelta(current, acknowledged uint64) uint64 {
	if current < acknowledged {
		return current
	}
	return current - acknowledged
}

// diffXrayAssignmentTraffic calculates the bytes that have not yet been
// acknowledged by the Panel and the cumulative baseline to commit only after
// that report is acknowledged. Unchanged counters are omitted from deltas but
// still appear in nextBaselines so an ACK can advance the durable checkpoint.
func diffXrayAssignmentTraffic(
	current []xrayAssignmentTrafficStat,
	acknowledged map[int]xrayTrafficBaseline,
) (deltas []xrayAssignmentTrafficStat, nextBaselines []xrayTrafficBaseline) {
	for _, stat := range current {
		if stat.AssignmentID <= 0 {
			continue
		}
		previous := acknowledged[stat.AssignmentID]
		delta := xrayAssignmentTrafficStat{
			AssignmentID: stat.AssignmentID,
			BytesIn:      xrayCounterDelta(stat.BytesIn, previous.BytesIn),
			BytesOut:     xrayCounterDelta(stat.BytesOut, previous.BytesOut),
		}
		if delta.BytesIn > 0 || delta.BytesOut > 0 {
			deltas = append(deltas, delta)
		}
		nextBaselines = append(nextBaselines, xrayTrafficBaseline{
			AssignmentID: stat.AssignmentID,
			BytesIn:      stat.BytesIn,
			BytesOut:     stat.BytesOut,
		})
	}

	sort.Slice(deltas, func(i, j int) bool {
		return deltas[i].AssignmentID < deltas[j].AssignmentID
	})
	sort.Slice(nextBaselines, func(i, j int) bool {
		return nextBaselines[i].AssignmentID < nextBaselines[j].AssignmentID
	})
	return deltas, nextBaselines
}
