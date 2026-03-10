Below is a **clean, fully regenerated version** of `recognition_pipeline.md` that incorporates everything we decided:

* markdown **index block storage**
* **word entities**
* **bounding box schema**
* separation between **geometry and semantics**
* clearer pipeline stages
* explicit module responsibilities


---

# recognition_pipeline.md

## Handwriting Recognition Pipeline for Tldraw in Obsidian

This document describes the architecture and execution pipeline for enabling **searchable handwritten notes** inside the **tldraw canvas embedded in Obsidian**.

The system observes freehand strokes drawn on the canvas, performs handwriting recognition, and stores recognized words in a searchable index embedded within the markdown document.

The recognition system is designed to be **non-intrusive**, meaning it does not modify the underlying drawing engine or stroke geometry.

---

# System Overview

The handwriting recognition system operates as an **observer layer** on top of the existing Tldraw editor.

Instead of modifying the editor, the system listens to store updates and processes newly created draw shapes.

Core responsibilities:

```
detect completed strokes
extract stroke geometry
group strokes into word candidates
run handwriting recognition
store results in a searchable index
```

The stroke geometry stored by Tldraw remains untouched.

---

# Pipeline Architecture

The recognition pipeline follows this sequence:

```
User draws stroke
      │
      ▼
Tldraw creates draw shape
      │
      ▼
editor.store update event
      │
      ▼
Stroke listener detects completed stroke
      │
      ▼
Stroke geometry extracted
      │
      ▼
Stroke normalization
      │
      ▼
Stroke grouping
      │
      ▼
Handwriting recognition
      │
      ▼
Word entity created
      │
      ▼
Bounding box calculated
      │
      ▼
Markdown index updated
```

---

# 1. Stroke Detection

The Tldraw editor maintains all canvas state inside an internal store.

The plugin observes this store using:

```
editor.store.listen()
```

A stroke is detected when a new shape satisfies:

```
shape.type === "draw"
AND
shape.props.isComplete === true
```

This ensures recognition runs only after the user finishes drawing.

---

# 2. Stroke Extraction

Each draw shape stores stroke geometry using segments.

Structure:

```
shape
 └ props
    └ segments[]
       └ points[]
```

Example point:

```json
{
  "x": number,
  "y": number,
  "z": number
}
```

Where:

```
x → horizontal position
y → vertical position
z → pen pressure
```

Points are stored **relative to the shape origin**.

For recognition purposes the system extracts simplified strokes:

```
stroke = [
  [x1, y1],
  [x2, y2],
  [x3, y3]
]
```

Pressure values are optional.

---

# 3. Stroke Normalization

Raw strokes may contain hundreds of points.

Normalization improves recognition performance.

Typical operations:

### Resampling

Reduce point count.

Target:

```
30–80 points per stroke
```

---

### Coordinate normalization

Convert strokes to a consistent scale.

Example:

```
0 ≤ x ≤ 1
0 ≤ y ≤ 1
```

---

### Optional smoothing

Remove stylus jitter.

---

# 4. Stroke Grouping

Handwriting recognition typically operates on **words rather than individual strokes**.

However Tldraw generates **one shape per continuous pen stroke**.

Example:

```
h + e + l + l + o
```

Each letter may be a separate stroke.

The grouping module combines nearby strokes into **word candidates**.

Grouping criteria include:

### Temporal proximity

```
time difference < 800ms
```

---

### Spatial proximity

```
horizontal distance < character_width_threshold
```

---

After grouping:

```
wordCandidate = {
 strokes: [stroke1, stroke2, stroke3]
}
```

---

# 5. Handwriting Recognition

Grouped strokes are passed to a digital ink recognition engine.

Example recognizers:

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
  "confidence": 0.94
}
```

---

# 6. Word Entity Creation

Recognition results are converted into **word entities**.

Example structure:

```
WordEntry
 ├ id
 ├ text
 ├ confidence
 ├ pageId
 ├ shapeIds[]
 └ bbox
```

Field descriptions:

```
id           internal identifier
text         recognized word
confidence   recognizer confidence score
pageId       canvas page
shapeIds     strokes composing the word
bbox         word bounding box
```

---

# 7. Bounding Box Calculation

Each word entity includes a bounding box used for navigation and highlighting.

Bounding box format:

```
bbox = {
  minX,
  minY,
  maxX,
  maxY
}
```

Coordinates are calculated using **absolute canvas coordinates**:

```
globalX = shape.x + point.x
globalY = shape.y + point.y
```

Bounding boxes allow the system to:

```
highlight recognized words
navigate to search results
zoom canvas automatically
```

---

# 8. Recognition Storage

Recognition results are stored inside the markdown document using a **hidden index block**.

Example:

```
<!-- tldraw-handwriting-index:start -->
{
  "version": 1,
  "words": [
    {
      "id": "word_1",
      "text": "hello",
      "confidence": 0.94,
      "pageId": "page:page",
      "shapeIds": ["shape:abc","shape:def"],
      "bbox": {
        "minX": 100,
        "minY": 200,
        "maxX": 180,
        "maxY": 230
      }
    }
  ]
}
<!-- tldraw-handwriting-index:end -->
```

Advantages:

```
portable
version-controlled
compatible with Obsidian
safe from schema changes
```

This index allows handwritten words to be searchable.

---

# 9. Search Navigation

When a search result is selected:

```
recognized word found
      │
      ▼
retrieve bounding box
      │
      ▼
move canvas camera
      │
      ▼
highlight strokes
```

Camera repositioning example:

```
editor.setCamera({
  x: (minX + maxX)/2,
  y: (minY + maxY)/2,
  zoom: 2
})
```

---

# 10. Offline vs Cloud Recognition

Two recognition modes are possible.

### Offline recognition

Advantages:

```
privacy
low latency
no API rate limits
```

---

### Cloud recognition

Advantages:

```
higher accuracy
larger language models
```

Initial implementation should prefer **offline recognition**.

---

# 11. Module Structure

Recommended implementation structure:

```
src/
  handwriting/
    strokeListener.ts
    strokeExtractor.ts
    strokeNormalizer.ts
    strokeGrouping.ts
    recognizer.ts
    wordIndexer.ts
    markdownIndexManager.ts
```

Responsibilities:

```
strokeListener         detect draw shapes
strokeExtractor        extract stroke geometry
strokeNormalizer       normalize stroke points
strokeGrouping         group strokes into words
recognizer             run handwriting recognition
wordIndexer            create word entities
markdownIndexManager   update document index
```

---

# 12. Minimal Prototype

The first working prototype should implement only:

```
stroke detection
stroke extraction
console logging
```

Example workflow:

```
draw letter
↓
stroke detected
↓
console.log(points)
```

Once stroke capture works reliably, recognition and indexing can be added incrementally.

---

# Summary

The Tldraw editor stores handwritten strokes as vector paths inside draw shapes.

By observing editor state changes and processing stroke geometry externally, the plugin can implement handwriting recognition without modifying the drawing engine.

The final system transforms handwritten strokes into **searchable knowledge inside Obsidian** while maintaining compatibility with the existing Tldraw data model.
