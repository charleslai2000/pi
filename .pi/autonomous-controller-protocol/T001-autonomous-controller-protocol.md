Status: DONE
Work area
`packages/coding-agent`

Objective
Complete the canonical Controller system protocol while keeping runtime event delivery and existing tools policy-neutral.

Inputs
- `control/autonomous-controller-protocol/goal.md`
- Frozen Phase 1–4B architecture and runtime.

Completion
Controller protocol is installed only on canonical Controller, describes fact-driven autonomous decisions and natural settle, Controller close does not self-notice, Executor notices remain delivered, and focused tests/check pass without scheduler authority.

Result
Implemented:
- Added canonical Controller system protocol covering factual notices, inspect_task/inspect_frontier, notice_executor, dispatch_task, close_task, natural settle, and explicit no-scheduler/no-polling boundaries.
- Protocol is installed only on the canonical Controller Session through the existing task-session protocol seam.
- Removed self-notice from Controller `close_task` complete/cancel mutations.
- Executor-originated reject, BLOCKED, DONE, and DEFERRED notices remain delivered.
- No automatic dispatch, resume loop, polling, scheduler state, model escalation, or new tool was added.
- No ExecutionAttempt or second orchestration authority was introduced.

Acceptance:
- Controller, Executor lifecycle, and dependency/frontier focused tests passed.
- `npm run check`: PASS.

Remaining
None for Phase 4C. Stop; do not enter context-budget enforcement, model escalation, or review.
