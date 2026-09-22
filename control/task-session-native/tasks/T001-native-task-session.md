Status: DONE

Work area
`packages/coding-agent`

Objective
Replace the C4 execution-attempt normal Task dispatch with Pi-native long-lived assigned AgentSession execution, preserving C0–C3 control/session authorities.

Inputs
- User architecture correction and frozen design at `design/architecture/task-session-native.md`.
- Existing AgentSessionRuntime, SessionPool, SessionRegistry, assignments, Task Markdown read model, and Task lifecycle.

Completion
- Assigned Task bootstrap starts through ordinary AgentSession prompt/continue.
- `/execute` is not required for normal Task work.
- Normal Task work does not create or require ExecutionAttempt records.
- C4-only provider provenance, budget, stop gate, and invocation-counter changes are removed from active code.
- Task.md durable-memory protocol is available through the Session-scoped `task_memory` tool.
- Native lifecycle acceptance and regression checks pass.

Result
Completed Phase 1 native lifecycle cutover.

Implemented:
- Pre-admission tool loadout: only `task_gate` is active after assignment/bootstrap.
- `task_gate(accept)` transitions Task to ACTIVE and restores prior Pi tools plus `task_memory` and `task_result`.
- `task_gate(reject)` releases assignment without activating the Task.
- Accepted ACTIVE settle transitions to BLOCKED; later same-Session start transitions BLOCKED back to ACTIVE.
- Lifecycle event mutations verify the binding and current `assignments.json` ownership, preventing stale Session events from mutating Task state.
- `task_memory` writes only the bound Task's `Memory:` field.
- `task_result(complete)` writes result and sets DONE; `task_result(terminated)` writes result/remaining and sets DEFERRED; both release assignment.
- Removed `executeAssignedTask()` and its ExecutionAttempt/report/budget/stop/terminal persistence runtime.
- Removed C4 `Usage.outputKnown` and provider provenance changes.
- Removed invocation-counter acceptance test and obsolete executor-centric tests.
- Removed unused execution stop/budget no-op migration APIs and their old test callers.
- `execution-attempts.ts` remains LEGACY-ONLY for historical parser/audit compatibility; no normal production runtime caller remains.

Acceptance:
- `packages/coding-agent/test/native-task-lifecycle.test.ts`: 3 tests passed.
- Task mutation, association, and SessionRegistry regressions: 17 tests passed.
- `npm run check`: PASS.

Remaining
None for Phase 1. Do not proceed to Controller tools, DAG, frontier, context budget, escalation, review, or scheduler without a new phase decision.
