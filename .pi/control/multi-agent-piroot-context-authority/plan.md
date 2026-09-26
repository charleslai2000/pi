# Current control state

## Established results
- Checkpoint `e0e9098ee` records MA1/MA2. MA3-only paths have been staged and verified; next commit and push the checkpoint to `origin/main`.
- Historical migration moved Goal/Plan/Task authority from legacy `control/<goal>/tasks/TNNN-*.md` into `.pi/control/<goal>/`. This repository-local migration now records the current canonical path; the historical result is retained as recorded evidence.
- Canonical read model resolves `.pi/control/<goal-id>` only. Execution context is Goal → Plan → declared prerequisites → full current Task; tests assert ordering and unrelated sibling exclusion.
- Controller-only `update_goal_memory` and `update_plan_memory` tools call managed Markdown primitives. Executor admission exposes Task lifecycle/memory only; tests assert Goal/Plan mutation tools are absent from executor tools.
- Raw write/edit reject paths under managed Goal directories. `.pi/.gitignore` excludes local state/git/npm/session, DB, locks, temp, and cache files while authority/policy/profile Markdown remains trackable.
- Session transcripts remain in the user-level default `~/.pi/agent/sessions/<PiRoot-key>` namespace; project `.pi/sessions` is ignored.
- Final verification passed: **13 test files / 56 tests** across MA3 and MA1/MA2; `npm run check` passed (Biome, TypeScript, dependency graphs/locks, browser smoke).

## Frontier
Goal complete. The one-time migration helper is not imported or invoked by runtime; no legacy reader or long-term migration mode remains.
