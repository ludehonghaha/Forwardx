# Managed protocol traffic validation

Before merge or production rollout:

1. Full TypeScript check, server tests, protocol-access tests, build, and docs build pass.
2. Existing managed endpoint without an assignment does not create a traffic bridge.
3. Assigning one enabled user creates one system bridge rule and moves the managed protocol listener to an internal loopback port.
4. A second enabled user assignment is rejected for managed shared-credential endpoints.
5. The system bridge does not consume the user's ordinary `maxRules` or `maxPorts` quota.
6. Agent runtime keeps the protocol listener and bridge Forward Rule on the same host.
7. Forward Rule traffic reports attribute bytes and connections to the assigned user and continue into existing daily traffic history.
8. Disabling/removing the assignment or endpoint retires/disables the bridge.
9. Disabled, expired, or traffic-exhausted users do not get an inactive bridge re-enabled.
10. Existing ordinary forwarding rules and external protocol endpoints remain unchanged.

Production canary should be panel-first. Do not mass-upgrade Agents for this change because the Agent traffic-report protocol is unchanged.