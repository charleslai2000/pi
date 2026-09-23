# Current control state

## Established results
- Accepted architecture is frozen in `design/architecture/task-session-native.md`.
- Task.md is lifecycle SSOT and durable Task memory; an assigned long-lived Pi AgentSession is the Executor.
- Native Executor lifecycle, run/assignment generation CAS, stop-envelope semantics, and stale-settle rejection passed `npm run check` and the requested focused regressions (8 files, 32 tests).
- No current `task_result` protocol references remain in runtime source/tests/design.

## Decisive frontier
Pi Control Plane runtime semantics and implementation/recovery are closed. OpenCodeX live service verification remains blocked by its external compiled routing preset mismatch; see `control/opencodex-formal-pi-root-migration/plan.md`. No Pi-side implementation dependency remains.

## Active tasks
- None for Pi Control Plane implementation. OpenCodeX-owned live startup and any authorized GPT-6 continuation scope remain external.

## Result
`RUNTIME SEMANTICS CLOSURE = PASS`

Evidence: `npm run check`; association and lifecycle tests; integrated orchestration E2E; SessionRegistry/recovery and `/sessions` projection regressions passed together (8 files / 32 tests). Assignment generations derive monotonically from durable assignment history; stale settle after redispatch/new run is rejected without Task mutation or Controller notification. `continue_possible` remains ACTIVE and same-Session completion succeeds.
