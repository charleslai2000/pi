# ADR-0002: Pi-native Control authority and Session execution

Status: Accepted

## Context

The Control Plane requires durable Goal/Plan/Task authority and optional specialist profiles while keeping ordinary Pi Sessions as execution tenures. The prior `control/` subdirectory coupled authority discovery to legacy placement, while the accepted PiRoot model identifies `.pi/` as Pi-owned root. This decision freezes authority layout and Phase 1 session scheduling boundaries.

## Decision

1. `<PiRoot>/.pi/` is the sole project authority root. It contains PiRoot `AGENTS.md`, optional `agents/<slug>.md`, and one `<goal-id>/` directory per Goal, with `goal.md`, `plan.md`, and `Tnnn-<slug>.md` Task files directly in that directory. No `control/` directory is part of the formal layout.
2. Goal/Plan/Task Markdown is durable SSOT and is intended for repository version control. `.pi/control.sqlite3` and SQLite runtime sidecars are machine-local runtime state and MUST be ignored. Other `.pi/` authority documents remain version-control eligible. Initialization creates runtime structure only and never creates or overwrites authority documents.
3. Goal memory is durable cross-Task background, decisions, constraints and outcomes. Plan memory is current strategy, Task graph, phase decisions and cross-Task coordination. Task Markdown owns specific Task lifecycle, evidence, results and completion/remaining memory. Execution transcript is not a Task context authority.
4. Agent profiles are optional. Each profile has `agentSlug`, prompt body, optional logical `model`, and optional provider-supported `variant`. Global path is `~/.pi/agents/<slug>.md`; project path is `<PiRoot>/.pi/agents/<slug>.md`. A same-slug project profile replaces the global profile wholesale. OpenCode files are migration input only and are never runtime dependencies. `orchestrator` is the canonical Controller profile and cannot be selected as an ordinary Executor profile.
5. Execution prompt composition order is: Pi base/root prompt; cwd-derived AGENTS instructions root-to-leaf; selected optional profile prompt; bounded Goal, current Plan/dependency, and complete selected Task context from `.pi/`. Exclude unrelated Tasks and full Goal history. Controller prompt is Pi base + PiRoot AGENTS + `.pi/AGENTS.md` + orchestrator profile.
6. Controller chooses optional agent and cwd. `dispatch_task(task, agent?, cwd?)` forks an ordinary Pi Session from Controller/session history, with omitted cwd defaulting to PiRoot and omitted agent meaning generic `execution`. Cwd must remain within PiRoot. Missing profiles/models/invalid variants fail closed. The fresh Session receives current Markdown context, is assigned through current assignment history, and uses existing Task lifecycle and admission tools.
7. Assignment generation remains the monotonically increasing Task Session tenure. Sequential coder/reviewer/tester tenures may share Task identity and memory while using fresh Session ids. Session Registry and `/sessions` are projections of current session/assignment facts (profile, Task id/generation, cwd), not new authority.
8. Executors may update only the assigned Task through existing durable Task-memory and lifecycle mutation primitives. Goal/Plan edits remain Controller-coordinated to avoid concurrent writers. Goal/Plan mutation primitives are a separate design/implementation scope, not ordinary Executor authority.
9. Do not add ExecutionAttempt, subagent runtime, scheduler policy/authority, automatic Task-type-to-agent routing, transcript-derived Task truth, or parallel Executor writes to Goal/Plan.

## Consequences

- Existing Task authority under `control/` requires an explicit migration; it is not discovered as a fallback.
- Project profiles may override global defaults without importing OpenCode permissions, runtime behavior, or model namespace.
- Every dispatch creates a normal Pi Session tenure. Task Markdown remains authoritative across tenure replacement and recovery.
- Runtime/UI may derive display metadata but cannot author Task lifecycle or assignment truth outside existing Control Plane primitives.

## Source evidence for profile migration inventory

The OpenCode agent files present during decision-making were: orchestrator, coder, reviewer, reviewer-deep, architect, debugger-deep, tester, test-runner, devops, devops-executor, frontend, external-researcher, external-analyst, external-investigator, domain-analyzer, scout, context-manager, task-manager, executor, and doc-writer. Their prompt text is to be manually distilled; permissions/mode/task runtime fields are not Pi profile semantics.
