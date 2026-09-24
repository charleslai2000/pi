# Current control state

## Established results
- MA1 fork/admission/prompt composition passed and remains unchanged.
- Controller-only `list_agents` and `inspect_agent` use project-over-global resolution. Catalog output includes slug, source, model/variant, concise description; inspection returns the selected prompt. `orchestrator` is excluded and rejected as an execution profile.
- Controller scheduling protocol directs the canonical Controller to choose optional agent/cwd using Goal/Plan/Task and `.pi/AGENTS.md`, with generic execution allowed; runtime has no task-type mapping.
- Added Pi-native project prompt profiles for the requested specialist set without OpenCode runtime modes or permissions. Existing coder/reviewer project profiles were retained.
- Focused verification passed: 3 files, 8 tests (profile resolution/catalog, controller tools, and existing integrated tenure E2E).

## Established results
- Controller-only merged catalog/inspect tools and project `.pi/AGENTS.md` policy are implemented. Controller selects optional agent/cwd; runtime has no task-type mapping.
- All requested Pi-native prompt profiles are present; project coder/reviewer profiles override global profiles as a whole. `orchestrator` is reserved.
- The accepted integrated scenario uses separate Tasks: coder implementation T001 → reviewer T002 (prerequisite T001; finding durable in T002) → debugger-deep remediation T003 (prerequisite T002). Context reaches successors through Goal/Plan/prerequisite/explicit Task inputs, and T001 remains DONE.
- Existing MA1 same-Task reassignment/multi-tenure evidence remains independently covered; no lifecycle/admission changes were made.
- Verification passed: focused catalog/controller/integrated tests **3 files / 8 tests**; MA2 plus MA1 regressions **6 files / 24 tests**; `npm run check` passed. After final profile refinement, focused **3 files / 8 tests** and `npm run check` passed again.
- No scheduler, ExecutionAttempt or shadow authority added.

## Frontier
Goal complete. No remaining MA2 implementation or verification work.
