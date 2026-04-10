issue: Obsidian is currently taking up 12 GB of RAM during heavy pencil rendering.

files associated:
- [pencil-draw-shape-util.tsx](../../tldraw-handwriting-rec-plugin-obsidian/src/tldraw/rendering/pencil-draw-shape-util.tsx) — the main pencil shape util; this is the largest rendering hotspot for stroke visuals, SVG node generation, and stamp modes.
- [pencil-renderer.ts](../../tldraw-handwriting-rec-plugin-obsidian/src/tldraw/rendering/pencil-renderer.ts) — pressure-aware stroke geometry, width/opacity computation, and canvas rendering helpers.
- [pencil-texture.ts](../../tldraw-handwriting-rec-plugin-obsidian/src/tldraw/rendering/pencil-texture.ts) — grain, texture, pressure opacity, SVG filter/pattern generation, and dab texturing.
- [TldrawApp.tsx](../../tldraw-handwriting-rec-plugin-obsidian/src/components/TldrawApp.tsx) — editor mount/wiring point where module-level refs are synchronized with the active editor.

problem explanation:
The rendering pipeline is SVG-based React output, not canvas. The expensive path is `buildCircleStampStroke()`, which emits many SVG nodes per stroke and is re-run during zoom/pan. That creates a large React reconciliation burden and a very large SVG scene graph.

goal:
Reduce SVG node count and avoid recomputing expensive stroke visuals during camera motion, while preserving the current look as much as possible.

context:
- File: `pencil-draw-shape-util.tsx`
- `buildCircleStampStroke()` currently emits 3 `<circle>` SVG elements per dab.
- `buildPressureSampledRibbonStroke()` recomputes on every render, including camera changes.
- `cameraMovingRef` and `editorZoomRef` already exist at module level.
- `pencilOpacitySensitivity` and `pencilCrossSectionAspectRatio` are module-level mutable variables that affect output.
- `activeBrushTipRef` and `activeStampShapeModeRef` are module-level refs.

CHANGE 1 — Robust stroke result memoization

Add at module level:

  type RibbonCacheEntry = {
    key: string
    node: React.ReactNode
  }

  const ribbonCache = new Map<string, RibbonCacheEntry>()

Build the cache key at the top of `buildPressureSampledRibbonStroke()`, after extracting `localPressurePoints`, using all inputs that affect the visual result:

  const stride = Math.max(1, Math.floor(localPressurePoints.length / 64))
  let geoHash = 0
  for (let i = 0; i < localPressurePoints.length; i += stride) {
    const p = localPressurePoints[i]
    geoHash = (geoHash * 31 + (p.x * 1000 | 0)) & 0xffffffff
    geoHash = (geoHash * 31 + (p.y * 1000 | 0)) & 0xffffffff
    geoHash = (geoHash * 31 + (p.pressure * 1000 | 0)) & 0xffffffff
  }

  const zoomBucket = Math.floor(editorZoomRef.current * 4) / 4
  const cacheKey = [
    shape.id,
    localPressurePoints.length,
    geoHash,
    zoomBucket,
    activeStampShapeModeRef.current,
    activeBrushTipRef.current ? 'bitmap' : 'nobmp',
    pencilOpacitySensitivity.toFixed(2),
    pencilCrossSectionAspectRatio.toFixed(2),
    shape.props.color,
    shape.props.size,
    shape.props.scale?.toFixed(2) ?? '1',
  ].join('|')

  const cached = ribbonCache.get(shape.id)
  const cacheValid = cached?.key === cacheKey

  if (cameraMovingRef.current && cacheValid) {
    return cached.node
  }

  if (cacheValid) {
    return cached.node
  }

Before every non-null return, store the result:

  ribbonCache.set(shape.id, { key: cacheKey, node: result })

Add eviction when `ribbonCache.size > 400`:
- Prefer removing entries that are no longer needed.
- If editor/store access is not available, remove the oldest 80 entries using `ribbonCache.keys()`.

