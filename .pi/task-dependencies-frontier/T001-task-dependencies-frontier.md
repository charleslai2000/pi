Status: DONE
Work area
`packages/coding-agent`

Objective
Implement C4 Phase 3 Task prerequisites and a derived Controller frontier without introducing runtime graph/frontier authority.

Inputs
- `control/task-dependencies-frontier/goal.md`
- Frozen Phase 1/2 architecture and runtime.

Completion
Prerequisites persist in task.md, dependency mutations validate existence/self/cycles/terminal/tenure, inspect_frontier derives eligibility, dispatch rejects unsatisfied dependencies, focused DAG/frontier tests and `npm run check` pass.

Result
Implemented:
- Added `Prerequisites:` to Task Markdown parsing and `TaskRecord`.
- Added atomic `setTaskDependencies()` with full `(goalId, taskId)` identity validation.
- Rejects missing prerequisites, self dependencies, duplicate prerequisites, direct/indirect cycles, terminal Tasks, and ACTIVE/BLOCKED Tasks with current Executor tenure.
- Added derived `listDerivedFrontier()` and Controller `inspect_frontier`; no frontier state is persisted.
- Added Controller `set_task_dependencies`.
- Added dependency satisfaction gate to `dispatch_task`; unsatisfied Tasks fail before Executor creation or assignment.
- CANCELLED prerequisites remain unsatisfied; only DONE satisfies a prerequisite.
- No scheduler state, frontier.md, graph authority, or ExecutionAttempt is created.

Acceptance:
- `packages/coding-agent/test/task-dependencies-frontier.test.ts`: 3 passed.
- Controller acceptance including dependency gate: passed.
- Phase 1/2 lifecycle focused regressions: passed.
- `npm run check`: PASS.

Remaining
None for Phase 3. Stop; do not enter autonomous scheduler, context budget, capability escalation, or review.
