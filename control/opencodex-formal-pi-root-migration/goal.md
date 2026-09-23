# Goal: OpenCodeX Formal PiRoot Migration

## Authorized outcome
Migrate the real `/home/charles/Workspaces/3rdparty/opencodex` PiRoot from legacy runtime state under `control/` to the formal `.pi/` layout, then rebuild the runtime bundle and perform a bounded real continuation trial on the existing GPT-6 migration Task.

## Scope
- Safely stop the OpenCodeX project runtime, preserve complete backups of legacy runtime data and project transcripts, and move registry, assignments, and project sessions under `.pi/`.
- Keep `control/` exclusively for Goal/Plan/Task Markdown; remove runtime legacy fallback and `control/` marker semantics.
- Verify canonical Controller, T001 Executor recovery/assignment/history/generation, Task BLOCKED/memory, transcript identity, `/sessions` projection/order, internal ControlEvents, and single authority through the existing single OpenCodeX service on port 3456 when that verification is authorized. Do not create another instance or listener.
- Rebuild bundle and run one real Session-native continuation trial for the GPT-6 migration Task. Trial validates new stop-envelope, Controller/Executor coordination, session display, and managed mutation boundary only; do not execute formal 3456 cutover.

## Constraints
- Preserve exact Task Markdown authority, canonical Controller identity, durable assignment identity/history, and all session transcript bytes/IDs.
- OpenCodeX topology is one service/PID/listen port at 3456; Pi/Control Plane uses the existing service and needs no separate listener. Do not use 3457, `opencodex-v11.service`, or a second OpenCodeX instance.
- On any migration or validation failure, stop the runtime and roll back before further execution.
- Ordinary defects may be fixed and retried. Stop only on irrecoverable data loss, canonical identity collision, or frozen-invariant violation.

## Completion
Pi formal runtime implementation/recovery is verified offline, backed migration state is preserved, and the Pi bundle/regressions pass. OpenCodeX live startup verification and the continuation trial are a separate external follow-up; they are not required for Pi Control Plane implementation closure.
