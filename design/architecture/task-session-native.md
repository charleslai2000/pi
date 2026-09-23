

## Phase 5A context budget policy

Status: ACCEPTED

Context budget is a read-only policy observation of the current Executor Pi Session. It is not cumulative output-token usage, provider billing usage, an ExecutionAttempt, or a new persisted authority.

The effective limit is the active Pi model's native `contextWindow`. Current usage is the native `AgentSession.getContextUsage()` estimate. Native Pi compaction remains responsible for reducing context; Phase 5A does not trigger or configure compaction.

The derived state machine is:

```text
compacting  = AgentSession.isCompacting
unknown     = !compacting && currentContextUsage == null
available   = !compacting && currentContextUsage != null && currentContextUsage < effectiveContextLimit
exhausted   = !compacting && currentContextUsage != null && currentContextUsage >= effectiveContextLimit
```

`unknown` includes the native post-compaction interval where Pi has not yet observed a valid post-compaction assistant usage. Unknown never implies exhausted. `exhausted` is a fact for Controller observation only: it does not change Task status, assignment, Session tenure, Executor tools, or result semantics. Runtime may send one deduplicated factual notice; the Controller LLM decides whether to continue, wait, terminate through the existing Task protocol, redispatch, or take another authorized action. No hardcoded escalation policy exists in this phase.

## Phase 6 conditional review protocol

Status: ACCEPTED

Review is not a runtime entity. The Controller may conditionally create a normal Review Task with `create_task`, include the reviewed Task identity/result, review objective, acceptance criteria, and evidence/risk checks, then use ordinary `set_task_dependencies`, `inspect_frontier`, and `dispatch_task`.

A review PASS completes only the Review Task and never changes or reopens the original Task. Findings are durable in the Review Task; the Controller may create an ordinary remediation Task with explicit DAG prerequisites. Reviewers use the unchanged Executor protocol tools. Duplicate reviews and review/remediation loops require concrete new facts and are not automatic.

## Phase 7 runtime semantics correction

Status: ACCEPTED

### PiRoot resolution policy

Status: ACCEPTED

`<PiRoot>/.pi/` is the sole marker for a PiRoot and contains Pi-owned machine state, including the session registry, assignments, and project session transcripts. The `control/` directory is not a root marker, is not required to launch Pi, and is never a fallback location for runtime state. Goal/Plan/Task Markdown under `control/` is optional Task authority associated with a PiRoot, not a prerequisite for ordinary Pi use.

Resolution is deterministic: explicit `--root` wins and must name an existing directory containing `.pi/`; otherwise walk upward from the startup cwd and select the nearest ancestor containing `.pi/`. If none exists, CLI startup fails with guidance to create/use a PiRoot or pass `--root`. SDK/embedded callers may leave PiRoot unset. Never infer PiRoot from Git roots, `control/`, arbitrary project files, or session cwd after startup.

A PiRoot with no `control/` remains a valid ordinary Pi project. Control Plane operations requiring Goal/Task authority report that authority as unavailable; they do not create it implicitly. A new canonical Controller is created in `<PiRoot>/.pi/sessions/`, and its identity is held in registry metadata. If the registry database is lost, prior canonical identity is not safely inferable from transcripts: startup preserves the old transcript and creates a new Controller rather than guessing. Existing legacy Control Plane data requires an explicit, stopped-runtime migration before being used.

### Session-native runtime semantics

The formal runtime uses `.pi/` and does not fall back to legacy runtime locations.

Each PiRoot has exactly one canonical Controller identified by `canonical_control_session_id`. Logical Session role is derived from authority: `controller` for that Session ID, `executor` for a current assignment, and `unassigned` otherwise. A Session matching both Controller and Executor is an invariant violation. UI slots are presentation identities only.

Executor lifecycle tools are `task_gate` and `task_memory`. Completion and termination use a strict, machine-parsable stop envelope emitted by the final assistant turn and interpreted by Pi at the quiescent boundary (`agent_settled`, idle, and no retry, queue, compaction, or pending tool). `completed` writes DONE and releases assignment; `waiting_user`, `waiting_approval`, and `blocked_external` write BLOCKED and retain assignment; `terminated` writes DEFERRED and releases assignment; `continue_possible` retains ACTIVE and does not notify the Controller as BLOCKED. Missing or invalid envelopes produce a durable protocol-violation/premature-settle observation and a factual Controller event; they are never guessed from natural-language keywords.

Every assignment has a monotonic generation and every Executor run has a runtime-only generation. Settle-derived mutations and Controller continuation requests must revalidate assignment identity, generation, Session idleness, and absence of queued/retry/compaction/new continuation before mutation or delivery. Stale transitions are dropped without notification.

Controller notifications are Pi custom messages with `customType = control_event`, structured generation/runtime facts, and optional turn triggering. They are not user messages. Controller events are observations; the Controller must inspect current Task state before acting. Managed Goal/Plan/Task and machine-owned state cannot be mutated through raw write/edit tools; explicit `create_goal`, `revise_goal`, `create_task`, and related primitives are the mutation boundary.
