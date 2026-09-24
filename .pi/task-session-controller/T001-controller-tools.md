Status: DONE
Work area
`packages/coding-agent`

Objective
Implement and verify the C4 Phase 2 canonical Controller tool set without changing Phase 1 Executor semantics.

Inputs
- `control/task-session-controller/goal.md`
- `design/architecture/task-session-native.md`
- Existing `AgentSessionRuntime.startAssignedTask()` and control authorities.

Completion
All six Controller tools are installed only on the canonical Controller Session, dispatch creates/reuses Executor Sessions and starts the existing admission protocol, notices use native prompt messaging, close mutates Task terminal state, and focused acceptance plus `npm run check` pass without ExecutionAttempt writes.

Result
Implemented:
- Added controlled Task definition creation and non-terminal definition revision for objective, constraints, inputs, and completion.
- Added Controller-only `create_task`, `revise_task`, `inspect_task`, `dispatch_task`, `notice_executor`, and `close_task` tools.
- Controller tools are installed only when the runtime Session is the canonical Controller Session.
- `dispatch_task` accepts an existing live Session, creates a new Executor Session when omitted, rejects non-dispatchable Tasks and existing assignments, then calls the existing native `startAssignedTask()` admission path.
- `notice_executor` uses ordinary AgentSession.prompt messaging and does not mutate Task lifecycle.
- `close_task` uses existing complete/cancel lifecycle mutations and releases assignment.
- Executor tool set remains the Phase 1 `task_gate`, `task_memory`, and `task_result` path.
- No ExecutionAttempt records are created or written.

Acceptance:
- `packages/coding-agent/test/controller-task-tools.test.ts`: passed, including create/revise/inspect/dispatch, tool separation, notice, termination, redispatch to another Session, close, and no attempts.
- `packages/coding-agent/test/native-task-lifecycle.test.ts`: passed.
- Task mutation and association regressions: passed.
- `npm run check`: PASS.

Remaining
None for Phase 2. Do not proceed to dependencies, frontier, context budget, autonomous orchestration, escalation, review, or scheduler.
