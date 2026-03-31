# TODO

## Current Status Snapshot
- Pencil is a standalone tool (`id: pencil`) and appears in the native toolbar.
- Pencil no longer redirects active tool state to draw/pen.
- Pressure-aware per-stroke size mapping is in place.
- Build currently passes.

## Priority 1: Pencil Feel (Visual Fidelity)
- [x] Replace per-stroke size buckets (`s/m/l/xl`) with point-level pressure rendering.
	- Implemented by remapping captured pressure values to draw segment point `z` values in `src/components/TldrawApp.tsx` (`onStrokeExtracted`), so stroke variation is continuous instead of bucketed.
- [ ] Apply velocity-based tapering at stroke start/end for natural lift-off feel.
- [ ] Add slight texture/grain option for pencil look (subtle, performance-safe).
- [ ] Tune smoothing so strokes preserve hand jitter without looking shaky.
- [ ] Add stylus-vs-mouse fallback behavior for pressure-less devices.

## Priority 2: Rendering Integration
- [ ] Wire `src/tldraw/rendering/pencil-renderer.ts` into actual draw shape render path.
- [ ] Ensure render path survives zoom changes and high-DPI displays.
- [ ] Verify pressure visuals remain consistent after shape move/duplicate/undo/redo.
- [ ] Add safe fallback when pressure data is missing or partial.

## Priority 3: Data + Recognition Alignment
- [ ] Decide whether pressure should be part of recognition features (optional experiment path).
- [ ] If enabled, extend preprocessing and model input channel handling.
- [ ] Keep pressure as visual-only by default to avoid model regressions.
- [ ] Add migration/compat handling for existing documents with no pressure metadata.

## Priority 4: UX + Controls
- [ ] Add Pencil settings group: pressure sensitivity, taper strength, texture amount.
	- `pressureSensitivity` slider implemented in Handwriting settings (0.5x to 5.0x), with live pressure amplification applied during Pencil drawing state (no post-stroke shape rewrite).
- [ ] Add quick toggle for "Natural Pencil" preset vs "Clean Ink" preset.
- [ ] Add a small debug panel for live pressure/velocity diagnostics.
- [ ] Ensure keyboard shortcut docs include Pencil and search behavior.

## Priority 5: Quality + Stability
- [ ] Add targeted tests for pressure capture/session mapping logic.
- [ ] Add tests for shape lifecycle cleanup (remove/move/undo/redo).
- [ ] Run lint and fix formatting/typing issues introduced by new modules.
- [ ] Profile performance on long strokes and large canvases.
- [ ] Verify Obsidian desktop and mobile behavior for stylus input.

## Priority 6: Documentation
- [ ] Update plugin README with Pencil tool behavior and limitations.
- [ ] Document architecture of pressure store and rendering flow.
- [ ] Add troubleshooting notes for devices that report unreliable pressure.

## Nice-to-Have
- [ ] Eraser interaction tuned for textured pencil strokes.
- [ ] Handwriting search highlight style that matches pencil theme.
- [ ] Optional export mode that preserves pencil texture in PNG/SVG.
