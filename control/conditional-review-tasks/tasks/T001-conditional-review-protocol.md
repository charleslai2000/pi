Status: DONE
Work area
`packages/coding-agent`

Objective
Add conditional review guidance using ordinary Tasks, dependencies, frontier, and Executor protocol only.

Inputs
- `control/conditional-review-tasks/goal.md`
- Frozen Phase 1–5C Controller protocol and tools.

Completion
Protocol covers conditional review creation, ordinary review dispatch, PASS immutability, findings/remediation, duplicate avoidance, and no review runtime authority; focused tests/check pass.

Result
Implemented:
- Extended canonical Controller protocol with conditional review guidance.
- Review is not default and is justified only by concrete quality/risk benefit.
- Review Task must include target identity/result, objective, acceptance criteria, and evidence/risk checks.
- Review Task uses ordinary `create_task`, `set_task_dependencies`, `inspect_frontier`, and `dispatch_task`.
- Reviewer remains a normal Executor with only task_gate/task_memory/task_result.
- Review PASS completes only the review Task and does not modify/reopen the original.
- Findings remain in the review Task; remediation is a new ordinary Task with explicit DAG prerequisites.
- Duplicate reviews and review/remediation loops require concrete new facts.
- No ReviewExecution, reviewer runtime, scheduler, ExecutionAttempt, or new authority.

Acceptance:
- Controller review-as-normal-Task focused flow passed.
- Dependency/frontier and native lifecycle regressions passed.
- `npm run check`: PASS.

Remaining
None for Phase 6. Stop.
