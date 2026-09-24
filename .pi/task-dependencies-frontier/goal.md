# Goal: C4 Phase 3 Task Dependencies and Derived Frontier

## Authorized goal
Add Task-scoped prerequisite persistence and Controller-only derived frontier inspection while preserving Phase 1 and Phase 2 semantics.

## Scope
- Add `Prerequisites:` to Task Markdown/TaskRecord.
- Add `set_task_dependencies` with identity validation, atomic replacement, cycle rejection, terminal/tenure guards.
- Add derived `inspect_frontier` and dependency gating to existing `dispatch_task`.
- Keep frontier computation read-only and derived; do not create or use frontier runtime state.

## Constraints and exclusions
- No `frontier.md` authority, scheduler, dependencies runtime authority, autonomous orchestration, context budget, capability escalation, review, or new execution identity.
- No changes to Executor tools or Phase 1/2 lifecycle semantics.
- Do not push or commit; preserve unrelated worktree changes.

## Completion condition
Focused DAG/frontier acceptance passes for persistence, validation, cycles, tenure guards, derived eligibility, restart-equivalent recomputation, dispatch gating, and no scheduler/frontier runtime state. `npm run check` passes. Stop after Phase 3.
