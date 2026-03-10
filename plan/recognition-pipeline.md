
Below is a **`recognition_pipeline.md`** that explains the full system we’re about to bolt onto the plugin.

---

# recognition_pipeline.md

## Handwriting Recognition Pipeline for Tldraw in Obsidian

This document describes the architecture and execution pipeline for enabling **searchable handwritten notes** inside the **tldraw canvas embedded in Obsidian**.

The goal is to detect handwritten strokes drawn on the canvas, run handwriting recognition on them, and store the recognized text so it becomes searchable inside the Obsidian vault.

---

# System Overview

The handwriting system operates as a **non-intrusive observer layer** on top of the existing Tldraw editor.

The extension does not modify the drawing engine itself.

Instead, it listens to editor state updates and processes completed freehand strokes.

---

# Pipeline Architecture

The recognition pipeline follows this sequence:

```id="y5u0y9"
User draws stroke
      │
      ▼
Tldraw creates "draw" shape
      │
      ▼
editor.store update event
      │
      ▼
Stroke listener detects new shape
      │
      ▼
Stroke geometry extracted
      │
      ▼
Stroke grouping logic
      │
      ▼
Handwriting recognition engine
      │
      ▼
Recognized text output
      │
      ▼
Search index updated
```

---

# 1. Stroke Detection

The Tldraw editor maintains all canvas state inside a store.

The store emits events whenever shapes change.

Relevant hook:

```id="r0g5r4"
editor.store.listen()
```

When a new shape appears, the listener inspects it.

Recognition should trigger only when:

```id="z1q3rs"
shape.type === "draw"
AND
shape.props.isComplete === true
```

This ensures recognition runs only after the user finishes drawing the stroke.

---

# 2. Stroke Extraction

Each draw shape contains one or more stroke segments.

Structure:

```id="ay4t1n"
shape
 └─ props
     └─ segments[]
          └─ points[]
```

Example point:

```id="b1an0d"
{
  x: number
  y: number
  z: number
}
```

Where:

```id="ew2l4k"
x → horizontal movement
y → vertical movement
z → pen pressure
```

Points are stored relative to the shape origin.

For recognition purposes the system extracts:

```id="66q90x"
[x,y] pairs
```

Pressure is optional.

---

# 3. Stroke Normalization

Raw strokes often contain many points.

Handwriting models typically perform better with normalized input.

Normalization steps:

### Point resampling

Reduce stroke complexity.

Example target:

```id="l3m3pn"
30–80 points per stroke
```

---

### Coordinate normalization

Convert strokes into a consistent scale.

Example:

```id="vq2u1n"
minX = 0
maxX = 1
```

---

### Optional smoothing

Remove jitter from stylus input.

---

# 4. Stroke Grouping

Handwriting recognition typically expects **words rather than individual strokes**.

However Tldraw generates one shape per continuous pen stroke.

Therefore multiple shapes must sometimes be grouped together.

Example scenario:

```id="j60g3s"
h + e + l + l + o
```

Each letter may be a separate stroke.

Grouping rules:

### Time proximity

Strokes drawn within a short time window belong to the same word.

Example threshold:

```id="pytdr1"
800 milliseconds
```

---

### Spatial proximity

Strokes that are close together horizontally are likely part of the same word.

Example rule:

```id="4i2o9o"
distance < character_width_threshold
```

---

After grouping:

```id="snj4fr"
wordCandidate = {
 strokes: [stroke1, stroke2],
 boundingBox: {...}
}
```

---

# 5. Handwriting Recognition

Grouped strokes are passed to a digital ink recognition engine.

Recommended engines:

* Google ML Kit Digital Ink Recognition
* MyScript iink SDK

Recognizer input format:

```json id="6y5qfe"
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

```json id="6ldqos"
{
 "text": "abc",
 "confidence": 0.92
}
```

---

# 6. Bounding Box Calculation

Each stroke group should produce a bounding box.

Bounding boxes allow navigation to the recognized word.

Example:

```id="ed67ep"
minX
maxX
minY
maxY
```

This allows the system to:

```id="pfm9rz"
highlight recognized text
zoom canvas to result
```

---

# 7. Recognition Storage

Recognition results must be persisted so they survive editor reloads.

The Tldraw store should not be modified directly.

Instead recognition results can be stored in the markdown document.

Example metadata block:

```id="59q67x"
<!-- tldraw-handwriting-index
shape:iQzNB4HB6nUwBK4hMf0p1 = "a"
shape:q6IgmlC3Z7JnfaGPiUXlv = "b"
shape:94zqqtdzWw3reavN9eSXr = "c"
-->
```

This allows Obsidian's search engine to index the recognized text automatically.

---

# 8. Navigation

When a search result is selected:

```id="53t7tm"
recognized word found
      │
      ▼
retrieve bounding box
      │
      ▼
zoom canvas
      │
      ▼
highlight region
```

The editor API can reposition the camera:

```id="h21j1v"
editor.setCamera()
```

---

# 9. Offline vs Cloud Recognition

Two operational modes are possible.

### Offline

Recognition runs locally.

Advantages:

```id="sgtzqs"
privacy
low latency
no API limits
```

---

### Cloud

Recognition runs via external APIs.

Advantages:

```id="d7tdg4"
better accuracy
larger models
```

Initial implementation should prefer **offline processing**.

---

# 10. Error Handling

Recognition systems are probabilistic.

The system should store:

```id="3q47qj"
recognized text
confidence score
```

Low confidence results may be ignored or reprocessed later.

---

# 11. Module Structure

Recommended code structure:

```id="6ndkkt"
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

```id="63d74e"
strokeListener   → detect draw shapes
strokeExtractor  → convert shape to stroke
strokeNormalizer → resample / normalize
strokeGrouping   → merge strokes into words
recognizer       → run ML recognition
indexer          → persist recognized text
```

---

# 12. Minimal Prototype

The first working prototype should implement only:

```id="q0fn4s"
stroke detection
stroke extraction
console logging
```

Example:

```id="1c7y16"
draw letter
↓
console.log(points)
```

Once stroke capture works, recognition can be added incrementally.

---

# Summary

The Tldraw data model stores freehand strokes as vector points inside draw shapes.

By observing store updates and extracting stroke geometry, it is possible to implement a handwriting recognition system that integrates naturally with the existing editor architecture.

This pipeline enables handwritten canvas content to become searchable inside Obsidian without modifying the underlying drawing engine.

---
