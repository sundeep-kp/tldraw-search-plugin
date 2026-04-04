

## Revised Prompt Plan — Krita Brush Bundle Integration

---

### PROMPT 1 — Extract brush tip bitmaps and spacing/curve data from the bundle

```
Context:
- File: src/obsidian/krita/krita-bundle.ts
- This file already opens .bundle ZIPs, reads META-INF/manifest.xml,
  parses .kpp XML, and produces a derived preset style object with:
    pencilBrushSizePx, pencilOpacitySensitivity, 
    pencilTextureIntensity, pencilCrossSectionAspectRatio, 
    pencilTextureEnabled
- It currently reads ONLY scalar metadata. We now need real assets.

Task — extend the existing KPP parser in this file to also extract:

1. Brush tip bitmap:
   - In the KPP XML, find <param name="filename"> or inside 
     <param name="brush_definition"> a nested <brush filename="..."/>
   - That filename references a PNG inside the ZIP at paths like:
       kis_brushes/{filename}  or  brushes/{filename}
   - Extract those bytes as a Uint8Array and attach to the preset:
       brushTipData: Uint8Array | null
   - If the referenced file does not exist in the ZIP, set null.
     Do NOT throw — many presets reference Krita's built-in tips 
     that aren't bundled.

2. Spacing factor:
   - Parse <param name="Spacing/isotropic"> or <param name="spacing">
     as a float. Fallback: 0.2
   - Add to derived style as: spacingFactor: number

3. Pressure curves:
   - Parse <param name="PressureSize"> sensor block if present.
     Krita stores curve points as "x,y;x,y;..." strings.
     Fit a single power-law exponent via:
       exponent = log(y2/y1) / log(x2/x1)  using midpoints
     Fallback: sizeCurveExponent: 0.7
   - Same for <param name="PressureOpacity">
     Fallback: opacityCurveExponent: 1.2

4. Rotation jitter:
   - Parse <param name="rotation"> or <param name="jitter"> as 
     float 0–1. Fallback: 0
   - Add as: rotationJitter: number

Extend the preset type (wherever it is defined in this file) to 
include all new fields. Existing fields must not change.
Do NOT load ImageBitmap here — raw bytes only.
```

---

### PROMPT 2 — Cache brush tips as ImageBitmap at selection time

```
Context:
- File: src/components/TldrawApp.tsx
- This file already handles KritaBrushPresetPanel selection and 
  writes preset values to settings via handwritingRecognition 
  settings fields (kritaSelectedPresetId, brush size, opacity, etc.)
- After Prompt 1, each preset now also carries:
    brushTipData: Uint8Array | null
    spacingFactor, sizeCurveExponent, opacityCurveExponent, 
    rotationJitter

Task:
1. Add two refs near the top of the component (NOT state):
     const brushTipCache = useRef<Map<string, ImageBitmap>>(new Map())
     const activeBrushTip = useRef<ImageBitmap | null>(null)
     const activeBrushProfile = useRef<BrushProfile | null>(null)

   Where BrushProfile is a new local type:
     { baseSize, spacingFactor, sizeCurveExponent, 
       opacityCurveExponent, rotationJitter, baseOpacity }

2. In the existing preset selection handler 
   (where kritaSelectedPresetId is written to settings):
   a. Build a BrushProfile from the preset's derived style values
   b. Store it in activeBrushProfile.current
   c. If brushTipData is non-null AND presetId not in cache:
        const blob = new Blob([preset.brushTipData], 
                               {type: 'image/png'})
        createImageBitmap(blob).then(bmp => {
          brushTipCache.current.set(presetId, bmp)
          activeBrushTip.current = bmp
        })
   d. If already in cache: activeBrushTip.current = cache.get(id)
   e. If brushTipData is null: activeBrushTip.current = null
      (fallback tip will be generated in Prompt 6)

3. Pass activeBrushTip and activeBrushProfile as stable refs 
   (not props, not state) to whatever canvas layer component 
   is added in Prompt 3. Use a context or attach to a shared 
   ref object.

Never store ImageBitmap in React state or settings.
```

---

### PROMPT 3 — Add the two-canvas overlay to TldrawApp

