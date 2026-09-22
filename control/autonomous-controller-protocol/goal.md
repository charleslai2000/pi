# Goal: C4 Phase 4C Autonomous Controller Protocol

## Authorized goal
Complete the canonical Controller Session system protocol so factual Task notices are interpreted by the Controller policy model using existing tools, without adding scheduler behavior or orchestration state.

## Scope
- Install a Controller system protocol alongside existing Controller tools.
- Describe factual notices, decision boundaries, existing tools, frontier/Executor handling, and natural settle behavior.
- Remove Controller self-notice after Controller-issued `close_task` mutations.
- Preserve Executor-originated DONE/DEFERRED/BLOCKED/reject notices.

## Constraints and exclusions
- No new tools, scheduler, polling loop, hardcoded dispatch policy, orchestration authority, context-budget enforcement, model escalation, or review.
- Controller remains a policy LLM; runtime only delivers facts and executes atomic existing tools.
- Do not push or commit.

## Completion condition
Focused tests prove protocol installation, Executor completion/termination/rejection notices, frontier follow-up capability, no mechanical BLOCKED continue loop, multiple explicit dispatches without scheduler state, no close self-notice, no ExecutionAttempt, and `npm run check` passes. Stop after Phase 4C.
