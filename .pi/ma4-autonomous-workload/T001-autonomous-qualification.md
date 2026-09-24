Status: DONE
Work area
implementation, testing

Objective
Implement deterministic end-to-end qualification that runs the canonical Controller's real AgentSession policy/tool loop and verifies autonomous profile/cwd choices over implementation → review → remediation → verification plus simple generic work.

Inputs
- User MA4 requirements.
- MA3 commit `16083a15b` (pushed to `origin/main`).
- `startPiRootApplication`, faux provider API (`fauxToolCall`, `fauxAssistantMessage`, `appendResponses`), current multi-agent integrated test and profiles.

Completion
Actual Controller model turns execute `list_agents`, optional `inspect_agent`, create/set dependencies/dispatch, with profile and cwd arguments originating in model tool-call outputs rather than test direct dispatch. Separate Tasks hand off only through `.pi` Goal/Plan/prerequisite/Task authority. Assertions establish project/global override, model/variant/cwd instructions, registry/session projection and assignment generations, canonical orchestrator, no runtime routing, simple no-profile path, no ExecutionAttempt/shadow authority. Focused/integrated tests and npm check pass.

Result
- Deterministic/integration evidence: `integrated-orchestration-e2e.test.ts` runs the real Controller Session tool loop against scripted faux assistant tool calls. It proves catalog/profile/tool plumbing, actual dispatch handler arguments, four-stage Task context/generation/session projections, and generic no-agent runtime behavior. It does not claim scripted parameters prove model policy.
- Real-provider specialist evidence: isolated working code workspace; Controller actually called `list_agents`, `inspect_agent`, and `dispatch_task` with `agent="coder"` and a contained project cwd. Forked Session applied `opencodex/worker` / `medium`, and Goal→Plan→Task context. Mechanical Node tests passed 2/2, including duplicate-key rejection.
- Real generic model choice is not an acceptance requirement; per-turn generic-vs-specialist choice is non-blocking policy variance. The deterministic generic path establishes runtime correctness.
- Controller `.pi/AGENTS.md` explicitly states `agent` and `cwd` are optional; omitting both means generic Execution at PiRoot.
- Gates: integrated E2E passed (1 test); MA4 focused + MA1–MA3 regression set passed (13 files / 51 tests); `npm run check` passed.

Remaining
None for MA4 acceptance. Real generic policy variance is non-blocking.
