Status: DONE
Work area
`packages/coding-agent`

Objective
Deliver factual Executor/Task state notices to the canonical Controller Session through native Pi messaging.

Inputs
- `control/controller-event-bridge/goal.md`
- Existing AgentSessionRuntime lifecycle seams and SessionPool.

Completion
Reject, BLOCKED settle, complete, and terminated events notify the canonical Controller; delivery handles running/settled Controller sessions through native queueing, deduplicates identical facts, does not mutate Task state or persist authority, and focused tests/check pass.

Result
Implemented:
- Added runtime-only canonical Controller notice bridge in AgentSessionRuntime.
- `task_gate(reject)` emits factual READY/rejection notice.
- Accepted ACTIVE settle emits factual BLOCKED notice with executor and settle reason.
- `task_result(complete)` and `task_result(terminated)` emit DONE/DEFERRED notices.
- Controller close mutations emit factual lifecycle notices.
- Running Controller sessions receive notices through native `steer`; settled Controllers receive normal `prompt` wake-up on the same Session.
- Identical fact keys are deduplicated during the runtime lifetime.
- Notices do not change Task state, create assignments, persist a second authority, or create ExecutionAttempts.
- Executor direct user input remains independent of Controller notification.

Acceptance:
- Controller/Executor lifecycle focused tests passed, including running Controller delivery.
- Phase 1/2/3 focused regressions passed.
- `npm run check`: PASS.

Remaining
None for Phase 4B. Stop; do not enter autonomous orchestration or policy.
