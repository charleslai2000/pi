Status: DONE
Work area
implementation, testing

Objective
Complete MA3 Goal/Plan/Task context authority: deterministic legacy migration if needed; Controller-only explicit Goal/Plan memory mutation primitives; prevent ordinary Executor/raw file tools from writing managed authority; restrict `.pi/.gitignore`; verify canonical bounded context assembly and preserve MA1/MA2 semantics.

Inputs
- Current checkpoint `e0e9098ee` (`feat(coding-agent): add Pi-native multi-agent scheduling`).
- Canonical readers in `packages/coding-agent/src/core/control/read-model.ts`, mutations in `control/task-definitions.ts` and `control/task-mutations.ts`, context in `execution-session.ts`, policy/tools in `agent-session-runtime.ts`, raw file tools in `core/tools/{write,edit}.ts`, `.pi/.gitignore`.
- MA1/MA2 acceptance/regression suites and user MA3 requirements.

Completion
Authority is exclusively `<PiRoot>/.pi/control/<goal-id>/{goal.md,plan.md,Tnnn-<slug>.md}`; migration preserves all material authority facts without dual read/write. Goal/Plan memory mutations are explicit Controller tools through managed primitives; execution and raw file tools cannot edit managed authority. `.pi/.gitignore` ignores machine runtime state but tracks authority/profile/policy. Execution prompt is Goal relevant context → Plan relevant context → current Task full context, including only relevant prerequisite context, without sibling Tasks or transcript-derived durable context. Restart/recovery and MA1/MA2 E2E, focused suites, and `npm run check` pass. Commit MA3 only if explicitly requested; never include unrelated working-tree changes.

Result

Checkpoint e0e9098ee is committed locally. Repository inspection found legacy `control/<goal-id>` authorities in the PiRoot; the supplied acceptance explicitly authorizes their deterministic migration. Historical canary fixture directories also contain legacy-looking trees, but are not runtime PiRoots and will not be migrated.

Implemented Controller-only Goal/Plan memory primitives/tools, canonical `.pi/control` context readers, managed-path guards, `.pi/.gitignore` tightening, and a tested one-time migration helper. The current root migration moves the legacy Pi-root Goal directories into `.pi/control/`; the earlier MA3 test result is preserved as historical evidence.

Remaining
The one-time helper remains explicit and is not invoked by runtime. Current canonical Goal authority path is `.pi/control/<goal-id>/`; older completion records above describe the earlier root layout.
