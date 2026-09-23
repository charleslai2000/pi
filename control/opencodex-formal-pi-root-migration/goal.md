# Goal: OpenCodeX Formal PiRoot Migration

## Authorized outcome
Migrate the real `/home/charles/Workspaces/3rdparty/opencodex` PiRoot from legacy runtime state under `control/` to the formal `.pi/` layout, then rebuild the runtime bundle and perform a bounded real continuation trial on the existing GPT-6 migration Task.

## Scope
- Safely stop the OpenCodeX project runtime, preserve complete backups of legacy runtime data and project transcripts, and move registry, assignments, and project sessions under `.pi/`.
- Keep `control/` exclusively for Goal/Plan/Task Markdown; remove runtime legacy fallback and `control/` marker semantics.
- Restart the rebuilt runtime and verify canonical Controller, T001 Executor recovery/assignment/history/generation, Task BLOCKED/memory, transcript identity, `/sessions` projection/order, internal ControlEvents, and single authority.
- Rebuild bundle and run one real Session-native continuation trial for the GPT-6 migration Task. Trial validates new stop-envelope, Controller/Executor coordination, session display, and managed mutation boundary only; do not execute formal 3456 cutover.

## Constraints
- Preserve exact Task Markdown authority, canonical Controller identity, durable assignment identity/history, and all session transcript bytes/IDs.
- Do not alter formal 3456 service/cutover.
- On any migration or validation failure, stop the runtime and roll back before further execution.
- Ordinary defects may be fixed and retried. Stop only on irrecoverable data loss, canonical identity collision, or frozen-invariant violation.

## Completion
Migration is backed up, lossless, verified in a rebuilt runtime, and the bounded GPT-6 continuation trial passes without formal 3456 cutover.
