# Goal: C4 Phase 5C Controller Capability Escalation Policy

## Authorized goal
Extend only the canonical Controller system protocol so the policy LLM can decide whether to use same-Session model switching after inspecting context exhaustion facts.

## Scope
- Document exhausted context as observation, not capability failure.
- Guide Controller to inspect Task, Executor, model, context, and BLOCKED reason before any explicit switch.
- Permit justified settled same-Session `switch_executor_model` followed by `notice_executor`.
- Bound escalation: no loops, no automatic switch, no escalation when waiting for user/external input, and settle when no justified model/action exists.

## Constraints and exclusions
- No runtime scheduler, automatic exhausted-to-switch branch, new tools, new state authority, redispatch, termination, ExecutionAttempt, or review policy.
- Preserve Phase 1–5B semantics.
- Do not push or commit.

## Completion condition
Protocol and focused tests document that exhaustion alone does not switch models, explicit same-Session escalation preserves identity, waiting-user and no-model cases stop naturally, and `npm run check` passes. Stop after Phase 5C.
