# Goal: C5 Controlled Production Rollout

## Authorized goal
Verify the C4 production-qualified Session-native control plane in the actual Pi deployment without changing frozen architecture or lifecycle semantics.

## Scope
Current production entrypoint/bundle identity, compatibility with existing Session/Registry/Task/assignment data, isolated real production-path smoke, durable rollout observations, correctness/recovery fixes if found, and legacy ExecutionAttempt caller/history audit.

## Constraints
Do not overwrite live user sessions or manufacture Task authority. Preserve Task Markdown SSOT, AgentSession roles, assignment cardinality, SessionRegistry/Pool, and lifecycle semantics. Do not add scheduler, ExecutionAttempt runtime authority, execution abstraction, shadow state, or automatic policy. Remove legacy code only after proving historical reads and current deployment are unaffected.

## Completion
`C5 CONTROL PLANE = PRODUCTION ROLLOUT VERIFIED` only when actual deployment identity, compatibility, authorized workload/soak evidence, recovery observations, and legacy audit are recorded. Otherwise record the concrete remaining blocker without inventing production evidence.
