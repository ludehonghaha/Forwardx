# Managed protocol traffic attribution

ForwardX already records per-user traffic from Forward Rules and rolls that data into the existing traffic counters, 30-minute buckets, and daily user history.

Agent-managed protocol endpoints previously could listen directly on their public port without a Forward Rule. That meant traffic for Shadowsocks, Mieru, Snell, VLESS Reality, and Hysteria2 could bypass the existing Forward Rule traffic ledger.

This change keeps one traffic accounting model. When an enabled managed protocol endpoint has one enabled assigned user, ForwardX creates a system traffic bridge:

`public port -> Forward Rule -> 127.0.0.1:internal managed-protocol listen port`

The generated Forward Rule is owned by the assigned user, so normal Agent traffic reports continue through the existing Forward Rule accounting path. The bridge is tagged in the endpoint config with `_forwardxTrafficBridge` and is excluded from ordinary rule/port quota calculations. Non-admin users cannot update, toggle or delete the system bridge directly.

Managed endpoints use shared runtime credentials. Accurate per-user attribution is therefore only possible when one enabled user owns a managed endpoint. ForwardX rejects multiple enabled users on the same managed endpoint instead of silently assigning shared traffic to the wrong account.

The bridge lifecycle follows endpoint and assignment lifecycle. Disabled, expired, traffic-exhausted, or account-disabled users do not cause an inactive bridge to be re-enabled. Removing the assignment or endpoint retires the generated bridge. Changing the public port, internal listen port or effective socket protocol causes the bridge to be rebuilt atomically with both ports reserved during the replacement.

Panel startup reconciles existing managed endpoints so already-created single-user protocol assignments are connected to the existing traffic ledger without requiring the administrator to recreate the endpoint or assignment. Reconciliation failures are isolated per endpoint and logged instead of aborting panel startup.

The bridge marker is panel-owned metadata. Create/edit payloads cannot inject or replace `_forwardxTrafficBridge`; edits preserve the trusted marker already stored on the endpoint.

No Agent traffic-report protocol or database traffic-history schema is changed by this work.
