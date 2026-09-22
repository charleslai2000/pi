# T001: Implement and freeze warm multi-session

Status: DONE

## Work area
`packages/coding-agent`

## Objective
Deliver concurrent warm multi-session support and freeze it as an isolated commit with focused verification.

## Inputs
- User requirements for SessionPool/SessionSlot ownership, live `/sessions`, foreground switching, background execution, busy/unread activity, abort/close lifecycle, notifications, and same-worktree warning detection.
- Existing AgentSession lifecycle and extension/runtime APIs.
- Existing repository and test harness.

## Completion
- Implement the scoped Multi-Session behavior.
- Add deterministic lifecycle, isolation, activity, conflict, UI, and regression tests.
- Run the focused test gate and Biome.
- Stage and commit only the authorized Multi-Session files.
- Preserve unrelated working-tree changes and do not push.

## Result
Completed.

Focused verification:
- 9 test files passed.
- 36 tests passed.
- Biome checked 16 files with no fixes.
- Staged diff check passed.

Commit:
- `95cf6143e feat(coding-agent): support concurrent live sessions`
- 16 authorized Multi-Session files only.

The implementation covers live slot ownership, warm/cold resume, presentation-only foreground switching, background model/tool execution, busy/unread state, completion notifications, abort/close/dispose lifecycle, `/sessions`, Git worktree conflict detection, linked-worktree isolation, and replacement lifecycle regressions.

## Remaining
None for this task. Unrelated workspace changes were intentionally left uncommitted and untouched. The package-wide suite retains unrelated pre-existing dependency/build failures; they are outside this task's completion condition.
