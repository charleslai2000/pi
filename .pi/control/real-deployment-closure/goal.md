# Goal: C4 Phase 8 Real Deployment Closure

## Authorized goal
Validate the frozen C4 control plane through the actual installed Pi bundle and startup path without adding functionality.

## Scope
Use the real `/home/charles/.local/bin/pi` / `dist/bundle/cli-runtime.js` path, real HOME model configuration, isolated PiRoot and session storage, and record deployment evidence.

## Constraints
No architecture, tools, scheduler, ExecutionAttempt, or shadow authority changes. Do not alter existing live PiRoot/session data. Stop on concrete deployment blocker.

## Completion
All requested real-deployment Controller/Executor/task/recovery/model-switch/no-legacy checks pass, or the concrete blocker is recorded.
