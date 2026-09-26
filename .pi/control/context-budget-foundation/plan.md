# Current control state

## Established results
- Phase 1–3 are frozen and complete.
- Pi-native `AgentSession.getContextUsage()` returns estimated current context tokens, model context window, and percent; after compaction without post-compaction valid assistant usage, tokens/percent are null.
- `AgentSession.isCompacting` exposes active compaction state.

## Decisive frontier
Phase 4A native context snapshot closure is complete.

## Active tasks
None.

## Result
T001 is DONE. Executor observation now reuses `AgentSession.getContextUsage()` and `isCompacting`; `inspect_task` exposes a non-persistent snapshot, and no budget authority or automatic policy was added.

## Next action
Stop. Any budget policy, scheduler, escalation, automatic compaction, model switching, termination, or redispatch requires a separately authorized phase/Goal.
