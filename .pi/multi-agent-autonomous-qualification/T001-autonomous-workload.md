Status: DONE
Work area
implementation, testing

Objective
Qualify autonomous Controller profile/cwd selection for concrete implementation, review, finding-driven remediation, verification, and a simple generic Task using the live canonical Controller protocol/catalog and `.pi` context. Preserve all MA1–MA3 invariants; no authority/schema/runtime routing changes.

Inputs
- MA3 checkpoint `16083a15b` pushed to `origin/main`.
- Existing `integrated-orchestration-e2e.test.ts`, `startPiRootApplication`, faux provider and test suite harness.
- User MA4 acceptance.

Completion
Deterministic integrated dispatch/runtime qualification passes; a real configured-model specialist call proves autonomous catalog-based agent and contained cwd choice; MA1–MA3 regressions and `npm run check` pass. Generic runtime omitted-agent/default-PiRoot behavior is deterministic evidence; no particular real-model generic selection is required.

Result
- Real provider specialist call: `dispatch_task(goalId="specialist-goal", taskId="T001", agent="coder", cwd="<isolated PiRoot>")`; profile came from catalog. Fork applied `opencodex/worker` / `medium` and Goal→Plan→Task context. Valid fixture Node tests passed 2/2 including duplicate-key regression. The initial separate generic experiment had no dispatch and is excluded from pass evidence.
- Deterministic/integration gates: integrated E2E 1/1; focused plus MA1–MA3 gates 12 files / 50 tests; `npm run check` passed.
- Policy now explicitly says `agent` and `cwd` are optional; omitting both selects generic Execution at `<PiRoot>`.
- MA4 = PASS. Specialist-vs-generic selection on a particular real-model task remains non-blocking policy variance.

Remaining
None.
