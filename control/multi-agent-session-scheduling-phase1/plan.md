# Current control state

## Established decisions
- `design/decisions/ADR-0002-pi-native-control-authority.md` and `design/architecture/agent-scheduling-phase1.md` freeze the requested Phase 1 authority layout, profiles, prompt composition, normal Session tenure, memory authority, and scope exclusions.
- OpenCode profile names were inspected from `~/.config/opencode/agents/`; they are migration candidates only, not runtime dependencies.

## Frontier
Current runtime still implements Task authority under `control/`, Controller Session creation rather than forked execution, long-lived assignment binding, and no profile-based Session metadata. Required implementation work remains.

## Active work
- T001: implement Pi-native profile/fork/dispatch/context/tenure projection and acceptance tests.

## Next
Implement the coherent cross-cutting execution path against the frozen ADR and architecture. Do not start live migration or modify external services.