CHANGE 2 — Replace 3-layer circles with single soft-dab circles

In `buildCircleStampStroke()`:
- Remove the layers array entirely.
- Each dab becomes one `<circle>`.
- Keep `r = baseRadius` with no additional scale layers.
- Use `fillOpacity = Math.max(0.06, Math.min(0.45, averageOpacity * 0.55))`.
- Reference `filter="url(#ptl-soft-dab-filter)"` on each dab.

Do not inject SVG DOM from inside `buildCircleStampStroke()`.

Instead, add the filter definition in `injectPencilTexureFilters()` in `pencil-texture.ts`, alongside the existing pencil grain filter/pattern:

  <filter id="ptl-soft-dab-filter" x="-20%" y="-20%" width="140%" height="140%">
    <feGaussianBlur stdDeviation="0.4" />
  </filter>

That keeps filter setup centralized and stable.

constraints:
- Do not change any function signatures.
- Do not touch the polygon ribbon path, rectangle stamp path, or bitmap stamp path.
- Keep rendering-path edits focused on `buildPressureSampledRibbonStroke()` and `buildCircleStampStroke()`.
- It is allowed to add `editorRef`, `isShapeNearViewport()`, and the early viewport gate in `PencilDrawShapeUtil.component()` for Change 3.
- It is allowed to wire `editorRef.current = editor` from `TldrawApp.tsx` on editor mount.
- Keep existing exports intact.

acceptance criteria:
- The prompt clearly targets the real SVG/React bottleneck.
- The instructions are implementable in the existing codebase.
- The prompt avoids brittle DOM mutation from inside the render helper.
- The prompt keeps scope controlled and performance-focused while including memoization, node-count reduction, and viewport-based unloading.

CHANGE 3 — Spatial unloading for off-viewport shapes

Add at module level:
  export const editorRef: React.MutableRefObject<import('tldraw').Editor | null> = 
    { current: null }

Set this from TldrawApp.tsx in the tldraw onMount callback:
  editorRef.current = editor
(Same pattern as the existing module-level refs already set from TldrawApp.tsx)

Add this function in pencil-draw-shape-util.tsx:
  function isShapeNearViewport(shape: TLDrawShape): boolean {
    const editor = editorRef.current
    if (!editor) return true
    const viewport = editor.getViewportPageBounds()
    const margin = Math.max(viewport.w, viewport.h) * 1.5
    const bounds = editor.getShapePageBounds(shape)
    if (!bounds) return true
    return (
      bounds.maxX >= viewport.minX - margin &&
      bounds.minX <= viewport.maxX + margin &&
      bounds.maxY >= viewport.minY - margin &&
      bounds.minY <= viewport.maxY + margin
    )
  }

In PencilDrawShapeUtil.component(), add as the FIRST check, before 
any ribbon or style computation:
  if (!isShapeNearViewport(shape)) {
    const stale = ribbonCache.get(shape.id)
    if (stale) return wrapForHtmlRender(stale.node)
    return super.component(shape)
  }

Do NOT add this check in toSvg() — SVG export must render all 
shapes regardless of viewport position.

CACHE EVICTION — replace the "oldest 80 entries" fallback with:
  function evictRibbonCache(): void {
    if (ribbonCache.size <= 400) return
    const editor = editorRef.current
    if (editor) {
      // Preferred: remove entries for shapes no longer in the store
      for (const id of ribbonCache.keys()) {
        if (!editor.store.has(id as TLShapeId)) {
          ribbonCache.delete(id)
        }
      }
    }
    // Fallback if still over limit or no editor available
    if (ribbonCache.size > 400) {
      let removed = 0
      for (const key of ribbonCache.keys()) {
        ribbonCache.delete(key)
        if (++removed >= 80) break
      }
    }
  }

Call evictRibbonCache() at the point where the size guard fires,
replacing the inline deletion logic described in Change 1.