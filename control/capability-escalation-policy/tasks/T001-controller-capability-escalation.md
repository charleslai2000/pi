Status: DONE
Work area
`packages/coding-agent`

Objective
Add Controller-only capability escalation guidance using existing inspection, same-Session switching, and notice tools without runtime escalation policy.

Inputs
- `control/capability-escalation-policy/goal.md`
- Existing Controller protocol and Phase 5A/5B seams.

Completion
Protocol covers exhaustion observation, inspect-before-switch, justified settled same-Session switch, waiting-user/no-model stopping, and bounded no-loop behavior; focused tests/check pass without runtime policy.

Result
Implemented:
- Extended canonical Controller system protocol with capability escalation guidance.
- Exhaustion is explicitly described as observation, not capability failure.
- Controller must inspect Task, Executor, active model, context snapshot, and waiting-user/external-condition facts first.
- Explicit same-Session switching is permitted only when clear remaining work and concrete benefit justify it, followed by existing `notice_executor` if appropriate.
- BLOCKED waiting-user/external-condition Tasks must not be escalated automatically.
- No suitable model, no clear action, or speculative further switching means natural stop/wait; no infinite escalation loop.
- Runtime still only delivers facts and exposes atomic existing tools; no exhausted→switch branch was added.

Acceptance:
- Controller, native lifecycle, and dependency/frontier focused tests passed.
- `npm run check`: PASS.

Remaining
None for Phase 5C. Stop; do not enter review policy.
