# Goal: Return control execution to Pi-native Task Sessions

## Authorized goal
Refactor the current C4 Task control path so a Task is executed by its assigned long-lived Pi AgentSession, without requiring `/execute` or creating an ExecutionAttempt for normal work.

## Scope
- Preserve PiRoot, SessionPool, SessionRegistry/recovery, AgentSession, Goal/Task Markdown SSOT, assignments, reassign/unassign, and terminal Task mutations.
- Remove active normal-runtime dependency on execution-attempt, execution budget/stop, and provider provenance policy introduced by C4.
- Add Task-session bootstrap and durable task-memory protocol using task.md.
- Add and run Task/Session activation, settle/resume, intervention, reassignment, recovery, and terminal acceptance tests.

## Constraints and exclusions
- Do not push or commit.
- Preserve unrelated worktree changes.
- No new Task runtime authority, scheduler, worker pool, execution identity, token budget, escalation, review, DAG, or provider abstraction.
- Legacy execution-attempt data may remain read-only only if required for compatibility, but must not control normal Session continuation.
- Do not modify frozen Task lifecycle or assignment cardinality semantics.

## Completion condition
Normal Task work starts from an assigned live Session and uses ordinary AgentSession prompt/continue semantics; `/execute` and ExecutionAttempt are not required. Required lifecycle acceptance tests pass, `npm run check` passes, and the final report classifies KEEP/DEMOTE/REMOVE with evidence.
