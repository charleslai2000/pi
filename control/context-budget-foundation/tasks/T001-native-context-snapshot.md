Status: DONE
Work area
`packages/coding-agent`

Objective
Expose and verify a read-only Executor context snapshot from Pi-native AgentSession context/compaction seams.

Inputs
- `control/context-budget-foundation/goal.md`
- `AgentSession.getContextUsage()`
- `AgentSession.isCompacting`

Completion
Snapshot includes current context usage, effective context limit, remaining/headroom, and compaction state; inspect_task returns it; no new persistence or policy authority is introduced; focused tests and `npm run check` pass.

Result
- Audited Pi native context seam: `AgentSession.getContextUsage()` reads the active model `contextWindow` and estimates current `this.messages` context. It deliberately returns `tokens: null` / `percent: null` after compaction until a valid post-compaction assistant usage is available. `AgentSession.isCompacting` reports active compaction.
- Added `ExecutorContextSnapshot` with current usage, effective context limit, remaining headroom, percent, and compaction active/usage-known state.
- Added `AgentSessionRuntime.getExecutorContextSnapshot(sessionId)`.
- Extended Controller `inspect_task` observation with the snapshot; no snapshot is persisted.
- No provider Usage contract changes, output budget, ExecutionAttempt, automatic compaction, model switching, termination, or redispatch were added.

Acceptance:
- Context snapshot and Controller inspection focused tests passed.
- Existing AgentSession stats regression passed.
- `npm run check`: PASS.

Policy conclusion
Context budget must not be persisted at this foundation layer. The effective limit should directly reuse the active Pi model's `contextWindow`, and current usage should remain Pi's native estimate. A future policy phase may define a Task policy or Executor Session policy only if an explicit authority and lifecycle are approved; no new authority is justified for Phase 4A.

Remaining
None for Phase 4A. Stop; do not enter scheduler, escalation, automatic compaction, model switching, termination, or redispatch.
