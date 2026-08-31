# Dual / multipath Codex handoff — 2026-08-30

This document is the handoff for Draft PR #60 (`feat/dual-multipath-control-plane`).

## Current state

- PR #60 is intentionally **Draft** and **offline-only**.
- Current branch: `feat/dual-multipath-control-plane`.
- The control plane persists a versioned Dual draft, validates the fixed two-leg topology, previews deterministic multipath fragments, and builds a fail-closed deployment plan.
- No Agent push, runtime activation, systemd write, firewall mutation, or tunnel mutation is allowed yet.
- The latest CI before this handoff was green.

## Safety boundary

Do not deploy from this branch to production.

The production ForwardX panel and the Dual gray panel are separate environments. All Dual work must continue in the isolated gray environment first. Do not copy the production database into the Dual gray database and do not register or mutate production hosts/tunnels while implementing this feature.

The multipath protocol itself provides no authentication or encryption. The server multipath listener must therefore remain fail-closed by default. For the same-host NoBrand Dual layout, the safe default is loopback (`127.0.0.1`) and the listener must only be reachable through authenticated/trusted carrier paths.

## Verified upstream facts

Pinned experimental upstream:

- repository: `WuSiYu/singbox-multipath`
- commit: `1c36787d956d750f2ee58d73710d8006a11ccf2c`

At that commit:

1. `multipath` is a custom sing-box inbound/outbound carrying one logical TCP stream across exactly two child outbounds.
2. Leg 0 is the preferred/stable path; leg 1 joins after the configured traffic/queue trigger.
3. UDP is not aggregated and is delegated to one selected child outbound.
4. The upstream explicitly warns that multipath itself has no authentication/encryption and should only be reachable through trusted/authenticated child paths.
5. The pinned tree contains a real SOCKS outbound implementation (`protocol/socks/outbound.go`). It supports TCP dialing and UDP packet handling, so using a local SOCKS5 bridge as a child outbound is a supported sing-box shape; this is not a guessed field/type.
6. The pinned tree also contains native Hysteria2 support.

## Superseded Mieru assumption

The existing Mieru ecosystem uses:

- `mieru` = client
- `mita` = server

Mieru clients can expose a local SOCKS5 proxy, but the verified iStoreOS runtime does not run a standalone `mieru` process and has no `127.0.0.1:1080` listener. The active private proxy is managed inside OpenClash/Mihomo. Therefore the old `127.0.0.1:1080` draft value is not a runtime fact and must not be reused.

Do not assume Mieru is a native sing-box outbound. The Windows Gray adapter is now:

`singbox-multipath -> SOCKS5 child -> ForwardX-managed official enfein/mieru client -> existing Mita private carrier`

The Mieru client uses a per-run JSON through `MIERU_CONFIG_JSON_FILE` and foreground `mieru run`; it must not read or write Clash Mi or the user's global Mieru config.

## Verified target topology (sanitized)

The target NoBrand Dual host has two network sides:

- private/dedicated side: existing authenticated Mieru/Mita traffic arrives here;
- public/direct side: existing proxy egress leaves here and a future authenticated Hysteria2 carrier can use this side.

The live inspection confirmed that the current private-line Mieru traffic enters on the dedicated interface and Mita's normal Internet egress leaves on the public interface.

This does **not** mean the public interface is already a second multipath leg. Leg 1 still needs its own authenticated carrier definition (planned: Hysteria2).

## Intended same-host layout

Server side:

1. Keep the existing Mita service unchanged.
2. Add an authenticated Hysteria2 server on the public/direct side for leg 1.
3. Run the pinned `singbox-multipath` server with its multipath inbound bound to loopback only.
4. Both authenticated carriers must be able to reach the same remote loopback multipath listener.

Client / OpenWrt side:

1. Leave the existing Clash Mi process untouched.
2. Run pinned `singbox-multipath` and official pinned `enfein/mieru` as ForwardX-managed children.
3. Configure child outbound 0 as SOCKS5 -> dedicated official Mieru sidecar on loopback.
4. Configure child outbound 1 as native Hysteria2 -> Dual public carrier.
5. Configure `multipath` outbound with child order `[private, direct]`, preferred leg 0, and the safe server target represented by the remote loopback multipath listener through those authenticated carriers.
6. Expose one local SOCKS listener from the multipath sidecar to OpenClash/Mihomo.
7. OpenClash treats that local SOCKS endpoint as an ordinary proxy node. It must not be expected to parse the custom `multipath` outbound natively.

