# Goal: C4 Phase 5B Same-Session Model Switching

## Authorized goal
Add explicit Controller-only same-Session Executor model switching using the native AgentSession model seam.

## Scope
- Add `switch_executor_model(executor_id, model, effort?)` to the canonical Controller.
- Resolve models through the target Executor's existing ModelRuntime.
- Preserve Session, Task, assignment, history, tools, and protocol identity.
- Refresh context snapshot from the new active model immediately.

## Constraints and exclusions
- No automatic escalation policy, scheduler, redispatch, termination, ExecutionAttempt, shadow state, provider Usage changes, or new persistence authority.
- Running Executor switching fails closed when `isStreaming` is true.
- Use native `AgentSession.setModel()` and `setThinkingLevel()` only.
- Do not push or commit.

## Completion condition
Focused acceptance proves settled same-Session switching, identity/history/assignment preservation, context limit refresh, continuation, invalid-model and running-state fail-closed behavior, and no ExecutionAttempt/redispatch. `npm run check` passes. Stop after Phase 5B.
