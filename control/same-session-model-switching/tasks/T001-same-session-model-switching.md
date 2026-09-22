Status: DONE
Work area
`packages/coding-agent`

Objective
Implement explicit same-Session Executor model switching through the native AgentSession seam.

Inputs
- `control/same-session-model-switching/goal.md`
- AgentSession.setModel(), setThinkingLevel(), ModelRuntime.getModel().

Completion
Controller tool switches settled Executor model/effort, preserves identity/history/assignment/tools, refreshes context snapshot, fails closed for invalid/running targets, and focused tests/check pass without redispatch or ExecutionAttempt.

Result
Implemented:
- Added Controller-only `switch_executor_model(executor_id, model, effort?)`.
- Audited and reused native `AgentSession.setModel(model, { persist: false })`; model changes remain in the same Session transcript/history and do not create a new Session.
- Resolves the target model through the Executor slot's existing ModelRuntime and fails closed for invalid identifiers/unavailable models.
- Fails closed while Executor `isStreaming`; no custom interruption or restart mechanism.
- Optional effort uses native `setThinkingLevel(..., { persist: false })`.
- Assignment, Task, Session identity, conversation, Executor protocol/tools, and lifecycle state remain unchanged.
- Context snapshot immediately derives from the new active model's contextWindow.
- Controller protocol documents explicit model switching without automatic escalation.
- No redispatch, ExecutionAttempt, shadow state, or automatic escalation policy.

Acceptance:
- Controller model-switch focused acceptance passed.
- Native AgentSession model extension regressions passed.
- Native Task lifecycle regression passed.
- `npm run check`: PASS.

Seam conclusion
Pi's native seam is `AgentSession.setModel()`, which validates auth, updates the active model, appends a model-change history entry, and preserves the existing Session. Running switches are rejected by the Phase 5B runtime boundary because Pi does not provide a safe immediate switch contract for an active turn. Settled switching is supported.

Remaining
None for Phase 5B. Stop; do not implement automatic capability escalation.
