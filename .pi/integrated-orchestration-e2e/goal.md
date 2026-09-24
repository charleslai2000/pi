# Goal: C4 Phase 7 Integrated Orchestration E2E

## Authorized goal
Run a real Session-native orchestration integration acceptance for the frozen Phase 1–6 control plane.

## Scope
- Add an integrated E2E suite using real AgentSession, SessionPool, Task Markdown, Controller tools, Executor lifecycle tools, assignments, dependencies, model switching, review Tasks, and registry restart/recovery evidence.
- Record event order and durable state assertions.

## Constraints and exclusions
- No new architecture, tools, scheduler, Execution runtime, ExecutionAttempt, reviewer runtime, or second authority.
- Preserve Phase 1–6 unchanged.
- Do not push or commit.

## Completion condition
The integrated suite proves the requested DAG, parallel sessions, settle/resume, termination/redispatch, frontier dispatch, same-Session switching, conditional review behavior, recovery/canonical Controller, isolation, and no legacy attempt state. Run focused regressions and `npm run check`. Stop after Phase 7.
