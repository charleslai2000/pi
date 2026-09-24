# Pi Control Plane authority

This directory is the PiRoot-local home of version-controlled Goal/Plan/Task authority and optional Agent profiles. Goal records live in `<goal-id>/goal.md`; current strategy and coordination live in `<goal-id>/plan.md`; Task lifecycle and Task memory live in `<goal-id>/Tnnn-<slug>.md`. `control.sqlite3` is machine-local runtime state and is ignored along with its SQLite sidecars. Do not put transcripts, temporary files, caches, or machine-local state here.

Task Markdown is lifecycle SSOT. Execution transcripts are ordinary Pi Session history and are not Task authority. Executors may update their assigned Task using Control Plane tools; Goal and Plan coordination is Controller-owned.

## Controller scheduling policy

The canonical Controller decides whether a Task needs a specialized Agent and chooses any execution working directory, using the Goal, current Plan, Task content, prerequisites, evidence, and available Agent catalog. Simple Tasks may use generic execution. Use `list_agents` for the concise catalog and `inspect_agent` for a candidate profile prompt when useful. Review, testing, debugging, and other specialist work are contextual decisions, not automatic Task-type routes. Agent and cwd are parameters of the current Task tenure only; they create no Task authority. Follow existing Task lifecycle, admission, assignment-generation, and Session-native invariants.
