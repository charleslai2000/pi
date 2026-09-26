# Goal: Regular Renderer Long-History Optimization

Status: DEFERRED

## Authorized outcome
Bound Pi-side retained presentation state in regular terminal mode while preserving terminal scrollback behavior.

## Finding
The regular renderer is a retained full-document diff renderer. Each render consumes the complete component document; width/height full redraw and Ctrl-L behavior depend on that retained document. There is no finalized-content append boundary that transfers ownership to terminal-native scrollback while retaining only mutable content.

Under the current frozen renderer/layout constraints, native scrollback cannot replace the retained history without losing the source needed for subsequent redraws. Implementing bounded regular-mode history therefore requires a separate renderer architecture project for finalized scrollback plus an active retained surface.

## Disposition
**DEFERRED — regular renderer long-history optimization requires separate renderer architecture project.**

No renderer architecture change or workaround is authorized in this Goal. Fullscreen P5E/P5F remain frozen and are the recommended bounded-history path for long Sessions. Regular renderer behavior remains unchanged; its long-history performance limitation is accepted until a concrete dogfood issue authorizes a dedicated renderer redesign.
