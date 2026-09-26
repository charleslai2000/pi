# Goal: PiRoot Goal/Plan/Task Context Authority

Status: DONE

## Authorized outcome
Formalize durable control documents exclusively under `<PiRoot>/.pi/control/<goal-id>/`, provide Controller-only Goal/Plan durable-memory mutations, and compose execution contexts solely from canonical Markdown readers while preserving Task lifecycle SSOT and ordinary Session transcript storage.

## Scope
- Deterministically migrate any legacy `control/<goal-id>/` documents to `.pi/control/<goal-id>/` without dual authority.
- Add managed Goal/Plan memory mutation primitives for Controller; preserve Task-scoped Executor memory.
- Restrict raw file tools from managed Goal/Plan/Task Markdown.
- Tighten `.pi/.gitignore` to keep runtime-local DB/locks/cache out of Git while permitting authority/profile/policy files.
- Verify read model, dependency/frontier/assignment/lifecycle, prompt context, recovery, and MA1/MA2 multi-agent regressions.

## Exclusions
No Task identity/dependency/generation semantic changes, no transcript-derived authority, no shadow store, no long-term legacy reader mode, and no project Session transcript storage.

## Completion
Deterministic migration is lossless for identities/status/dependencies/memory/results; all focused and integrated regression tests plus `npm run check` pass.
