# ADR-0001: PiRoot resolution uses `.pi/` only

Status: Accepted

## Context

Pi historically treated `control/` as part of PiRoot discovery and placed the canonical Controller session at that directory. This coupled ordinary Pi startup to optional Task-authority files and mislabeled `control/` as a root marker. The Pi Control Plane migration assigns machine-owned state to `.pi/`; `control/` is legacy Task Markdown organization, not a Pi runtime prerequisite.

## Decision

- `<PiRoot>/.pi/` is the sole filesystem marker for a PiRoot.
- Discovery and initialization are separate. `resolvePiRoot*()` is filesystem-read-only; only the initializer creates directories.
- Explicit `--root` is initialization authorization. The path must already exist as a writable directory; an existing directory with no `.pi/` is initialized idempotently. A missing path, non-directory, unwritable path, or `.pi` file fails closed without choosing another root.
- Without `--root`, Pi walks upward from startup cwd and chooses the nearest ancestor containing `.pi/`.
- Interactive TTY startup with no discovered marker asks whether to initialize `.pi/` in the current cwd. Accept initializes; decline continues standalone.
- RPC, print and any non-TTY startup never prompt or implicitly initialize. If no marker exists, they continue standalone.
- SDK/embedded use may leave PiRoot unset.
- Do not infer roots from `control/`, Git roots, arbitrary files, or later foreground Session cwd.
- The Pi-native Control Plane authority layout is frozen by [ADR-0002](ADR-0002-pi-native-control-authority.md): Goal/Plan/Task Markdown lives directly under `<PiRoot>/.pi/<goal-id>/`, with `control.sqlite3` as ignored runtime state. No `control/` directory is used.
- Controller identity is durable registry metadata. If the registry database is lost, preserve old transcript files but do not guess which historical Session was canonical; create a new canonical Controller.
- Project authority documents are version-controlled; machine runtime state is excluded. PiRoot discovery never creates authority documents.

## Consequences

- Existing `.pi/` directories such as `homenet/.pi` are valid PiRoots without `control/`; explicit `--root` also initializes a missing `.pi/`.
- A directory containing only `control/` is not a PiRoot.
- Initialization creates only `.pi/`, `.pi/state/`, and `.pi/sessions/`; it never creates `control/` or registry/assignment data eagerly.
- Legacy `control/state` registry/assignment/session data is never a runtime fallback and requires explicit migration.
- Discovery is independent of Git nesting and remains fixed for the process lifetime.

## Verification

Implemented in `packages/coding-agent/src/core/pi-root.ts`, Controller startup in `session-registry.ts` and `pi-root-application.ts`. Regression coverage: `pi-root.test.ts`, `session-registry.test.ts`, and `pi-root-application-process.test.ts`.
