# Goal: Warm Multi-Session

## Authorized goal
Implement and freeze concurrent warm multi-session support for `packages/coding-agent`, including live session ownership, foreground switching, background execution, activity state, abort/close lifecycle, `/sessions` UI, completion notifications, and same-Git-worktree conflict warnings.

## Scope
- `SessionPool`/`SessionSlot` ownership and opaque slot identity.
- `/new`, warm/cold `/resume`, foreground switching, `/sessions`, abort, close, fork/import replacement, and runtime disposal.
- Independent per-session runtime/context/activity and background model/tool execution.
- Git worktree identity detection and presentation-only conflict warnings.
- Deterministic tests and focused verification.

## Constraints and exclusions
- Foreground switching must not abort, park, shutdown, dispose, or recreate live slots.
- `SessionSlot` must not hold TUI or renderer references.
- No shared `ModelRuntime`, scheduler, orchestrator, RPC multi-session, automatic worktree creation, ownership protocol, or cross-session messaging.
- Do not alter unrelated working-tree content or push changes.

## Completion condition
The scoped implementation passes the focused Multi-Session gate and Biome, is committed as one isolated commit containing only the authorized files, and unrelated working-tree changes remain untouched.