```
Context:
- File: src/components/TldrawApp.tsx
- tldraw renders into a container div that this component controls
- pencil-draw-shape-util.tsx currently drives all visual output 
  via tldraw's SVG/vector pipeline
- We are adding two <canvas> elements as an overlay:
    committedCanvas — permanent accumulation of finished strokes
    activeCanvas    — current in-progress stroke only
- The vector shape in tldraw remains but will be set to 
  opacity 0 for Krita-mode strokes (keep for storage/selection)

Task:
1. Add refs: committedCanvasRef, activeCanvasRef

2. Render inside the tldraw container div:
     <canvas ref={committedCanvasRef} style={{
       position: 'absolute', inset: 0,
       pointerEvents: 'none',
       zIndex: 10
     }} />
     <canvas ref={activeCanvasRef} style={{
       position: 'absolute', inset: 0,
       pointerEvents: 'none',
       zIndex: 11
     }} />

3. Add a useEffect with ResizeObserver on the container:
   On resize:
   a. Snapshot committedCanvas to ImageBitmap BEFORE resize:
        const snapshot = await createImageBitmap(committedCanvas)
   b. Update both canvas width/height:
        canvas.width = container.offsetWidth * devicePixelRatio
        canvas.height = container.offsetHeight * devicePixelRatio
   c. Scale ctx: ctx.scale(devicePixelRatio, devicePixelRatio)
   d. Restore snapshot to committedCanvas:
        ctx.drawImage(snapshot, 0, 0)

4. Export committedCanvasRef and activeCanvasRef (or their 
   contexts) for use by the stroke handler in Prompt 4.
   Use a ref object or context — NOT state or props.

Do not wire pointer events here. That is Prompt 4.
```

---

### PROMPT 4 — Real-time dab loop pointer handler

```
Context:
- File: src/components/TldrawApp.tsx
  (or extract to src/components/KritaStrokeHandler.ts if cleaner)
- activeCanvas and committedCanvas are available from Prompt 3
- activeBrushTip and activeBrushProfile refs from Prompt 2
- The existing pencil tool is registered in pencil-tool.ts and 
  ui-overrides.ts. We need to intercept pointer events ONLY when
  the active tldraw tool matches the pencil tool id from pencil-tool.ts
- pressureStore.ts already tracks per-stroke pressure/velocity 
  sessions — read from it but do NOT replace it

Task:
1. Add stroke tracking refs (not state):
     lastDabX, lastDabY, lastPressure, lastTimestamp: useRef
     remainderDist: useRef<number>(0)
     isDrawing: useRef<boolean>(false)

2. Wire pointer events to the tldraw container div with 
   { capture: true } so we intercept before tldraw:
     onPointerDown, onPointerMove, onPointerUp

   Gate every handler: if active tool !== pencil tool id, 
   call e.stopPropagation() = false and return (let tldraw handle it)
   If Krita mode active (aktiveBrushProfile.current !== null):
     e.stopPropagation() to prevent tldraw drawing its own shape

3. onPointerDown:
   - e.currentTarget.setPointerCapture(e.pointerId)
   - clear activeCanvas (ctx.clearRect)
   - set isDrawing = true
   - initialize lastDabX/Y to e.offsetX/Y (CSS pixels)
   - initialize lastPressure to e.pressure || 0.5
   - remainderDist.current = 0

4. onPointerMove (only if isDrawing):
   - read x = e.offsetX, y = e.offsetY, p = e.pressure || 0.5
   - spacing = activeBrushProfile.current.baseSize 
               * activeBrushProfile.current.spacingFactor
   - spacing = Math.max(spacing, 1)
   - rawDist = Math.hypot(x - lastDabX.current, y - lastDabY.current)
   - totalDist = rawDist + remainderDist.current
   - steps stamped = 0
   - while totalDist >= spacing:
       t = (steps * spacing - remainderDist.current) / rawDist
       t = Math.max(0, Math.min(1, t))
       dabX = lerp(lastDabX.current, x, t)
       dabY = lerp(lastDabY.current, y, t)
       dabP = lerp(lastPressure.current, p, t)
       stampDab(activeCtx, dabX, dabY, dabP)
       totalDist -= spacing
       steps++
   - remainderDist.current = totalDist
   - update lastDabX/Y/Pressure to current values

5. onPointerUp:
   - isDrawing = false
   - committedCtx.drawImage(activeCanvas, 0, 0)
   - activeCtx.clearRect(...)
   - DO NOT prevent tldraw from also recording its vector shape —
     we need it for selection. But set the recorded shape's 
     opacity to 0 via shape props after creation.

6. stampDab(ctx, x, y, pressure):
   const profile = activeBrushProfile.current
   const tip = activeBrushTip.current
   const size = profile.baseSize 
     * Math.pow(Math.max(pressure, 0.01), profile.sizeCurveExponent)
   const opacity = profile.baseOpacity 
     * Math.pow(Math.max(pressure, 0.01), profile.opacityCurveExponent)
   const angle = profile.rotationJitter 
     * (Math.random() - 0.5) * 2 * Math.PI
   ctx.save()
   ctx.globalAlpha = Math.min(opacity, 1)
   ctx.translate(x, y)
   ctx.rotate(angle)
   if (tip) {
     ctx.drawImage(tip, -size/2, -size/2, size, size)
   } else {
     // inline radial gradient fallback
     const g = ctx.createRadialGradient(0,0,0,0,0,size/2)
     g.addColorStop(0, 'rgba(0,0,0,1)')
     g.addColorStop(1, 'rgba(0,0,0,0)')
     ctx.fillStyle = g
     ctx.beginPath()
     ctx.arc(0, 0, size/2, 0, Math.PI*2)
     ctx.fill()
   }
   ctx.restore()

CRITICAL: never call getImageData or putImageData anywhere 
in this loop. drawImage and globalAlpha only.
```

