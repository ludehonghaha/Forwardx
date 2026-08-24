# Managed protocol traffic attribution

ForwardX already records per-user traffic from Forward Rules and rolls that data into the existing traffic counters, 30-minute buckets, and daily user history.

Agent-managed protocol endpoints previously could listen directly on their public port without a Forward Rule. That meant traffic for Shadowsocks, Mieru, Snell, VLESS Reality, and Hysteria2 could bypass the existing Forward Rule traffic ledger.

This change keeps one traffic accounting model. When an enabled managed protocol endpoint has one enabled assigned user, ForwardX creates a system traffic bridge:

`public port -> Forward Rule -> 127.0.0.1:internal managed-protocol listen port`

The generated Forward Rule is owned by the assigned user, so normal Agent traffic reports continue through the existing Forward Rule accounting path. The bridge is tagged in the endpoint config with `_forwardxTrafficBridge` and is excluded from ordinary rule/port quota calculations.

Managed endpoints use shared runtime credentials. Accurate per-user attribution is therefore only possible when one enabled user owns a managed endpoint. ForwardX rejects multiple enabled users on the same managed endpoint instead of silently assigning shared traffic to the wrong account.

The bridge lifecycle follows endpoint and assignment lifecycle. Disabled, expired, traffic-exhausted, or account-disabled users do not cause an inactive bridge to be re-enabled. Removing the assignment or endpoint retires the generated bridge.

No Agent traffic-report protocol or database traffic-history schema is changed by this work.