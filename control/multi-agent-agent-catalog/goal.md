# Goal: Pi-native Agent Catalog and Controller Scheduling

Status: DONE

## Authorized outcome
Enable the canonical PiRoot Controller to inspect available Pi-native Agent profiles and use project orchestration policy to choose optional `agentSlug` and contained `cwd` for ordinary Task Session tenures.

## Scope
- Controller-only merged global/project Agent catalog and on-demand profile inspection.
- PiRoot `.pi/AGENTS.md` as explicit Controller orchestration policy.
- Migrate the requested specialist profile set into Pi-native prompt/model/variant documents.
- Preserve MA1 fork, admission, prompt composition, Task SSOT, assignment generation, and Session Registry semantics.
- Integrated separate-Task coder implementation → dependent review → finding-driven dependent remediation scenario, preserving Task lifecycle and review policy.

## Exclusions
No hardcoded task-type routing, scheduler or ExecutionAttempt authority, shadow Task state, OpenCode runtime dependency/semantics, or change to Task/Session-native invariants.

## Completion
Catalog merge/override, Controller tools/policy use, requested profile availability, and integrated implementation/review/remediation acceptance pass; focused tests, MA1 regressions, and `npm run check` pass. MA1 same-Task multi-tenure evidence remains established separately.
