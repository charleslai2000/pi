Status: DONE
Work area
`packages/coding-agent`

Objective
Implement the frozen native context budget state machine and factual Controller exhaustion notice.

Inputs
- `control/context-budget-policy/goal.md`
- Existing `ExecutorContextSnapshot`, AgentSession native context usage, compaction, and event bridge.

Completion
Budget state is derived as available/compacting/unknown/exhausted, exhaustion notices are factual and deduplicated, no lifecycle or tool changes occur, focused tests and `npm run check` pass.

Result
Implemented and frozen:
- `available`: usage known, not compacting, current usage below contextWindow.
- `compacting`: Pi native compaction active; no exhaustion decision.
- `unknown`: usage unavailable/unknown, including post-compaction before valid post-compaction usage; never exhausted.
- `exhausted`: usage known, not compacting, current usage at or above contextWindow.
- Added `budgetState` to `ExecutorContextSnapshot`.
- Native Session settle observation emits a deduplicated factual Controller notice when the Executor is exhausted; notice reports ACTIVE/executor budget fact and does not mutate Task state.
- Native Pi compaction remains unchanged and no automatic compaction is triggered.
- No Executor tool, provider Usage change, output-token accumulation, ExecutionAttempt, persistence authority, termination, redispatch, or escalation policy was added.

Policy conclusion
Context budget is current Executor Session observation only. The effective limit is the active Pi model `contextWindow`; current usage is native `getContextUsage()`. Exhaustion is not Task failure, BLOCKED, or terminated. Controller policy decides any next action.

Acceptance:
- Context snapshot available/exhausted/unknown tests passed.
- Controller, native lifecycle, and AgentSession context stats regressions passed.
- `npm run check`: PASS.

Remaining
None for Phase 5A. Stop; do not enter model escalation.
