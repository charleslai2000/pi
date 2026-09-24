# Goal: C4 Phase 6 Conditional Review as Normal Tasks

## Authorized goal
Add Controller protocol guidance for conditional review using only ordinary Task, dependency, frontier, and Executor primitives.

## Scope
- Guide Controller to create review Tasks only when quality/risk benefit is explicit.
- Review Tasks include target Task/result, review objective, acceptance criteria, and evidence/risk checks.
- Review Tasks depend on the original Task and use ordinary frontier/dispatch semantics.
- Review PASS leaves the original Task unchanged; findings produce ordinary remediation Tasks without reopening the original.

## Constraints and exclusions
- No ReviewExecution, reviewer runtime, reviewer-specific tool, scheduler, new authority, ExecutionAttempt, or review loop.
- Reviewer uses only `task_gate`, `task_memory`, and `task_result`.
- Preserve Phase 1–5C semantics and existing Controller tools.
- Do not push or commit.

## Completion condition
Controller protocol and focused tests demonstrate conditional review, ordinary review frontier/dispatch, PASS immutability, findings-driven remediation, duplicate-review avoidance, and no review runtime authority. `npm run check` passes. Stop after Phase 6.
