# Pi-native Multi-Agent Session Scheduling — Phase 1

Status: ACCEPTED

## Authority layout

For a PiRoot, `.pi/` is the only PiRoot marker and the project authority root:

```text
<PiRoot>/.pi/
├── AGENTS.md
├── agents/<agentSlug>.md          # optional project Agent profile overrides
├── control.sqlite3                # local runtime state; ignored by Git
└── <goal-id>/
    ├── goal.md
    ├── plan.md
    ├── T001-<slug>.md
    └── T002-<slug>.md
```

Goal, Plan, and Task Markdown are durable, version-controlled authority. No `control/` directory is used. `control.sqlite3` is runtime state, not authority for Goal/Plan/Task content. The repository MUST ignore the database and its SQLite sidecars, while other `.pi/` files are eligible for version control. PiRoot initialization MUST NOT overwrite or create authority documents.

Memory scope is bounded by the SSOT documents:
- Goal: durable cross-Task context, decisions, constraints, and outcomes.
- Plan: current strategy, Task graph, phase decisions, and cross-Task coordination memory.
- Task: that Task's lifecycle, facts, evidence, results, and remaining/completion memory.

Task remains lifecycle SSOT. Execution Sessions are disposable tenures, not durable truth. Goal/Plan mutations are Controller-coordinated; ordinary Executors may mutate only their assigned Task through existing Task memory/lifecycle tools. Do not allow competing Executors to write Goal/Plan.

## Profiles

Agent profiles are optional and non-authoritative:

```text
AgentProfile = { agentSlug: string, prompt: string, model?: LogicalModelId, variant?: string }
```

Global profiles are `~/.pi/agents/<slug>.md`; project profiles are `<PiRoot>/.pi/agents/<slug>.md`. Project profile of the same slug overrides the global profile as one whole profile (no implicit prompt/model field merge). Frontmatter identifies the slug and optional logical model/variant; Markdown body is the profile prompt. Unknown fields, invalid slug, unreadable profile, or unresolvable requested model fail closed. `orchestrator` names the canonical Controller profile and is excluded from ordinary execution-fork lookup.

Profiles do not own Tasks, Sessions, assignments, lifecycle, or scheduling. The Controller LLM selects an optional profile and cwd based on available durable context; runtime does not infer role from Task type.

## Prompt and model composition

A new execution Session is created from forked Task source context with a fresh target-cwd resource load. Prompt precedence is stable:

1. Pi base/root system prompt.
2. Existing cwd-derived instructions in root-to-leaf order, including `<PiRoot>/AGENTS.md` and each applicable ancestor `AGENTS.md` through execution cwd.
3. Optional selected Agent profile prompt.
4. Bounded Task context assembled from `.pi/`: relevant Goal content/memory; current Plan strategy, relevant prerequisites/dependencies and coordination memory; full selected Task definition/current state/durable Task memory. Do not inject the complete Goal history or unrelated Tasks.

The Controller uses the same Pi base prompt, PiRoot `AGENTS.md`, `<PiRoot>/.pi/AGENTS.md`, and the `orchestrator` profile. It is not an execution fork.

A profile's logical model is resolved through the existing ModelRuntime. A valid profile model overrides the fork's model; otherwise the fork inherits the Controller/session model. `variant` maps through existing provider/model thinking-level or variant support and must be validated with the chosen model. No second model registry is introduced.

## Dispatch and tenure

`dispatch_task(task, agent?, cwd?)` is a Controller decision. Runtime validates the Task is dispatchable and dependency-eligible, verifies the optional agent exists, enforces cwd containment within PiRoot, creates a fresh ordinary Pi Session by forking Controller/session source, assigns the new Session, and starts existing Task admission. Omitted agent means no specialized profile and displays as `execution`. Omitted cwd means `<PiRoot>`. External cwd is rejected unless an existing explicit Pi authorization mechanism is applied; there is no implicit escape.

The internal primitive is `forkExecutionSession({ task, agentSlug?, cwd? })`. It uses normal `AgentSession` + `SessionPool` + `SessionRegistry`, and ordinary Pi Session transcript semantics. It introduces no ExecutionAttempt, subagent runtime, scheduler authority, or shadow Task state.

One Task may have sequential tenures (for example coder, reviewer, tester), each a fresh Session assigned through existing assignment history. The Task identity and Markdown memory persist. Existing monotonically increasing assignment `generation` means tenure number. Registry/display projects optional `agentSlug`, Task identity, cwd, and assignment generation from current Session/assignment facts; it does not become another authority.

## Session transcript and recovery

Each tenure is a normal Pi Session created by forking the Controller's Session at dispatch time, so the Session begins with the Controller's task history and context. Transcript storage follows the existing Pi Session storage policy, not `.pi/` project authority. On dispatch/reassignment/recovery, Task prompt context is rebuilt from current Goal/Plan/Task Markdown, so an earlier tenure's transcript is never Task SSOT. Assignment generation and Registry reconnect the live/recoverable Session to the durable Task.

## Existing profile migration inventory

These names were found in `~/.config/opencode/agents/`; profile bodies should be translated as prompts, without runtime access to OpenCode:

- `orchestrator` → canonical Controller profile; excluded from ordinary fork.
- `coder`, `reviewer`, `reviewer-deep`, `architect`, `debugger-deep`, `tester`, `test-runner`, `devops`, `devops-executor`, `frontend`, `external-researcher`, `external-analyst`, `external-investigator`, `domain-analyzer`, `scout`, `context-manager`, `task-manager`, `executor`, `doc-writer` → candidate optional Pi profiles with same slug.

OpenCode-only mode, permissions, tool grants, subagent/task dispatch authority, terminate controls, and agent runtime fields are not migrated as Pi profile behavior. Their relevant safe prose may be manually distilled into `prompt`. OpenCode-specific model ids are not copied verbatim unless they resolve to logical models in Pi. The migration inventory does not authorize reading OpenCode directories at runtime.

## Out of scope

No automatic agent-to-Task classification, scheduler/policy authority, execution attempt, parallel writes to Goal/Plan, transcript-derived Task truth, new executor lifecycle protocol, or external workspace permission model is introduced. Goal/Plan memory mutation primitives may be researched separately; ordinary Executors cannot use them in this phase.
