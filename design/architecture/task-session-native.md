

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
