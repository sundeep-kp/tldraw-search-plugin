## Plan: Optimize Handwriting Stroke Capture

Strengthen stroke detection and extraction by replacing timing-based heuristics with completion-based filtering, adding lifecycle-safe subscription cleanup, and introducing typed contracts for extracted stroke vectors. This keeps the listener reliable under rapid drawing/editing while staying aligned with existing `TldrawApp` and `useTldrawAppEffects` patterns. The recommended approach is a structured refactor that adds a dedicated stroke-listener hook and keeps debug observability behind an explicit flag.

**Steps**
1. Baseline and contracts phase: document current listener/extractor behavior and define target contracts for `StrokePoint`, `ExtractedStroke`, and listener callback payloads based on tldraw draw-shape data. This step blocks implementation steps that consume shared types.
2. Extractor hardening phase: refactor `strokeExtractor.ts` to use typed draw-shape points (`x`, `y`), add guard clauses for missing/invalid segments, and return stable vector output with no side effects. This can run in parallel with step 3 once contracts are defined.
3. Listener correctness phase: refactor `strokeListener.ts` to filter only completed draw shapes, prevent duplicate processing with per-editor shape-id tracking, and expose an unsubscribe/cleanup handle. Remove timeout-based completion guessing. This can run in parallel with step 2 after step 1.
4. Lifecycle integration phase: add a dedicated React hook in `src/hooks/` that owns listener registration/unregistration and wires extracted vectors to a callback. Integrate this hook into `TldrawApp.tsx` using current editor lifecycle flow so listeners are not leaked across remounts. This depends on steps 2 and 3.
5. Debug instrumentation phase: implement optional logging behind a debug flag (not unconditional console logging), with explicit event points (listener start, accepted completed shape, extraction result summary, skipped/duplicate shape). This depends on steps 2 through 4.
6. Validation phase: run lint/build and perform manual drawing scenarios for single stroke, rapid strokes, shape edits, and view mount/unmount to confirm exactly-once extraction behavior and no listener accumulation. This depends on steps 2 through 5.

**Relevant files**
- `/home/sundeep/dev/tldraw-handwriting-rec-plugin-obsidian/tldraw-handwriting-rec-plugin-obsidian/src/handwriting/strokeExtractor.ts` — replace array-index point reads with typed point-object extraction; add defensive guards and side-effect-free return values.
- `/home/sundeep/dev/tldraw-handwriting-rec-plugin-obsidian/tldraw-handwriting-rec-plugin-obsidian/src/handwriting/strokeListener.ts` — replace timeout heuristic with completion-gated processing; add dedup state and cleanup-capable subscription interface.
- `/home/sundeep/dev/tldraw-handwriting-rec-plugin-obsidian/tldraw-handwriting-rec-plugin-obsidian/src/handwriting/types.ts` — new shared types for stroke vectors/listener payloads and optional listener options.
- `/home/sundeep/dev/tldraw-handwriting-rec-plugin-obsidian/tldraw-handwriting-rec-plugin-obsidian/src/hooks/useStrokeListener.ts` — new lifecycle hook wrapping listener setup/teardown and callback dispatch.
- `/home/sundeep/dev/tldraw-handwriting-rec-plugin-obsidian/tldraw-handwriting-rec-plugin-obsidian/src/components/TldrawApp.tsx` — remove direct listener bootstrap in `onMount`; connect listener through hook-based lifecycle wiring.
- `/home/sundeep/dev/tldraw-handwriting-rec-plugin-obsidian/tldraw-handwriting-rec-plugin-obsidian/src/hooks/useTldrawAppHook.ts` — reference for existing editor lifecycle behavior; ensure no duplicate ownership of mount responsibilities.
- `/home/sundeep/dev/tldraw-handwriting-rec-plugin-obsidian/plan/execution/stroke-listener.md` — design reference for completion-based detection and dedup semantics.

**Verification**
1. Run `npm run lint` from `/home/sundeep/dev/tldraw-handwriting-rec-plugin-obsidian/tldraw-handwriting-rec-plugin-obsidian` and confirm no type/lint regressions in handwriting or hook files.
2. Run `npm run build` from `/home/sundeep/dev/tldraw-handwriting-rec-plugin-obsidian/tldraw-handwriting-rec-plugin-obsidian` and confirm plugin builds cleanly.
3. Manual canvas test: draw a single stroke and verify one extraction callback/event for one completed shape.
4. Manual stress test: draw many rapid short strokes and verify no duplicate extraction per shape id.
5. Manual lifecycle test: open/close tldraw view repeatedly and verify listener events do not multiply across remounts.
6. Manual edit test: modify an existing draw shape and verify listener behavior matches intended scope (new completed additions only unless explicitly expanded).
7. Debug-mode check: with debug enabled, verify concise structured logs; with debug disabled, verify no handwriting logs.

**Decisions**
- Chosen approach: structured refactor (not minimal patch).
- Logging decision: retain debug logs, but strictly behind a debug flag.
- Included scope: listener/extractor reliability, type safety, lifecycle cleanup, and debug instrumentation.
- Excluded scope: handwriting recognition engine integration, word grouping, markdown indexing/search pipeline, and UI for recognition results.

**Further Considerations**
1. Debug flag source recommendation: use existing plugin debug setting (`settingsManager.settings.debugMode`) to avoid introducing a separate config path.
2. Dedup persistence recommendation: keep dedup state scoped to active editor session; do not persist across file reloads to avoid stale suppression.
3. Extraction output recommendation: emit only geometric vectors now, but shape metadata (`shapeId`, timestamp, bounds) can be added in a backward-compatible callback payload for upcoming recognizer work.