## Current verified-environment model in PR #60

The current draft intentionally uses conservative defaults such as:

- server target: `127.0.0.1`
- multipath port: `39000`
- private leg first / preferred leg index 0
- direct leg index 1
- UDP defaults to leg 0
- activation threshold: 120 Mbps
- activation window: 1s
- example expected bandwidth weights: private 160 / direct 700 Mbps

The server-internal `127.0.0.1:39000` candidate remains intentionally separate from the rejected client-side `127.0.0.1:1080` assumption. Client bridge and HY2 runtime details remain unresolved and block deployment.

Verified Dual server topology:

- `eth0 = 87.86.22.221/24`, public/Japan side, default gateway `87.86.22.1`;
- `eth1 = 172.16.4.114/24`, private-line side;
- active Mita binary is `/usr/bin/mita`; unit `mita-oneclick@uc650fd438a46ab4e.service` is active on TCP `*:11464` and must be preserved;
- no installed `sing-box`, `hysteria`, or standalone `mieru` binary was found.

The pinned source contains native Hysteria2 inbound/outbound support. Its normal release build tags include `with_quic`, so one correctly built and checksum-pinned singbox-multipath artifact can host both multipath and Hysteria2. Artifact provenance, architecture-specific checksums, final HY2 listener fields, secret injection, and runtime lifecycle are still unresolved.

## Windows official Mieru sidecar update

- official upstream: `enfein/mieru` `v3.36.0`
- commit: `155ebbd60f86e472586a60d7ffe58ec8f8682cb1`
- Windows amd64 ZIP SHA256: `f0136fa3bbfb1489a0a41c1ef5c3aa58ecf5b4793dc51d5a813cf7f5803017d1`
- `24181` is owned by the ForwardX-managed Mieru child and no longer depends on Clash Mi.
- real client username/password remain unresolved live secrets; they cannot be recovered from a Mita password checksum.
- `readyToDeploy=false`; no server deployment was performed.

## Codex next task

Continue from PR #60 without weakening the safety boundary.

Recommended next milestone: **offline carrier-aware sidecar planner**, still no deployment.

Implement enough structure to represent the two concrete carrier shapes without storing or exposing live secrets in previews/logs:

1. Private leg adapter:
   - type: local SOCKS5 bridge
   - target: configurable local host/port for the Mieru client listener
   - optional username/password support only if required
   - secret values must be redacted from API preview/log output

2. Direct leg adapter:
   - type: Hysteria2
   - server / port / TLS server name / auth secret references
   - secrets must remain separate from the deterministic public preview

3. Generate a complete **offline** client-side `singbox-multipath` config preview containing:
   - SOCKS child outbound
   - Hysteria2 child outbound
   - multipath outbound
   - local SOCKS inbound for OpenClash sidecar consumption

4. Generate a complete **offline** server-side preview containing:
   - loopback-only multipath inbound
   - placeholders/references for the authenticated carrier services

5. Add validation/tests proving:
   - multipath listener cannot default to public exposure;
   - exactly two child legs are emitted in private-first order;
   - both child tags are distinct and resolvable;
   - secrets never appear in the public preview or thrown validation messages;
   - OpenClash compatibility is represented as `local SOCKS sidecar`, not native multipath import;
   - invalid carrier definitions perform zero persistence/runtime writes;
   - output is deterministic.

6. Keep `readyToDeploy=false` until all of the following are explicitly resolved:
   - real gray target binding;
   - target architecture/install path;
   - pinned binary artifact/checksum strategy;
   - complete carrier definitions;
   - server listener exposure verification;
   - `sing-box check` on generated full configs;
   - gray-only runtime lifecycle and rollback design.

## Do not do yet

