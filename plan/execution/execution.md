 Below is a **practical `implementation_plan.md`**. It’s written so a coding model (or a tired human) can follow it step-by-step without guessing.

---

# implementation_plan.md

## Implementation Plan for Handwriting Recognition in the Tldraw Obsidian Plugin

This document describes the step-by-step plan for implementing searchable handwritten notes inside the **tldraw plugin for Obsidian**.

The goal is to extend the existing plugin by detecting freehand strokes, running handwriting recognition, and indexing the results for search.

---

# Development Environment

Target platform:

```text
Ubuntu 22.04
Node.js
TypeScript
Obsidian plugin development environment
```

Project base repository:

```text
https://github.com/tldraw/obsidian-plugin
```

Development occurs by **forking this repository and extending it**.

---

# Step 1 — Clone and Run the Plugin

Clone your fork:

```bash
git clone https://github.com/<yourname>/obsidian-plugin
cd obsidian-plugin
```

Install dependencies:

```bash
npm install
```

Start development build:

```bash
npm run dev
```

Place the plugin inside your vault:

```text
<Vault>/.obsidian/plugins/tldraw-in-obsidian/
```

Enable it inside Obsidian.

Goal of this step:

```text
Confirm the plugin builds and loads correctly.
```

---

# Step 2 — Identify the Editor Mount Point

The editor instance must be accessed to attach the stroke listener.

Relevant file:

```text
src/components/TldrawApp.tsx
```

Locate the `<Tldraw />` component.

Add an editor mount hook.

Example:

```ts
<Tldraw
  onMount={(editor) => {
    initializeStrokeListener(editor)
  }}
/>
```

This gives the plugin access to the **tldraw editor instance**.

---

# Step 3 — Implement Stroke Listener

Create a new module:

```text
src/handwriting/strokeListener.ts
```

Purpose:

```text
Detect new draw shapes in the editor store.
```

Example implementation:

```ts
export function initializeStrokeListener(editor) {

  const processedShapes = new Set()

  editor.store.listen((update) => {

    for (const record of Object.values(update.changes.added ?? {})) {

      if (
        record.type === "draw" &&
        record.props?.isComplete
      ) {

        if (!processedShapes.has(record.id)) {

          processedShapes.add(record.id)

          console.log("Stroke detected:", record)

        }

      }

    }

  })

}
```

Goal:

```text
Verify strokes are detected when drawing.
```

Expected console output:

```text
Stroke detected: shape:XXXX
```

---

# Step 4 — Extract Stroke Geometry

Create:

```text
src/handwriting/strokeExtractor.ts
```

Purpose:

```text
Convert draw shape segments into stroke arrays.
```

Example:

```ts
export function extractStroke(shape) {

  const strokes = []

  for (const segment of shape.props.segments) {

    const points = segment.points.map(p => ({
      x: p.x,
      y: p.y
    }))

    strokes.push(points)

  }

  return strokes

}
```

Output format:

```json
[
  [
    {"x":0,"y":0},
    {"x":-1.44,"y":-4.32}
  ]
]
```

---

# Step 5 — Normalize Stroke Data

Create:

```text
src/handwriting/strokeNormalizer.ts
```

Purpose:

```text
prepare strokes for recognition
```

Tasks:

```text
resample points
scale strokes
remove noise
```

Example normalization pipeline:

```ts
normalizeStroke(stroke)
  → resample
  → scale
  → translate
```

Initial prototype may skip complex normalization.

---

# Step 6 — Implement Stroke Grouping

Create:

```text
src/handwriting/strokeGrouping.ts
```

Purpose:

```text
combine nearby strokes into words
```

Grouping criteria:

```text
time difference < 800ms
horizontal distance < threshold
```

Example output:

```json
{
  "strokes": [stroke1, stroke2],
  "boundingBox": {...}
}
```

Initial prototype may process **single strokes only**.

---

# Step 7 — Integrate Handwriting Recognizer

Create:

```text
src/handwriting/recognizer.ts
```

Recognizer options:

* Google ML Kit Digital Ink Recognition
* MyScript iink SDK

Recognizer input format:

```json
{
 "strokes": [
   [
     {"x":0,"y":0,"t":0},
     {"x":1,"y":2,"t":1}
   ]
 ]
}
```

Recognizer output:

```json
{
 "text": "hello",
 "confidence": 0.92
}
```

---

# Step 8 — Store Recognition Results

Create:

```text
src/handwriting/indexer.ts
```

Purpose:

```text
persist recognized text in markdown
```

Example metadata block:

```markdown
<!-- tldraw-handwriting-index
shape:iQzNB4HB6nUwBK4hMf0p1 = "a"
shape:q6IgmlC3Z7JnfaGPiUXlv = "b"
-->
```

This allows **Obsidian search to index handwritten content automatically**.

---

# Step 9 — Implement Navigation

When search results are clicked:

```text
retrieve shapeId
locate shape
zoom canvas
```

Example API usage:

```ts
editor.setCamera({
  x: targetX,
  y: targetY,
  zoom: 2
})
```

Optional:

```text
highlight recognized strokes
```

---

# Step 10 — Performance Improvements

Once the system works:

### Add stroke caching

Avoid repeated recognition.

---

### Background processing

Run recognition asynchronously.

---

### Confidence filtering

Ignore low confidence results.

---

# Recommended Module Structure

Final architecture:

```text
src/
  handwriting/
    strokeListener.ts
    strokeExtractor.ts
    strokeNormalizer.ts
    strokeGrouping.ts
    recognizer.ts
    indexer.ts
```

Responsibilities:

```text
strokeListener   → detect draw shapes
strokeExtractor  → extract vector points
strokeNormalizer → normalize strokes
strokeGrouping   → merge strokes into words
recognizer       → run handwriting recognition
indexer          → store recognized text
```

---

# Minimal Working Prototype

First milestone:

```text
draw stroke
↓
stroke listener triggers
↓
console.log(stroke points)
```

Second milestone:

```text
draw letter
↓
recognizer returns text
↓
text stored in markdown
```

Final milestone:

```text
search handwritten text in Obsidian
↓
canvas navigates to stroke
```

---

# Final Result

After implementation, the system enables:

```text
handwritten notes in tldraw
↓
automatic recognition
↓
searchable inside Obsidian
```

Users can draw naturally on the canvas while retaining the ability to search their handwritten knowledge base.

---
