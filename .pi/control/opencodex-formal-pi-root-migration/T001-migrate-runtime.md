Status: BLOCKED
Work area
operations, implementation, testing

Objective
Migrate the real OpenCodeX PiRoot to `.pi/` runtime layout without loss, rebuild runtime, and execute a bounded continuation trial on the existing GPT-6 migration Task.

Inputs
- `control/opencodex-formal-pi-root-migration/goal.md`
- `control/opencodex-formal-pi-root-migration/plan.md`
- `control/gpt6-upstream-migration/tasks/T001-gpt6-source-artifact-shadow.md`
- `design/architecture/task-session-native.md`
- PiRoot `/home/charles/Workspaces/3rdparty/opencodex`

Completion
Legacy runtime safely stopped and WAL/SHM converged; verified backups exist; registry, assignments, and all project sessions are migrated without byte/identity loss; `control/` contains only Goal/Plan/Task Markdown and no longer marks a PiRoot; runtime fallback is removed; rebuilt runtime passes recovery/UI/authority checks; GPT-6 Task continuation trial passes without formal 3456 cutover.

Result
Recorded `RUNTIME SEMANTICS CLOSURE = PASS` before migration.

Pi implementation/recovery closure evidence: `npm run check` passed; final 16 relevant suites passed (97 tests), covering integrated E2E, registry migration/rollback/recovery, lifecycle/generation/CAS, associations, managed control views, PiRoot and `/sessions`. Coding-agent bundle rebuilt successfully (56 files, 8.2 MiB). Offline recovery probe against the migrated OpenCodeX fixture passed without model requests or listeners: canonical Controller `01a0c135-2af7-764b-90d0-8f692e3a47b5`; T001 Executor `01a0caf4-b39f-750e-a041-5336c9534cae`; logical Controller count 1; Controller tools and Executor `task_gate`/`task_memory` are distinct; selector ordered Controller first and selected the Executor row; T001 stayed BLOCKED and its memory, assignment generation (1), assigned history count (1), and transcript bytes/hashes were unchanged. Probe source was `/tmp/opencodex-formal-recovery-probe.ts` and is not a repository artifact.

Final user decision supersedes the earlier 3457 startup attempt: OpenCodeX uses one existing service/PID/listener on 3456; Pi/Control Plane uses that service, with no separate network listener, no 3457 and no second OpenCodeX instance. The prior attempted `opencodex-v11.service` startup failed before binding due to `routing profile lead does not match compiled openai preset`; it was stopped immediately and is now inactive. Do not retry or request a routing change for a second instance. No OpenCodeX routing/provider/GPT-6/source/artifact/candidate/cutover configuration was edited. Live migration verification is `BLOCKED BY EXTERNAL DEPENDENCY`: OpenCodeX owner must expose/authorize verification of the migrated PiRoot through the existing 3456 service. Pi runtime implementation and offline recovery are PASS.

Located durable session files under `~/.pi/agent/sessions/--home-charles-Workspaces-3rdparty-opencodex--/`:
- Canonical Controller `01a0c135-2af7-764b-90d0-8f692e3a47b5`, 16,584,344 bytes, SHA-256 `9f1dc0de4aac6731e07a4796f78f19eadb34509fa0dad7f80e7baa51961dd3e3`.
- Assigned T001 Executor `01a0caf4-b39f-750e-a041-5336c9534cae`, 658,699 bytes, SHA-256 `9bfa53a72d5a8bf9d035121b3d1a3ec98e5efa3aff7d4bff8c47c31f6cae49bb`.
- Legacy Registry contains two additional inactive Session records, each with an existing transcript; no missing transcript/canonical identity collision was found.

Do not start the requested migration/trial yet. The continuation target has a material authorization conflict: existing GPT-6 T001 Goal/Completion requires a reproducible immutable artifact, guard/provenance, isolated shadow and qualification before cutover. Its Task history explicitly prohibits a real GPT-6 routing trial because the candidate/qualification gate is incomplete and the trusted source says expert medium/high must remain GPT-5.6 Terra; current Task changes conflict with that accepted policy. Additionally the installed GPT-6 bundle is separate from the dirty OpenCodeX worktree. A real LLM continuation could alter managed source/config or T001 lifecycle state. Migration can preserve the legacy current assignment and generation can be derived as 1, but proceeding to dispatch the conflicting GPT-6 task requires the OpenCodeX Goal owner to reconcile Task authority first. Do not touch runtime, project files, or ports 3456/10100 until that decision is reflected in the existing Goal/Plan/Task authority.

No runtime has been stopped and no project files have been mutated.

Remaining
OpenCodeX owner must make the migrated PiRoot verifiable through the existing single 3456 service and authorize bounded recovery checks there. Acceptance: canonical Controller, T001 Executor, registry/assignment authority, and `/sessions` projection pass without a second service, PID, instance, or listener. No Pi-specific port is required. Any GPT-6 continuation remains separately out of scope until existing Goal/Task authority permits a safe trial.
