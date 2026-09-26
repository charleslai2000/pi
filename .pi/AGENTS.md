# Pi Control Plane authority

This directory is the PiRoot-local home of version-controlled runtime configuration and state. Control Plane Goal/Plan/Task authority lives under `.pi/control/<goal-id>/`: Goal records in `goal.md`, current strategy and coordination in `plan.md`, and Task lifecycle and memory in `Tnnn-<slug>.md`. `control/assignments.json`, `control/frontier.md`, and `control/execution-attempts.jsonl` are durable Control Plane indexes/history. `control.sqlite3` is machine-local SessionRegistry state and is ignored along with its SQLite sidecars. Do not put transcripts, temporary files, or caches here.

Task Markdown is lifecycle SSOT. Execution transcripts are ordinary Pi Session history and are not Task authority. Executors may update their assigned Task using Control Plane tools; Goal and Plan coordination is Controller-owned.

## Controller scheduling policy

The canonical Controller decides whether a Task needs a specialized Agent and chooses any execution working directory, using the Goal, current Plan, Task content, prerequisites, evidence, and available Agent catalog. Simple Tasks may use generic execution. In `dispatch_task`, both `agent` and `cwd` are optional: for a simple Task, omit both to create an ordinary generic Execution Session with cwd defaulting to `<PiRoot>`. Use `list_agents` for the concise catalog and `inspect_agent` for a candidate profile prompt when useful. Review, testing, debugging, and other specialist work are contextual decisions, not automatic Task-type routes. Agent and cwd are parameters of the current Task tenure only; they create no Task authority. Follow existing Task lifecycle, admission, assignment-generation, and Session-native invariants.
