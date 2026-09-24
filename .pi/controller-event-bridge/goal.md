# Goal: C4 Phase 4B Controller Event Bridge

## Authorized goal
Notify the canonical Controller Pi Session of factual Executor/Task state changes while preserving Phase 1–4A semantics.

## Scope
- Bridge task gate rejection, accepted Executor settle to BLOCKED, and task results to the canonical Controller Session.
- Reuse native Controller `prompt`, `steer`, and `followUp` behavior.
- Deduplicate identical facts within the runtime lifetime.

## Constraints and exclusions
- No scheduler, autonomous dispatch/redispatch, policy decisions, new authority, persisted event state, ExecutionAttempt, or runtime agent.
- Executor BLOCKED user input remains a direct same-Session recovery path.
- Controller notices are facts only; the LLM decides whether to inspect, notice, dispatch, close, or do nothing.
- Do not push or commit.

## Completion condition
Focused tests prove reject, settle/BLOCKED, complete, terminated, running/settled Controller delivery, no lifecycle mutation by notice, deduplication, and no ExecutionAttempt. `npm run check` passes. Stop after Phase 4B.
