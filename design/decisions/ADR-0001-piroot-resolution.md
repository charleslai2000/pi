# ADR-0001: PiRoot resolution uses `.pi/` only

Status: Accepted

## Context

Pi historically treated `control/` as part of PiRoot discovery and placed the canonical Controller session at that directory. This coupled ordinary Pi startup to optional Task-authority files and mislabeled `control/` as a root marker. The Pi Control Plane migration assigns machine-owned state to `.pi/`; `control/` is legacy Task Markdown organization, not a Pi runtime prerequisite.

## Decision

- `<PiRoot>/.pi/` is the sole filesystem marker for a PiRoot.
- Explicit `--root` takes precedence and must resolve to an existing directory containing `.pi/`.
- Without `--root`, Pi walks upward from startup cwd and chooses the nearest ancestor containing `.pi/`.
- If no marker exists, the CLI fails with actionable guidance. SDK/embedded use may leave PiRoot unset.
- Do not infer roots from `control/`, Git roots, arbitrary files, or later foreground Session cwd.
- The registry, assignments, transcripts, and canonical Controller Session live under `.pi/`. Controller identity is durable registry metadata. If the registry database is lost, preserve old transcript files but do not guess which historical Session was canonical; create a new canonical Controller.
- Task Goal/Plan/Task authority may reside in the conventional `control/` directory but is optional. PiRoot discovery never creates that directory. Control Plane operations requiring absent Task authority fail clearly without preventing ordinary Pi use.

## Consequences

- Existing `.pi/` directories such as `homenet/.pi` are valid PiRoots without `control/`.
- A directory containing only `control/` is not a PiRoot.
- Legacy `control/state` registry/assignment/session data is never a runtime fallback and requires explicit migration.
- Discovery is independent of Git nesting and remains fixed for the process lifetime.

## Verification

Implemented in `packages/coding-agent/src/core/pi-root.ts`, Controller startup in `session-registry.ts` and `pi-root-application.ts`. Regression coverage: `pi-root.test.ts`, `session-registry.test.ts`, and `pi-root-application-process.test.ts`.
