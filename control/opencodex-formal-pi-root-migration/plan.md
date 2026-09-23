# Current control state

## Established results
- Pi runtime implementation, formal registry migration/recovery, role/tool separation, `/sessions` projection, lifecycle/CAS, ControlEvents, managed-path guards, and Goal tools pass `npm run check` and the final 16-suite Pi regression set (97 tests). Coding-agent bundle rebuild completed (56 files, 8.2 MiB).
- Offline recovery probe on the migrated OpenCodeX fixture passed without model requests or listeners: canonical Controller `01a0c135-2af7-764b-90d0-8f692e3a47b5`; foreground was the same Session in this startup (foreground may independently be an Executor); T001 Executor `01a0caf4-b39f-750e-a041-5336c9534cae`; exactly one logical Controller; Controller and Executor tools are separated; `/sessions` lists Controller before selected Executor; T001 remains BLOCKED with unchanged memory, generation 1, one assigned history event; both transcript hashes unchanged.
- A requested service start failed before binding 3457 because OpenCodeX reported `routing profile lead does not match compiled openai preset`. Wrapper was stopped immediately. This is an external OpenCodeX config condition; no OpenCodeX config/source/service was modified. Ports 3456 and 10100 were untouched. Real startup and GPT-6 continuation trial remain unverified and are excluded from this Pi-only closure scope.
- `RUNTIME SEMANTICS CLOSURE = PASS` is recorded in `task-session-native/plan.md` and T001.
- Legacy runtime objects are `control/state/control.sqlite3` (schema 4, WAL mode expected) and `control/assignments.json` (T001 assignment to Session `01a0caf4-b39f-750e-a041-5336c9534cae`; no generation field in legacy record).
- Initial search in the wrong `~/.pi/sessions` path did not find sessions; the actual global namespace is `~/.pi/agent/sessions`. Legacy registry contains four rows, all inactive, and canonical Controller `01a0c135-2af7-764b-90d0-8f692e3a47b5`; assigned Executor `01a0caf4-b39f-750e-a041-5336c9534cae`. Both transcripts and the other two registry Session files exist and their identities match. Executor transcript is 658,699 bytes; Controller transcript is 16,584,344 bytes. Initial SHA-256s recorded in T001. No missing transcript/canonical conflict found.
- Pi code still defines `.pi/` and `control/` jointly as root markers and contains legacy session discovery fallback; removal is required for the authorized migration.
- Running services include the OpenCodeX PiRoot runtime on port 3457 via `opencodex-v11.service`; ports 3456 and 10100 are separate GPT-6 runtimes and must remain untouched.

## Decisive frontier
Pi implementation and offline migration recovery are verified. OpenCodeX live startup remains blocked by a compiled-preset mismatch: its owner must provide a routing configuration whose `lead` profile exactly matches the compiled `openai` preset (acceptance: service starts and binds only 3457, then real recovery/UI authority checks pass). This does not block Pi implementation closure. Do not modify OpenCodeX routing/provider/GPT-6/source/artifact/candidate/cutover or ports 3456/10100. The bounded GPT-6 continuation trial is not run because existing Task authority conflicts with a real trial and is outside the Pi-only scope.

## Active tasks
- OpenCodeX-owned routing preset reconciliation and authorized bounded GPT-6 continuation scope are external follow-ups; no Pi implementation dependency remains.

## Rollback
A timestamped backup outside the project will contain the complete legacy `control/state`, `control/assignments.json`, and all source transcript files before mutation. Any failure after stop requires stopping the rebuilt runtime, restoring the exact legacy paths, removing only the newly migrated runtime files, and verifying legacy byte hashes before any restart.
