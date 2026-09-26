Status: ACTIVE
Work area
implementation, testing

Objective
Implement Pi-native optional Agent profiles and Controller-directed fresh Session execution tenures per ADR-0002 and `design/architecture/agent-scheduling-phase1.md`: formal `.pi/control/<goal-id>` Markdown authority; project-over-global profile resolution; prompt/model/variant composition; `forkExecutionSession({task, agentSlug?, cwd?})`; `dispatch_task(task, agent?, cwd?)`; registry and `/sessions` metadata; Task memory refresh across sequential tenures. Preserve Task SSOT, existing assignment generation, ordinary AgentSession/SessionPool/SessionRegistry, standalone compatibility, and frozen exclusions.

Inputs
- `design/decisions/ADR-0002-pi-native-control-authority.md`
- `design/architecture/agent-scheduling-phase1.md`
- current `design/architecture/task-session-native.md`
- `packages/coding-agent/src/core/{agent-session-runtime.ts,agent-session-services.ts,agent-session.ts,session-manager.ts,session-registry.ts,session-pool.ts,pi-root.ts,control/*,resource-loader.ts,model-runtime.ts}`
- Existing focused tests and OpenCode profile migration candidate inventory in ADR-0002; never add runtime dependency on `~/.config/opencode/agents/`.

Completion
Acceptance in user request passes: generic PiRoot cwd; coder default cwd; reviewer custom contained cwd; project profile overrides global; model/variant applied; prompt composition order and bounded Goal/Plan/Task context; sequential coder then reviewer tenure on same Task reads new Task memory; Task identity and generation; transcript is not Task SSOT; `/sessions` displays profile/task/cwd; orchestrator remains canonical Controller only; no ExecutionAttempt/scheduler/shadow authority. Run focused tests, integrated E2E, and `npm run check`.

Result
Design authority recorded. Initial source inspection shows current Controller dispatch creates a new Session instead of forking; assignment admission binds Task work onto long-lived sessions. Formal layout migration impacts read-model, mutations, associations, frontier, and registry pathing; keep these within the same Task because they must agree on one authority root.

Remaining
Implement and verify. Continue into the next multi-Agent scheduling stage after Phase 1 completion without waiting for an extra user confirmation, as requested; create a new Goal for any materially different completion boundary.
