# Goal: C4 Phase 4A Native Context Budget Foundation

## Authorized goal
Expose read-only Executor context snapshots using Pi-native context usage, model context window, and compaction state without adding budget authority or automatic policy.

## Scope
- Audit and reuse `AgentSession.getContextUsage()` and `AgentSession.isCompacting`.
- Define a runtime-bound Executor context snapshot with current usage, effective limit, headroom, and compaction state.
- Return the snapshot from Controller `inspect_task`.
- Verify running/settled/recovered/compaction semantics through focused tests.

## Constraints and exclusions
- No Task/Executor budget persistence or policy authority is introduced.
- No output-token accumulation, provider billing usage, ExecutionAttempt, automatic compaction, model switching, termination, redispatch, scheduler, or escalation.
- Preserve Phase 1–3 semantics and do not modify the Usage contract.
- Do not push or commit.

## Completion condition
Native snapshot tests and inspect observation pass, `npm run check` passes, and the final report documents the seam and recommends directly reusing the active Pi model context limit until a future policy phase is explicitly authorized.
