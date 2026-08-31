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

Do not assume Mieru is a native sing-box outbound. The preferred adapter is now:

`singbox-multipath -> SOCKS5 child -> Mihomo dedicated loopback listener -> one pure Mieru proxy -> existing Mita private carrier`

The dedicated listener must bypass normal rules, must not be a generic mixed listener, must not recurse into the ForwardX Dual ingress, and must not target a group containing DIRECT or public fallback.

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

1. Preserve the existing OpenClash/Mihomo process and its Mieru proxy.
2. Run pinned `singbox-multipath` as a ForwardX-managed sidecar.
3. Configure child outbound 0 as SOCKS5 -> dedicated Mihomo listener -> one pure Mieru proxy.
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
- existing `/usr/local/bin/mita` service is active on TCP `*:11464` and must be preserved;
- no installed `sing-box`, `hysteria`, or standalone `mieru` binary was found.

The pinned source contains native Hysteria2 inbound/outbound support. Its normal release build tags include `with_quic`, so one correctly built and checksum-pinned singbox-multipath artifact can host both multipath and Hysteria2. Artifact provenance, architecture-specific checksums, final HY2 listener fields, secret injection, and runtime lifecycle are still unresolved.

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

## Read-only auto-port v4 planner update

The current offline model uses `dualMultipathDraftV4` and separates:

- `targetDiscovery`: a target-specific, verified-read-only discovery snapshot; interface names, addresses, gateway, and the existing Mita listener are data rather than schema literals;
- `openClashIngressAdapter`: ForwardX Dual sidecar's loopback SOCKS ingress for OpenClash;
- `privateCarrierBridge`: preferred `mihomo-dedicated-listener`, with `external-local-socks5` available only when a real endpoint has been discovered;
- `directCarrier`: native Hysteria2 endpoint and references, unresolved until final runtime facts exist;
- `serverRuntime`: target-independent loopback multipath and unresolved native HY2 runtime policy.

The generic Zod schema has no `eth0`/`eth1`, fixed address, gateway, or Mita-port literals. The verified NoBrand values live in `NO_BRAND_DUAL_DISCOVERY_SNAPSHOT`. A second Dual with different interfaces, addresses, gateway, and Mita port only needs another snapshot; it does not require a source/schema change.

Both client loopback listeners now have their own `portPlanning` union. Unresolved planning stores `strategy: "auto"` and `port: null`; planned evidence stores `status: "planned-read-only"`, a concrete port, and the source `snapshotId`. Pure Mieru proxy discovery is a separate target fact. Mihomo bridge readiness is derived only when both facts are satisfied.

`DualPortAvailabilitySnapshot` is input-only read-only evidence. The pure `planDualClientLoopbackPorts()` function performs a deterministic ascending scan of the single centrally defined `23180-23279` candidate range, preserves valid existing choices, rejects occupied ports, guarantees distinct ingress/private ports, and fails closed if fewer than two ports are available. It performs no collection, external call, socket probing, persistence, or system mutation. The ordinary form does not expose or rewrite these details. The server-internal multipath listener remains the separate loopback-only `127.0.0.1:39000` candidate.

The persisted setting key is now `dualMultipathDraftV4`. V1, v2, the portable v3 shape, and the earlier pinned-host v3 shape are upgraded only in memory. Any v2 `127.0.0.1:1080` value and every v3 client port without snapshot evidence are deliberately discarded and replaced with unresolved planning. Verified proxy discovery and target facts are retained when their old shape provided an unambiguous claim. No migration write occurs until an administrator explicitly saves v4.

The normal ForwardX UI exposes one Dual aggregate line: Mieru/private status and bandwidth, HY2/direct status and bandwidth, small-flow preference, activation threshold, status, and the future subscription action. Ports, listener tags, loopback addresses, interfaces, and secret references are hidden under diagnostics or auto-managed.

Deployment remains blocked and `readyToDeploy` remains false. No Agent dispatch, runtime mutation, OpenClash write, installation, systemd action, firewall change, route change, gray deployment, or production deployment was added.
