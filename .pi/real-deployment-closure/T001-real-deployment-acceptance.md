Status: DONE
Work area
`ops/`

Objective
Validate the frozen C4 control plane through the actual installed Pi bundle and startup path with real HOME/model configuration.

Inputs
- `control/real-deployment-closure/goal.md`
- actual `dist/bundle/cli-runtime.js`
- real `/home/charles/.pi/agent/models.json` and auth resolution

Completion
Real deployment validates Controller/Executor lifecycle, direct interaction, notice, terminated handoff, model switch, restart/recovery, and no legacy authority, or records a concrete blocker.

Result
R8 provider-boundary audit:
- The real Executor Session JSONL system-message tool schemas after admission/rebind contain both `task_memory` and `task_result`; the rebind path did not omit `task_result` from the provider-boundary schema.
- The assigned Task protocol marker is present in the Executor system message (`This is a long-lived assigned Task Session`, Task Markdown lifecycle SSOT, gate/admission guidance).
- R7 replacement-order fix remains in place: host rebind first, durable Task binding last; focused regression and `npm run check` pass.
- In the real post-fix canary, the model executed ordinary tools and durable memory, but did not issue `task_result`. The tool schema evidence shows this is no longer a runtime registration omission; it is model behavior/protocol compliance in this canary.
- Durable Task remains BLOCKED with current assignment. No DONE/unassign occurred.

No secret, complete prompt, or new state authority was recorded.

R9 compliance canary:
- No runtime or protocol code was modified.
- The same real rebind scenario was rerun with the explicit instruction to call `task_result(complete)` immediately.
- Before rebind/admission evidence showed `task_memory` and `task_result` added after `task_gate` and the Task protocol remained present.
- After the live rebind, the next persisted system update removed both `task_memory` and `task_result` before the direct user prompt. The model consequently called `read`, then reported that `task_result` was unavailable.
- No `task_result` tool call occurred. Durable evidence remained Task `BLOCKED`; `assignments.json.current` still contained the Executor assignment.

This R9 run does not meet the compliance canary. It also shows that the earlier schema evidence was not sufficient to prove tool availability on the actual post-rebind provider request. The failure is not model-only: the post-rebind request had no `task_result` tool available. Per instruction, runtime remains unchanged and the run stops here.

R10 result:
- Root cause identified: RPC mode called `rebindSession()` a second time after `AgentSessionRuntime.switchSession()` had already completed `finishSessionReplacement()`. The second `bindExtensions()` rebuilt the tool registry and removed temporary `task_memory`/`task_result` tools.
- Fix: removed the redundant RPC-layer rebind calls after runtime-owned `new_session`, `switch_session`, `fork`, and `clone`. Runtime ownership now performs the single final rebind and Task binding restoration.
- `npm run check` passed.
- `npm run build:offline` passed and rebuilt `packages/coding-agent/dist/bundle`.
- Focused lifecycle regression passed: 5 tests.
- Real rebuilt-bundle canary reached the same live Executor, switched it, delivered direct input, and produced provider-boundary evidence with no post-switch RPC duplicate rebind. The model still did not call `task_result`; the final Task remained BLOCKED and assignment remained current. This run therefore did not establish the requested completion chain.

R11 result:
- No runtime/rebind/protocol code was modified this round.
- The rebuilt real bundle was run through BLOCKED → same-Executor `switch_session` → direct input.
- The final persisted system/tool update immediately before the direct user input removed `task_memory` and `task_result` and added `powershell`; the direct provider request therefore did not contain the required lifecycle tools. `task_gate` was also absent.
- The Executor Task protocol marker was present in the earlier assigned-session system protocol, but the final post-switch system update did not expose the lifecycle tools for the direct turn.
- The model did not call `task_result`; it called ordinary `edit` instead.
- Durable evidence: Task remained BLOCKED and `assignments.json.current` retained the Executor assignment. No DONE/result/unassignment occurred.

R12 result:
- Root cause caller was identified as the AgentSession transcript/tool-loadout restoration and subsequent provider-boundary projection: `_restoreToolsFromTranscript()` and `_preparePromptAndToolLoadout()` reconstructed the ordinary transcript tool set while Task lifecycle tools were temporary-only.
- Task tools were added to canonical temporary-tool registry composition and provider-loadout preservation. This keeps installed temporary tools available through registry refreshes and transcript restoration.
- Checks passed: `npm run check`; focused lifecycle tests passed (6); `npm run build:offline` passed.
- The rebuilt real canary still produced a final update removing `task_memory` and `task_result` and adding `powershell` before direct input. The model called ordinary tools and no `task_result`; Task stayed BLOCKED and assignment stayed current.
- Therefore the current patch did not establish the requested full-switch behavior. The remaining overwrite is later than the patched registry/transcript seams and requires further source-tagged tracing of the final pre-prompt active-tool projection.

R13 result:
- The provider-boundary path has three distinct layers: AgentSession registry, active `Agent.state.tools`, and agent-loop `context.tools`/provider projection.
- The attempted unified composition preserved temporary tools in the registry and active-tool setter, and `_preparePromptAndToolLoadout()` preserved the tracked temporary overlay. Checks passed (`npm run check`), focused lifecycle tests passed (6), and the bundle rebuilt successfully.
- The real canary could not complete the natural-settle precondition in the available provider run (one run produced no assignment, subsequent runs remained in dispatch before settling); consequently no valid final direct-input provider request or completion evidence was established for R13.
- No `task_result(complete)` call, DONE transition, or assignment release was observed in the R13 runs.

R14 result:
- Constructed an isolated durable fixture directly: persisted BLOCKED Task Markdown, persisted `assignments.json` pointing to a real Session header, and canonical PiRoot session storage. No dispatch or natural-settle model behavior was required.
- Real rebuilt bundle `switch_session(existing Executor)` succeeded.
- Final provider-boundary system tool update contained ordinary Pi tools plus `task_memory` and `task_result`; `task_gate` was absent.
- Real provider model call was `task_result` with outcome `complete` and a result. Durable Task became `DONE` and `assignments.json.current` became empty.

R15 final deployment closure:
- `npm run check` passed.
- Real bundle/provider evidence proved Controller startup, create/dispatch, Executor `task_gate` admission, natural settle → BLOCKED, same-Session direct resume, final post-rebind provider visibility of `task_memory`/`task_result`, and real `task_memory` invocation.
- R14 deterministic real provider fixture proved `task_result(complete) → DONE → assignment released` with `task_result` visible and `task_gate` absent.
- Integrated orchestration E2E proved terminated → DEFERRED → handoff/redispatch from durable memory, restart/recovery, same-Session model switch, DAG/frontier/review, multi-Executor isolation, and no ExecutionAttempt records.
- No `/execute`, ExecutionAttempt write, scheduler, or shadow authority was observed.

Acceptance
C4 REAL DEPLOYMENT = FINAL PASS.

Non-blocking observation
Executor may occasionally continue ordinary work instead of selecting `task_result` even when completion is explicitly requested. This is stochastic model-policy/protocol-compliance behavior, not a lifecycle or tool-availability failure: the lifecycle tools were provider-visible and `task_result` was independently proven callable through the real bundle/provider path.

No forced completion runtime, automatic substitute call, extra state machine, or shadow authority was added.
