# Goal: C4 Phase 9+ Autonomous Orchestration Qualification

## Authorized goal
Qualify the frozen C4 Session-native control plane for unattended orchestration and production robustness using the rebuilt real bundle, real provider, isolated PiRoot/session storage, and existing durable Task/Session authority.

## Scope
Phase 9 unattended Controller/Executor orchestration and Phase 10 robustness: dependency DAG/frontier, parallel Executors, lifecycle admission/memory/results, blocked/terminated continuation, conditional review/remediation, model switching, restart/crash recovery, stale/idempotent events, disappearance, transient provider failure, malformed actions, and durable recovery.

## Constraints
Preserve Task Markdown SSOT, AgentSession Executor/Controller roles, assignment cardinality, lifecycle semantics, SessionRegistry/Pool, and atomic-tool policy boundary. Do not add a scheduler, polling loop, ExecutionAttempt authority, persistent shadow state, second runtime authority, or automatic orchestration policy. Do not modify live user sessions. Stop only for a frozen-architecture decision, invariant conflict, product policy decision, or an unresolvable blocker.

## Completion
Real qualification evidence establishes unattended orchestration and robustness, with ordinary correctness bugs fixed and regressed, and no unresolved blocker requiring architectural or product judgment; then record `C4 AUTONOMOUS CONTROL PLANE = PRODUCTION QUALIFIED`.

## Result
`C4 AUTONOMOUS CONTROL PLANE = PRODUCTION QUALIFIED`
