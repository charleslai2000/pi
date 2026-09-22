Status: DONE
Work area
`packages/coding-agent`

Objective
Add a real integrated Session-native orchestration E2E for the frozen Phase 1–6 control plane.

Inputs
- `control/integrated-orchestration-e2e/goal.md`
- Existing AgentSession, SessionPool, SessionRegistry, Controller tool, Task lifecycle, dependency/frontier, and recovery tests.

Completion
Real E2E proves the requested DAG/lifecycle/parallelism/recovery/review/isolation/model-switch invariants, records durable event evidence, and focused regressions/check pass.

Result
Extended `packages/coding-agent/test/integrated-orchestration-e2e.test.ts` over the real PiRoot application, AgentSession, SessionPool, SessionRegistry, SessionManager persistence/reopen, Controller tools, and Task Markdown:
- Parallel T001/T002 dispatch to separate durable Executor Sessions.
- Executor gate, memory, result lifecycle.
- Natural settle produces BLOCKED while assignment remains; direct user prompt on the same Executor produces native start/settle events and ACTIVE continuation, with identity and durable memory preserved.
- Same-Session model switch preserves Executor identity.
- T001/T002 completion exposes T003 in derived frontier and dispatches the join Task.
- T004 ordinary conditional Review Task dispatches to another Executor; PASS leaves T003 DONE.
- T005 terminated result produces DEFERRED and releases assignment; Controller dispatches it to another Executor, which sees the durable handoff memory and completes it.
- T006 remains assigned and BLOCKED across application shutdown/restart; canonical Controller identity is recovered, the Executor Session is reopened from its persisted file, and `startAssignedTask` reinstalls the Task gate.
- Controller tools are present only on Controller; Executor sessions do not receive Controller tools. Executor sessions retain separate bindings.
- Persisted Executor session headers are asserted, covering the automatic durable session-header fix.
- No redispatch loop, new Task identity, or ExecutionAttempt state is created by direct Executor interaction.

Acceptance:
- Integrated E2E: 1 file / 1 test passed.
- Integrated plus recovery/session/lifecycle/dependency regressions: 8 files / 16 tests passed.
- `npm run check`: PASS.

Remaining
None. C4 Phase 7 closure is complete.
