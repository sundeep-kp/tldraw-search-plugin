
---

# stroke_listener.md

## Detecting Freehand Strokes in the Tldraw Obsidian Plugin

This document explains how to detect completed handwritten strokes inside the **tldraw editor embedded in Obsidian**.

The listener captures strokes drawn with the **freehand draw tool** and forwards them to the handwriting recognition pipeline.

---

# Overview

The Tldraw editor maintains all application state inside an internal **store**.

Every change to the canvas (shape creation, modification, deletion) is recorded as a store update.

The store exposes a listener API that allows external modules to observe these updates.

This makes it possible to detect when new handwritten strokes are created.

---

# Listener Strategy

The handwriting system should subscribe to editor state updates.

The listener inspects shape changes and filters for:

```id="vqq4rg"
shape.type === "draw"
```

and

```id="eyp3i1"
shape.props.isComplete === true
```

This ensures that only **completed freehand strokes** trigger recognition.

---

# Editor Instance Access

The Tldraw editor instance is created inside:

```id="n3tv87"
src/components/TldrawApp.tsx
```

Inside this component the editor is passed to the `<Tldraw />` React component.

The instance becomes available through the Tldraw editor lifecycle hooks.

Example pattern:

```ts id="5syhsu"
<Tldraw
  onMount={(editor) => {
    initializeStrokeListener(editor)
  }}
/>
```

The `editor` object exposes the internal store.

---

# Store Listener

Once the editor instance is available, the system subscribes to store updates.

Example:

```ts id="v2y20m"
function initializeStrokeListener(editor) {

  editor.store.listen((update) => {

    for (const record of Object.values(update.changes.added)) {

      if (
        record.type === "draw" &&
        record.props?.isComplete
      ) {
        handleNewStroke(record)
      }

    }

  })

}
```

This listener receives notifications whenever shapes are added.

---

# Shape Structure

A freehand stroke shape has the following structure:

```id="v1o6c5"
shape
 ├─ id
 ├─ type: "draw"
 ├─ x
 ├─ y
 └─ props
     ├─ segments
     │   └─ points[]
     └─ isComplete
```

Example point:

```id="qg5u9i"
{
  x: -1.44,
  y: -4.32,
  z: 0.5
}
```

Points describe the pen trajectory.

---

# Extracting Stroke Geometry

Once a draw shape is detected, stroke data can be extracted.

Example:

```ts id="2xwwi3"
function extractStroke(shape) {

  const strokes = []

  for (const segment of shape.props.segments) {

    const stroke = segment.points.map(p => ({
      x: p.x,
      y: p.y
    }))

    strokes.push(stroke)

  }

  return strokes
}
```

These strokes can be forwarded to the handwriting recognizer.

---

# Preventing Duplicate Processing

A shape may appear in multiple updates during editing.

Recognition should run only once per shape.

Simple strategy:

```id="jnksoh"
processedShapeIds = Set()
```

Example:

```ts id="myh66e"
if (!processedShapeIds.has(shape.id)) {

  processedShapeIds.add(shape.id)

  processStroke(shape)

}
```

---

# Example Flow

When a user draws a letter:

```id="3kak7l"
user draws stroke
      │
      ▼
tldraw creates draw shape
      │
      ▼
store update fired
      │
      ▼
stroke listener triggered
      │
      ▼
shape detected
      │
      ▼
stroke extracted
      │
      ▼
recognition pipeline
```

---

# Recommended Listener Location

The listener should be initialized during editor mount.

Best location:

```id="bju6ok"
src/components/TldrawApp.tsx
```

This ensures:

```id="c4l6sg"
editor instance is available
listener attaches once
no duplicate listeners
```

---

# Module Integration

The listener should delegate work to other modules.

Recommended structure:

```id="r4z6i7"
strokeListener.ts
   │
   ▼
strokeExtractor.ts
   │
   ▼
strokeNormalizer.ts
   │
   ▼
strokeGrouping.ts
   │
   ▼
recognizer.ts
```

This keeps responsibilities separated and simplifies testing.

---

# Minimal Prototype

The first working listener should simply log strokes.

Example:

```ts id="6m0uec"
function handleNewStroke(shape) {

  const strokes = extractStroke(shape)

  console.log("Stroke detected")
  console.log(strokes)

}
```

Expected console output:

```id="xrdgkq"
Stroke detected
points: 73
shapeId: shape:iQzNB4HB6nUwBK4hMf0p1
```

Once stroke capture works reliably, recognition can be added.

---

# Summary

The Tldraw store listener provides a clean and reliable method for detecting handwritten strokes.

By observing the creation of `draw` shapes and extracting their point data, the plugin can feed handwriting input into a recognition pipeline without modifying the Tldraw core engine.

This architecture keeps the handwriting system modular, maintainable, and compatible with future Tldraw updates.

---

One more thing worth documenting before coding (and this one will actually save debugging time) is a **`data_flow.md` diagram of the entire system from canvas → recognizer → Obsidian search index**. That way when something breaks you immediately know which stage failed instead of randomly blaming the ML model like everyone else does.
