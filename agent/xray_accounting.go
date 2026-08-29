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
// that report is acknowledged. Baselines not present in this Xray snapshot are
// retained: statsquery may omit an idle counter, and forgetting it would replay
// already-accounted bytes if that assignment appears again later.
func diffXrayAssignmentTraffic(
	current []xrayAssignmentTrafficStat,
	acknowledged map[int]xrayTrafficBaseline,
) (deltas []xrayAssignmentTrafficStat, nextBaselines []xrayTrafficBaseline) {
	nextByAssignment := make(map[int]xrayTrafficBaseline, len(acknowledged)+len(current))
	for assignmentID, baseline := range acknowledged {
		if assignmentID <= 0 || baseline.AssignmentID != assignmentID {
			continue
		}
		nextByAssignment[assignmentID] = baseline
	}

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
		nextByAssignment[stat.AssignmentID] = xrayTrafficBaseline{
			AssignmentID: stat.AssignmentID,
			BytesIn:      stat.BytesIn,
			BytesOut:     stat.BytesOut,
		}
	}

	for _, baseline := range nextByAssignment {
		nextBaselines = append(nextBaselines, baseline)
	}
	sort.Slice(deltas, func(i, j int) bool {
		return deltas[i].AssignmentID < deltas[j].AssignmentID
	})
	sort.Slice(nextBaselines, func(i, j int) bool {
		return nextBaselines[i].AssignmentID < nextBaselines[j].AssignmentID
	})
	return deltas, nextBaselines
}
