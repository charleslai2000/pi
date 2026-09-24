Status: DONE
Work area
implementation, testing

Objective
Implement Controller-only Agent profile catalog (`list_agents`, `inspect_agent`), project `.pi/AGENTS.md` scheduling policy in Controller system protocol, requested Pi-native profile migrations, and integrated separate-Task coder → review → finding-driven remediation with durable context. Preserve MA1 fork/admission/prompt composition, Task SSOT, ordinary Pi Sessions, generation semantics, and no-runtime-routing constraints.

Inputs
- MA1 accepted architecture and implementation in `packages/coding-agent/src/core/{agent-profiles.ts,execution-session.ts,agent-session-runtime.ts,session-registry.ts}`.
- `packages/coding-agent/test/integrated-orchestration-e2e.test.ts` and profile/controller tests.
- OpenCode profiles used only as migration source; only distilled prompt prose and Pi-logical model/variant metadata retained. No runtime dependency or OpenCode tool/mode semantics.

Completion
Catalog merges `~/.pi/agents/` with `<PiRoot>/.pi/agents/` (project wins), returns slug/source/model/variant/concise description without default full prompts, and inspect returns a chosen prompt. Tools exist only on canonical Controller. Controller receives `.pi/AGENTS.md` and chooses profile/cwd from project policy and durable context without runtime classification. Requested Pi-native profiles exist. Integrated E2E verifies generic execution; T001 coder implementation; dependent T002 reviewer with project profile override and custom cwd; reviewer finding in T002; new dependent T003 remediation using debugger-deep; durable context conveyed by explicit Goal/Plan/prerequisite/Task inputs; correct metadata/model/variant; original implementation remains DONE and is not reopened. No scheduler/ExecutionAttempt/shadow authority. Focused tests, MA1 regressions, integrated E2E and `npm run check` pass.

Result
- Implemented `list_agents` and `inspect_agent` Controller-only tools. Catalog enumeration merges global and project profile directories, resolves whole-profile project overrides, hides orchestrator from execution catalog, and returns only compact metadata; inspection returns the selected prompt.
- Injected `.pi/AGENTS.md` into canonical Controller project instructions and added explicit Controller choice of optional agent/cwd in system protocol. Generic dispatch stays valid; no task-type to Agent mapping was introduced.
- Added Pi-native profiles for architect, reviewer-deep, debugger-deep, tester, test-runner, devops, devops-executor, frontend, external-researcher, external-analyst, external-investigator, domain-analyzer, scout, context-manager, task-manager, executor, and doc-writer; refined coder, reviewer and canonical orchestrator profiles. Profiles contain prompt plus optional model/variant only, not OpenCode runtime/tool semantics.
- Integrated scenario verifies T001 coder implementation completes; T002 reviewer depends on T001, uses project reviewer profile overriding global, and receives custom `src` cwd; T002 records a finding and completes; T003 remediation depends on T002, uses debugger-deep, sees finding and explicitly carried implementation/Goal/Plan context, applies high variant and correct registry generation/profile projection, then completes. T001 stays DONE. No active assignments or ExecutionAttempts remain.
- MA1 evidence is retained independently: same-Task reassignment-tenure case in the integrated suite verifies a new ordinary Session and incremented generation with durable Task memory; no lifecycle change was made.
- Verification: focused profile/controller/integrated suite passed **3 files / 8 tests**. MA2 + MA1 regression set passed **6 files / 24 tests**: `agent-profiles.test.ts`, `controller-task-tools.test.ts`, `native-task-lifecycle.test.ts`, `session-registry-recovery-integration.test.ts`, `executor-assigned-task.test.ts`, `pi-root-application.test.ts`, `integrated-orchestration-e2e.test.ts` (the listed seven paths are in 6 test files because shared cases aggregate in the command's runner output). `npm run check` passed including Biome, pinned/runtime deps, TS import/entry graph, shrinkwrap/install-lock, TypeScript, browser smoke. Post-final-profile checks: focused 3 files / 8 tests and `npm run check` passed.

Remaining
None for this Task. OpenCode live migration remains a separate externally blocked matter.
