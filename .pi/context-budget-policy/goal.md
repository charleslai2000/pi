# Goal: C4 Phase 5A Context Budget Policy

## Authorized goal
Freeze and implement the smallest Session-native context budget policy for Executor observation and Controller notice, without model escalation.

## Scope
- Derive budget state from `AgentSession.getContextUsage()` and native compaction state.
- Add exhaustion observation and factual Controller notice.
- Preserve native compaction and all Phase 1–4C Task/Session semantics.

## Constraints and exclusions
- No accumulated output-token budget, provider usage logic, ExecutionAttempt, new persistence authority, Executor tool, automatic termination, redispatch, model escalation, scheduler, or policy enforcement loop.
- `exhausted` is observation only and is not Task failure, BLOCKED, or terminated.
- No exhaustion notice while usage is unknown or compaction is active.
- Do not push or commit.

## Completion condition
Design semantics are recorded, focused tests prove state derivation and one factual exhaustion notice without lifecycle mutation, `npm run check` passes, and the final report gives the state machine. Stop after Phase 5A.
