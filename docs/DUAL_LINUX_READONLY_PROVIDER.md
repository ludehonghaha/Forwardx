# Dual Linux/OpenWrt read-only provider

This layer is the first concrete backend for the fixed Dual discovery collector. It is intentionally **not** connected to the Agent transport yet.

## What it reads

The provider uses Linux/OpenWrt kernel-exposed state only:

- `/proc/sys/kernel/osrelease`
- `net.Interfaces()` address snapshots
- `/proc/net/route`
- `/proc/net/tcp` and `/proc/net/tcp6`
- `/proc/<pid>/comm`, `/proc/<pid>/exe`, and `/proc/<pid>/fd` for an already-running `mita` process
- `stat(2)`-style checks for known binary locations

It never asks the Panel for a command and never exposes a command/argv/cwd/env field.

## Port planning

Loopback TCP candidate ports are checked from the read-only `/proc/net/tcp*` listener snapshot.

- matching listener -> `occupied`
- no matching listener in the readable snapshot -> `available`
- unreadable/invalid state -> provider error, which the collector converts to `unknown`

The `available` result is only discovery evidence. A future deployment/apply layer must re-check immediately before committing a planned port, so this snapshot is not treated as a lock or reservation.

The provider deliberately does **not** call `net.Listen` just to test a port, because even a temporary bind would no longer be a strictly read-only discovery operation.

## Mita discovery

A Mita runtime is reported only when all of these facts line up:

1. an existing process has `/proc/<pid>/comm == mita`;
2. its socket FD inode is visible;
3. that inode maps to a TCP LISTEN entry in `/proc/net/tcp*`.

If no matching runtime is found, the provider returns no Mita runtime evidence. It does not fabricate an inactive service. If multiple Mita listeners are associated with the process, discovery fails closed instead of guessing which listener is the carrier.

No `systemctl` call is used, so `serviceStatus=active` here means an observed running Mita process with a listening socket, not a claim about a particular init system. This keeps the backend usable on both systemd Linux and OpenWrt-style systems.

## Explicitly forbidden in this layer

- `os/exec` / arbitrary process execution
- `ip`, `ss`, `systemctl`, shell scripts
- SSH
- file writes
- socket binds for probing
- OpenClash/UCI changes
- Mita/HY2 changes
- firewall or route changes
- binary installation
- Gray/Production deployment

## Current integration boundary

The flow is now:

```text
fixed v1 request
  -> strict Agent handler core
  -> dependency-injected collector
  -> Linux/OpenWrt read-only provider (this layer)
  -> typed evidence
```

The production Agent transport still does not instantiate/register this provider. That wiring belongs to a later reviewed step.
