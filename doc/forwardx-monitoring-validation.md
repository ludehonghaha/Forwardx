# Monitoring validation checklist

- [ ] TypeScript type-check passes.
- [ ] New per-user daily traffic regression passes on SQLite.
- [ ] Existing traffic batch/agent traffic regressions still pass.
- [ ] Existing host network quality regression passes with jitter assertions.
- [ ] Panel build passes.
- [ ] Agent and FXP Go tests/vet remain green.
- [ ] No changes are made to existing host status or Runtime desired-state paths.
