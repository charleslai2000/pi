# Goal: C4 Phase 2 Controller Task/Executor Tools

## Authorized goal
Add the canonical Controller Session tool set for Task definition, inspection, dispatch, Executor notice, and explicit terminal closure while preserving all Phase 1 Session-native semantics.

## Scope
- Add `create_task`, `revise_task`, `inspect_task`, `dispatch_task`, `notice_executor`, and `close_task` to the canonical Controller Session.
- Create or reuse Executor Pi Sessions through existing SessionPool/SessionRegistry/AgentSessionRuntime mechanisms.
- Keep Executor tools limited to `task_gate`, `task_memory`, and `task_result`.
- Preserve Task Markdown and assignments as existing authorities.

## Constraints and exclusions
- No `reassign_task`, generic control tool, interrupt tool, execution identity, ExecutionAttempt, scheduler, dependencies/DAG, frontier, context budget, autonomous orchestration, escalation, review, or provider abstraction.
- `notice_executor` uses native Session prompt messaging and never directly changes Task lifecycle.
- `dispatch_task` fails closed for existing assignment/tenure.
- Do not push or commit; preserve unrelated worktree changes.

## Completion condition
Focused acceptance proves complete Controller/Executor tool separation, create/inspect/revise, dispatch/admission, notice on settled/running Sessions, termination and redispatch, explicit close, and no ExecutionAttempt writes. `npm run check` and focused tests pass. Stop after Phase 2.