- Do not merge PR #60.
- Do not deploy to the production ForwardX panel.
- Do not change the production ForwardX database.
- Do not modify the existing live Mieru/Mita service.
- Do not expose the bare multipath listener on `0.0.0.0`/public Internet.
- Do not install/restart Hysteria2 on the live Dual host as part of the offline planner milestone.
- Do not add Agent command dispatch or automatic runtime activation yet.

## Acceptance for the next Codex pass

The next pass is successful when the Draft PR can take sanitized carrier definitions and deterministically produce redacted, full client/server sidecar config previews with tests, while still being physically incapable of deploying them.

## Superseded v2 planner note

The previous milestone used Dual draft version 2 (`dualMultipathDraftV2`). It is retained only as a legacy read source.

The v2 public draft stores only:

- the local Mieru client SOCKS5 loopback endpoint and optional `dual.*` username/password secret references;
- the Hysteria2 server, port, TLS server name, and a `dual.*` auth secret reference;
- the OpenClash-facing local SOCKS loopback endpoint.

It does not accept or resolve secret values. The deterministic public preview emits `<secret:...>` placeholders in the pinned sing-box fields.

The client preview is now a complete offline sidecar shape: local SOCKS inbound for OpenClash, private SOCKS child first, Hysteria2 child second, multipath outbound third, and `route.final` pointing to the multipath tag. The server preview keeps the loopback-only multipath config separate from an explicitly uncompiled authenticated-carrier runtime descriptor.

## Client-bound read-only discovery v5 update

The current offline model uses `dualMultipathDraftV5` and separates:

- `serverTargetDiscovery`: server-only verified facts such as interfaces, addresses, gateway, and the existing Mita listener;
- `clientTarget`: a separate canonical client binding, either a Panel-owned `hosts.id` or a namespaced external OpenWrt stable key;
- `openClashIngressAdapter`: ForwardX Dual sidecar's loopback SOCKS ingress for OpenClash;
- `privateCarrierBridge`: preferred `forwardx-managed-mieru-sidecar`; legacy `mihomo-dedicated-listener` remains parseable only for compatibility, and `external-local-socks5` remains discovery-gated;
- `directCarrier`: native Hysteria2 endpoint and references, unresolved until final runtime facts exist;
- `serverRuntime`: target-independent loopback multipath and unresolved native HY2 runtime policy.

The generic Zod schema has no `eth0`/`eth1`, fixed address, gateway, or Mita-port literals. The verified NoBrand values live in `NO_BRAND_DUAL_SERVER_DISCOVERY_SNAPSHOT`. A second Dual server only needs another server snapshot. A server target object cannot be used as a client identity.

Both client loopback listeners retain independent `portPlanning`, while every planned port stores evidence containing both `snapshotId` and the canonical `clientTargetRef`. A v5 schema rejects evidence from another client. Changing the bound client therefore invalidates old evidence rather than reusing a coincidentally free port across devices.

`DualClientDiscoverySnapshot` remains the shared input-only contract for occupied TCP ports. Its minimal Mihomo candidate facts are retained only for legacy draft validation and cannot contain passwords, tokens, keys, subscriptions, or raw config. Freshness is evaluated deterministically from explicit `referenceTime/maxAgeMs`; stale or future snapshots cannot create evidence. The ForwardX-managed Mieru bridge needs only port planning and never consumes Clash Mi candidates.

The persisted setting key is now `dualMultipathDraftV5`. V1, v2, both v3 shapes, and v4 are upgraded only in memory. Because v4 had no canonical client binding, its old client ports and proxy discovery are deliberately downgraded to unresolved. Server discovery, HY2 fields, and secret references are preserved. No migration write occurs until an administrator explicitly saves v5.

The normal ForwardX UI exposes one Dual aggregate line: Mieru/private status and bandwidth, HY2/direct status and bandwidth, small-flow preference, activation threshold, status, and the future subscription action. Ports, listener tags, loopback addresses, interfaces, and secret references are hidden under diagnostics or auto-managed.

Deployment remains blocked and `readyToDeploy` remains false. No Agent dispatch, runtime mutation, OpenClash write, installation, systemd action, firewall change, route change, gray deployment, or production deployment was added.
