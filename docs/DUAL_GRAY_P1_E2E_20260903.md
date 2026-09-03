# ForwardX Dual P1 Gray E2E — 2026-09-03

This is a sanitized acceptance record. It contains no Mieru password, HY2
authentication value, TLS private key, or SSH key.

## Topology exercised

- Client ingress: `127.0.0.1:24180` SOCKS.
- Preferred leg: official Mieru v3.36.0 sidecar on `127.0.0.1:24181`, through
  an isolated temporary CM-IPLC Mita instance on TCP `11401`.
- Booster leg: existing ForwardX Agent HY2 at `87.86.22.221:24618/udp`, mapped
  by `forwardx-runtime.service` to the existing `13666/udp` listener.
- Server multipath: pinned `WuSiYu/singbox-multipath` commit
  `1c36787d956d750f2ee58d73710d8006a11ccf2c`, listening only on
  `127.0.0.1:39000`.
- Workload origin: temporary `127.0.0.1:39200` HTTP byte stream on the Dual
  server, so origin instability could not be confused with carrier behavior.

The temporary Mita user alone had `allowLoopbackIP=true`. The production Mita
configuration on TCP `11464` remained byte-identical and its user kept the
field missing.

## Deterministic activation result

Configuration: `activationAfterBytes=8 MiB`, `activationThresholdMbps=120`,
`activationWindow=1s`, `tcp_fast_open=false`, and the default
`leg1_replay_timeout=5s`.

- One HTTP/1.1 connection completed `67,108,864` application bytes.
- Elapsed: `6.783409s`.
- Average application throughput: `9,893,088 B/s` (`79.14 Mbps`).
- Preferred Mieru leg payload delta: `67,109,041` received bytes.
- HY2 booster leg payload delta: `5,701,545` received bytes.
- Existing HY2 network counter corroboration: UDP source-port `24618` grew by
  `6,628,175` bytes during the same measurement window.
- Multipath reported zero leg errors, zero reorder bytes, and zero replay bytes
  at completion.
- Server logs recorded leg 0 session establishment, leg 1 joining that session,
  and leg 1 entering the data path for the same `127.0.0.1:39200` destination.

A following 1 MiB connection completed on Mieru only: Mieru delta `1,048,752`
bytes, HY2 delta `0` bytes. This confirms a new connection returns to the
private-first policy.

## Formal policy result

After removing `activationAfterBytes`, the formal
`activationThresholdMbps=120 / activationWindow=1s` configuration completed
another 64 MiB single connection in `6.727188s` (`79.81 Mbps` application
average). The server activated leg 1 with `reason=throughput`, measuring
`431.82 Mbps` over `1.1s`; payload deltas were `62,062,846` bytes on Mieru and
`5,373,870` bytes on HY2, with zero reported leg errors/reorder/replay.

## Conclusion and remaining blocker

Technical conclusion: **TRUE SINGLE-FLOW MULTIPATH** for the completed 64 MiB
acceptance runs. This is not per-flow load balancing or failover: both carrier
payload counters increased inside one completed application TCP connection,
and the server joined both transport legs to one multipath session.

`readyToDeploy` remains false. Two `tcp_fast_open=true` large-flow attempts
reset after leg 1 activation, and a later 256 MiB repeated-session attempt also
reset early even with fast-open disabled. The pinned fork therefore still
needs long-flow/repeated-session stabilization and soak testing. ForwardX now
uses `tcp_fast_open=false` as the conservative offline default.

## Cleanup and protected services

The temporary `11401`, `39000`, and `39200` listeners, transient units,
credential material, binaries, runtime directories, and dedicated Gray nft
table were removed. Production Mita stayed at PID `92965` with `NRestarts=0`;
the production Mita config, NoBrand users state, and NoBrand ingress-firewall
state hashes matched their pre-test values. Existing HY2 services stayed at
their original PIDs with `NRestarts=0`; routes and the original ForwardX main
worktree were unchanged. PR #60 remains Draft and was not merged.
