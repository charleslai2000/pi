# Current control state

## Established
- MA3 checkpoint `16083a15b` is committed and pushed to `origin/main`; worktree has only previously identified unrelated modifications/deletions outside its commit.
- Existing MA2 integrated fixture directly calls Controller tools, so it verifies runtime behavior but not autonomous Controller selection.
- The canonical Controller is an ordinary AgentSession and faux provider supports scripted tool-call responses, enabling actual policy turn-loop execution without external model APIs.

## MA4 evidence and acceptance
- **Deterministic integration:** the scripted faux Controller exercises real tool plumbing and asserts the actual `dispatch_task` handler arguments across implementation, review, remediation, verification, and generic execution. The generic case confirms omitted `agent`/`cwd` creates ordinary Execution with cwd defaulting to PiRoot. Scripted choices are not evidence of model judgment.
- **Real autonomous specialist:** the configured OpenCodeX provider made an actual `dispatch_task` call selecting catalog profile `coder` and a PiRoot-contained project cwd. The fork applied profile model/variant and Goal→Plan→Task context. The valid workspace's Node tests passed (2/2), including duplicate-key rejection. This proves specialist-selection behavior; it does not require one unique cwd.
- **Generic model policy:** a particular real model turn is not required to select no-agent execution. Whether a model chooses generic for an individual simple Task is non-blocking policy variance; generic runtime correctness is covered deterministically.
- `.pi/AGENTS.md` now states explicitly that `agent` and `cwd` are optional and omitting both selects generic Execution at PiRoot.

## Completion gates
MA4 is complete when MA4 focused/integrated tests, MA1–MA3 regressions, and `npm run check` pass. No additional real generic canary is required.