---

### PROMPT 5 — Synthetic fallback tips for presets with no bitmap

```
Context:
- File: create new file 
  src/obsidian/krita/fallback-tips.ts
- Called from TldrawApp.tsx when activeBrushTip.current is null
  (brushTipData was null in Prompt 1 — tip not bundled)
- pencil-texture.ts already has grain/noise helpers — import 
  from there rather than reimplementing noise

Task:
Export one function:
  generateFallbackTip(
    presetName: string, 
    profile: BrushProfile,
    size: number
  ): Promise<ImageBitmap>

Inside, create an OffscreenCanvas(size, size), get its 2d context,
then branch on keywords in presetName.toLowerCase():

Case "pencil" | "graphite" | "basic":
  - Draw soft ellipse with aspect ratio from 
    profile.pencilCrossSectionAspectRatio (or 0.6 default)
  - Overlay grain from pencil-texture.ts helpers
  - Soft radial falloff at edges

Case "ink" | "pen" | "liner" | "marker":
  - Near-circle, hard edge (no feathering)
  - Minimal grain (0.05 intensity max)
  - High opacity ceiling

Case "charcoal" | "chalk" | "pastel":
  - Wide soft ellipse (aspect 0.4)
  - Heavy grain from pencil-texture.ts
  - Scattered opacity (multiply grain onto alpha)

Default:
  - Radial gradient circle, no grain

After drawing, return createImageBitmap(offscreenCanvas).

In TldrawApp.tsx (Prompt 2 handler), after determining 
brushTipData is null, call generateFallbackTip and store 
result in brushTipCache under key "fallback-{presetId}".
```

---

### PROMPT 6 — Align raster canvases with tldraw pan and zoom

```
Context:
- File: src/components/TldrawApp.tsx
- committedCanvas and activeCanvas are absolute overlays (Prompt 3)
- tldraw has its own camera (pan x/y, zoom z) accessible via 
  editor.getCamera() from the tldraw editor instance
- When user pans or zooms, the raster canvases must follow.
  Re-rasterizing is too slow. Use CSS transform instead.

Task:
1. Get the tldraw editor instance — it is already available in 
   TldrawApp.tsx via the <Tldraw> onMount callback or useEditor hook.

2. Subscribe to camera changes:
     editor.on('change', handler)
   In handler, read const cam = editor.getCamera()

3. On each camera change, apply to BOTH canvases:
     canvas.style.transform = 
       `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`
     canvas.style.transformOrigin = '0 0'

4. In the pointer handler from Prompt 4, convert screen coords 
   to world coords before stamping:
     const cam = editor.getCamera()
     const worldX = (e.offsetX - cam.x) / cam.z
     const worldY = (e.offsetY - cam.y) / cam.z
   Use worldX/worldY in stampDab, not raw offsetX/Y.

5. Unsubscribe in useEffect cleanup:
     return () => editor.off('change', handler)

Do NOT re-rasterize on zoom — add a comment:
  // TODO: re-rasterize at new zoom for sharpness (future work)
```

---

### PROMPT 7 — Persist raster strokes as sidecar file

