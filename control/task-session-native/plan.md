# Current control state

## Established results
- Accepted architecture is frozen in `design/architecture/task-session-native.md`.
- Task.md is lifecycle SSOT and durable Task memory; an assigned long-lived Pi AgentSession is the Executor.
- Added `startAssignedTask()` native bootstrap, removed `/execute` from the interactive normal surface, and added the system-prompt Task protocol seam.
- Added controlled `Memory:` mutation and the `task_memory` tool name.
- Added initial `task_gate` and `task_result` tool skeletons; lifecycle behavior is not yet acceptance-complete.
- `executeAssignedTask()` and C4 execution runtime remain active and must be removed or demoted.

## Decisive frontier
Phase 1 native lifecycle closure is complete. No active implementation frontier remains under this Goal.

## Active tasks
None.

## Result
T001 is DONE. Native Executor admission, ACTIVE/BLOCKED settle/resume, Task memory/result tools, legacy execution runtime removal, and focused acceptance are complete. `execution-attempts.ts` is LEGACY-ONLY and not a runtime authority.

## Next action
Stop. Any Controller tools, DAG/frontier, context budget, escalation, review, or scheduler work requires a separately authorized phase/Goal.
