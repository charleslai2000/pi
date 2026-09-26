# Plan: Regular Renderer Long-History Optimization

Status: DEFERRED

## Decision
Do not modify renderer architecture in the current TUI performance work. The retained full-document diff renderer needs complete history for redraw, resize, and Ctrl-L; no finalized-to-scrollback ownership transfer exists.

## Frozen boundaries
- P5E/P5F fullscreen virtualization remains frozen.
- Do not port VirtualList to regular mode.
- Do not add workarounds or alter regular rendering behavior.
- Session transcript remains the sole history authority.

## Reopen condition
Reconsider only when a concrete dogfood defect justifies a separate architecture project for `finalized scrollback + active retained surface`, with explicit ownership of full redraw, resize, Ctrl-L, diff/paint, and terminal scrollback semantics.