```
Context:
- Files: src/components/TldrawApp.tsx
  Obsidian vault API is accessible in this component
- tldraw auto-persists vector shapes to the .md file
- Our raster committedCanvas is in-memory only — lost on reload
- We persist it as a PNG sidecar next to the canvas .md file:
    {notepath}.krita-strokes.png

Task:
1. Add a saveTimeout ref: useRef<ReturnType<typeof setTimeout>>()

2. After each onPointerUp (after compositing to committed), 
   schedule a debounced save:
     clearTimeout(saveTimeout.current)
     saveTimeout.current = setTimeout(async () => {
       const dataUrl = committedCanvas.toDataURL('image/png')
       const base64 = dataUrl.split(',')[1]
       const binary = atob(base64)
       const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
       await app.vault.adapter.writeBinary(sidecarPath, bytes)
     }, 2000)

   Where sidecarPath = currentFilePath.replace(/\.md$/, 
     '.krita-strokes.png')
   And app is the Obsidian App instance (already available in 
   TldrawApp.tsx or passable as prop from BaseTldrawFileView.ts)

3. On component mount / file open:
     const exists = await app.vault.adapter.exists(sidecarPath)
     if (exists) {
       const bytes = await app.vault.adapter.readBinary(sidecarPath)
       const blob = new Blob([bytes], {type: 'image/png'})
       const bmp = await createImageBitmap(blob)
       committedCtx.drawImage(bmp, 0, 0)
     }

4. When user clears canvas or eraser covers committed strokes:
     await app.vault.adapter.remove(sidecarPath)

5. If canvas.width or height > 4096:
     use toDataURL('image/jpeg', 0.92) instead and use 
     sidecarPath ending in .krita-strokes.jpg
     Log a console.warn explaining why.
```

---

### PROMPT 8 — Wire pencil-texture.ts grain into live dab rendering

```
Context:
- File: pencil-texture.ts — already has grain/texture helpers 
  used by pencil-draw-shape-util.tsx in the old vector pipeline
- File: src/components/TldrawApp.tsx — stampDab function from 
  Prompt 4 currently uses inline radial gradient as fallback
- We want pencil-texture.ts grain to also apply on top of real 
  bitmap tips during stamping, controlled by pencilTextureIntensity
  from the active Krita preset

Task:
1. In pencil-texture.ts, export (or confirm already exported) 
   a function:
     applyGrainToDab(
       ctx: CanvasRenderingContext2D,
       x: number, y: number,
       size: number,
       intensity: number  // 0–1
     ): void
   
   Implementation: draw a small noise pattern centered at x,y 
   with radius size/2, globalAlpha = intensity, 
   composite mode 'multiply'.
   Reuse whatever noise primitive is already in this file.
   Do NOT rewrite pencil-texture.ts from scratch — extend only.

2. In stampDab() (TldrawApp.tsx, from Prompt 4):
   After the ctx.drawImage(tip, ...) or gradient fallback,
   if profile.pencilTextureIntensity > 0.05:
     applyGrainToDab(
       ctx, 0, 0,   // already translated to dab center
       size, 
       profile.pencilTextureIntensity
     )

3. Confirm that pencilTextureIntensity is correctly populated 
   from the KPP parsed value in Prompt 1. If it was previously 
   always 0 or 1, verify the KPP field being read and adjust 
   the mapping to produce a float in 0–1 range.

This closes the loop between the existing texture system and 
the new raster dab pipeline without duplicating texture logic.
```

---

### Handoff notes

Give Copilot one prompt at a time. Verification checkpoints after each:

- **P1** → `console.log` a preset object; confirm `brushTipData` is a non-null `Uint8Array` for at least one preset from a real bundle, and that `spacingFactor` is between 0.05–0.5
- **P2** → select the same preset twice; confirm cache hit logged, no second `createImageBitmap` call
- **P3** → resize the window; confirm canvases track it and a previously drawn test stroke survives the resize
- **P4** → draw at fast and slow speeds; confirm dab density is visually even at both speeds
- **P5** → select a preset whose tip wasn't bundled; confirm a non-circle fallback tip is visible in the stroke
- **P6** → draw a stroke, then pan and zoom; confirm stroke stays locked to its position
- **P7** → draw strokes, wait 2 seconds, close and reopen the file; confirm strokes reappear
- **P8** → select a high-texture preset; confirm grain is visible layered over the tip bitmap