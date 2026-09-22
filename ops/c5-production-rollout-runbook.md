# C5 Production Rollout Runbook

## Bundle identity

- Entrypoint: `/home/charles/.local/bin/pi`
- Entrypoint behavior: imports `/home/charles/Workspaces/3rdparty/pi/packages/coding-agent/dist/bundle/cli-runtime.js`
- Validate: `readlink -f /home/charles/.local/bin/pi`, `sha256sum packages/coding-agent/dist/bundle/cli-runtime.js`
- Build: `npm run build:offline`; validate with `npm run check`
- Rollback: stop the target Pi process, restore the previously recorded bundle file from an authorized backup, verify checksum, restart. Never alter Session/Task/assignment files during bundle rollback.

## Start

```bash
PI_CODING_AGENT_DIR=/home/charles/.pi/agent \
node packages/coding-agent/dist/bundle/cli-runtime.js \
  --root <PiRoot> --session-dir <session-dir> --model <provider/model> --mode rpc
```

Keep RPC stdin open for the lifetime of asynchronous prompts. `stdin end` is shutdown.

## Health checks

- Process is running and RPC accepts `get_state`.
- Controller `sessionId` is the canonical Controller identity.
- Executor `sessionId` and `sessionFile` are stable across resume/recovery.
- Controller tools are present only on Controller; Executor admission begins with `task_gate`.
- After admission, Executor provider tools contain `task_memory` and `task_result`, not `task_gate`.
- Inspect Task Markdown status/result/remaining/memory.
- Inspect `control/assignments.json`; terminal Tasks must have no current assignment.
- Inspect derived `inspect_frontier`; do not treat a static `frontier.md` as authority.
- Check Task events for `task_gate`, `task_memory`, `task_result`, BLOCKED/resume, and model-switch evidence.
- Context/compaction and provider errors are observations; do not infer lifecycle transitions from them.

## Restart/recovery

1. Keep PiRoot/Session/Task/assignment files unchanged.
2. Stop the process cleanly, or record crash timing if it is an active-task failure.
3. Start the same bundle against the same PiRoot and session storage.
4. Verify canonical Controller identity, Executor Session identity, Task status, assignment, and durable memory.
5. Resume only through native Session input/Controller atomic tools; verify lifecycle tools before work.
6. Recheck assignments/frontier and Task Markdown after completion.

## Rollback/restore rehearsal

1. Record current bundle checksum.
2. Copy the bundle to an isolated backup path.
3. Start/stop an isolated PiRoot with the current bundle.
4. Restore the exact backup and verify checksum equality.
5. Start again and verify the same durable Session/Task authority is readable.

## Forbidden operations

- Do not add `/execute`.
- Do not write or reactivate `ExecutionAttempt` runtime authority.
- Do not add a scheduler, polling loop, execution runtime, or shadow state.
- Do not manufacture a second Task/assignment authority.
- Do not print API keys, bearer tokens, full credentials, or complete sensitive prompts.
- Do not mutate live user Session, Task, assignment, or Registry data during readiness exercises.
