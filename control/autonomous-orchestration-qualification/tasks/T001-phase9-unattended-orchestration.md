Status: DONE
Work area
`ops/`

Objective
Qualify unattended Phase 9 orchestration through the real rebuilt bundle/provider in an isolated PiRoot, covering Controller policy, durable Task/DAG authority, parallel Executor dispatch, lifecycle tools, blocked/terminated continuation, downstream frontier progression, model switch where justified, and conditional review/remediation.

Inputs
- `control/autonomous-orchestration-qualification/goal.md`
- `control/autonomous-orchestration-qualification/plan.md`
- Phase 8 real deployment acceptance record
- rebuilt `packages/coding-agent/dist/bundle/cli-runtime.js`
- real provider configuration

Completion
A real unattended workload reaches appropriate terminal or intentional blocked states with durable evidence, or ordinary correctness defects are fixed and regressed; Phase 10 robustness then begins unless a frozen-architecture/product blocker appears.

Result
Phase 9 real unattended workload was run twice in isolated PiRoots with the rebuilt bundle/provider. The first run hit a provider 429 before Task creation; no durable workload was created. The retry created T001/T002 independent Tasks, T003 with prerequisites T001/T002, and T004 conditional review with prerequisite T003. Controller dispatched T001/T002 in parallel and later dispatched T003 after their terminal results.

The Executor provider behavior was not qualification-grade: T001/T002 followed Task tools but reported that their control-plane metadata was not sufficient evidence for downstream qualification; T003 remained ACTIVE when the process was stopped. The workload therefore did not converge to terminal/intentional-blocked state. This is a real unattended model/provider qualification failure, not a runtime lifecycle or architecture failure: no missing tool, stale assignment mutation, scheduler, ExecutionAttempt, or shadow authority was observed.

Phase 8 remains FINAL PASS. The transient 429 is recorded as provider robustness evidence; the non-converging workload is recorded as model/task-prompt qualification evidence.

Phase 9 R1 concrete workload result
- Clean real rebuilt-bundle/provider run created the requested objective Tasks, DAG prerequisites, and parallel dispatch for T001/T002.
- T002 completed correctly: Task `DONE`, durable memory recorded, and actual `/tmp/pi-c4-p9r1-9s52wsrf/project/work/b.txt` contains exactly `beta\n` (5 bytes).
- T001 created the actual file `/tmp/pi-c4-p9r1-9s52wsrf/project/work/a.txt` containing exactly `alpha\n` (6 bytes), but stopped at `Status: ACTIVE` without durable `task_memory`/`task_result` completion.
- Durable assignment evidence: `assignments.json.current` contains only `files/T001`; T002 was released. T003 remained `READY` behind its prerequisites; T004 remained `READY`; `merged.txt` was not created.
- No `/execute`, ExecutionAttempt, scheduler, or shadow authority was observed. No runtime tool-visibility or lifecycle mutation failure was exposed; the concrete stop was the T001 model turn not selecting `task_memory`/`task_result` after completing the file operation.

Phase 9 R2 result
- Hardened only the Executor system protocol and `task_result` tool description; no runtime, lifecycle, scheduler, or authority changes.
- Added focused protocol regression; 7 native lifecycle tests pass. `npm run check` and `npm run build:offline` pass.
- Clean real rebuilt-bundle/provider file workload converged unattended:
  - T001 DONE; `a.txt` exact `alpha\n`, 6 bytes, SHA-256 `b6a98d...51060`.
  - T002 DONE; `b.txt` exact `beta\n`, 5 bytes, SHA-256 `f2c82d...151ad`.
  - T003 depended on T001/T002 and became DONE; `merged.txt` exact `alpha\nbeta\n`, SHA-256 `e49c81...78ee`.
  - T004 depended on T003 and became DONE after byte-for-byte verification of all three files.
- Durable evidence: all four Task Markdown files are `Status: DONE`; `assignments.json.current` is `[]`; assignment history records assignment/release for all four Tasks.
- No `/execute`, ExecutionAttempt, scheduler, polling loop, or shadow authority was observed.

Phase 10 mechanism results
- `npm run check` passed.
- Session registry, ownership, recovery, close atomicity, and session resume-control regressions passed: 14 tests.
- Association validation/mutation, native lifecycle, Controller tools, and PiRoot application regressions passed: 17 tests.
- Combined qualification regression passed: 7 files, 25 tests.
- Existing integrated E2E remains passed and covers terminated handoff, restart/recovery, model switch, DAG/frontier/review, and multi-Executor isolation.
- No correctness bug requiring code changes was found. No scheduler, polling loop, ExecutionAttempt, shadow authority, or lifecycle semantic change was introduced.

Remaining
Phase 9 remains BLOCKED only on unattended provider/model task-execution quality: the real retry created and dispatched the DAG but did not converge the synthesis Task. Phase 10 mechanism robustness evidence is PASS for the exercised repository paths. A full production-qualified claim is not established while the real unattended workload remains non-convergent; this is a model/provider qualification blocker, not a frozen-architecture blocker.
