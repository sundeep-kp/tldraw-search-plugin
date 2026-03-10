
---

# example.md

## Example: How Handwritten Strokes are Stored in a Tldraw Obsidian File

This document demonstrates how freehand strokes drawn inside the **tldraw canvas embedded in Obsidian** are stored inside the markdown document.

We will use a simple example where three letters were drawn:

```
a   b   c
```

The goal is to understand:

* how strokes appear on the canvas
* how those strokes are serialized into the markdown file
* where handwriting recognition systems should extract vector data

---

# 1. Canvas Mode (Drawing View)

In canvas mode, the plugin displays the interactive tldraw editor.

The user draws three letters using the **freehand draw tool**.

## Example Canvas Drawing

![Canvas drawing example](images/canvas_abc.png)

Each letter is drawn using a single continuous stroke.

Internally this creates **three shapes of type `draw`**.

---

# 2. Markdown Mode (File Storage)

Tldraw drawings are stored inside a normal markdown file.

The markdown document contains a JSON block representing the **entire editor state**.

Example markdown view:

![Markdown storage view](images/markdown_storage.png)

Inside the markdown file you will find:

```
!!!_START_OF_TLDRAW_DATA__DO_NOT_CHANGE_THIS_PHRASE_!!!
```

followed by serialized JSON and ending with:

```
!!!_END_OF_TLDRAW_DATA__DO_NOT_CHANGE_THIS_PHRASE_!!!
```

This block contains the complete tldraw store.

---

# 3. Relevant Data Structure

The JSON block contains many records representing the document state.

The most important record type for handwriting is:

```
"type": "draw"
"typeName": "shape"
```

Example shape:

```json
{
  "id": "shape:iQzNB4HB6nUwBK4hMf0p1",
  "type": "draw",
  "typeName": "shape",
  "x": 802.2599,
  "y": -572.4574,
  "props": {
    "segments": [
      {
        "type": "free",
        "points": [
          { "x": 0, "y": 0, "z": 0.5 },
          { "x": -1.44, "y": -4.32, "z": 0.5 },
          { "x": -2.88, "y": -4.32, "z": 0.5 }
        ]
      }
    ],
    "color": "black",
    "size": "m",
    "isComplete": true
  }
}
```

---

# 4. Understanding Stroke Geometry

Each handwritten stroke is stored as:

```
shape
 └─ props
     └─ segments[]
          └─ points[]
```

Each point contains:

```
x → horizontal movement
y → vertical movement
z → pen pressure
```

Example stroke trajectory:

```
(0,0)
(-1.44,-4.32)
(-2.88,-4.32)
(-4.32,-5.76)
...
```

These points represent the **exact path of the pen**.

---

# 5. Relative vs Global Coordinates

Each shape has a global position:

```
shape.x
shape.y
```

But stroke points are **relative to the shape origin**.

Global position can be calculated as:

```
globalX = shape.x + point.x
globalY = shape.y + point.y
```

For handwriting recognition, relative coordinates are usually sufficient.

---

# 6. Number of Shapes Created

For the example drawing:

```
a   b   c
```

the document contains three draw shapes:

```
shape:iQzNB4HB6nUwBK4hMf0p1
shape:q6IgmlC3Z7JnfaGPiUXlv
shape:94zqqtdzWw3reavN9eSXr
```

Each shape corresponds to one letter.

---

# 7. Detecting Completed Strokes

Draw shapes include the flag:

```json
"isComplete": true
```

This indicates that the stroke is finished.

Recognition systems should process shapes only when:

```
props.isComplete == true
```

to avoid analyzing strokes while they are still being drawn.

---

# 8. Extracting Stroke Data

The minimal extraction algorithm is:

```
for each record in records:
    if record.type == "draw":
        segments = record.props.segments
        for segment in segments:
            points = segment.points
```

These points form the stroke trajectory.

---

# 9. Example Extracted Stroke

Example extracted stroke:

```
[
 (0,0),
 (-1.44,-4.32),
 (-2.88,-4.32),
 (-4.32,-5.76),
 ...
]
```

This can be converted into the format required by digital ink recognition systems.

Example recognizer input:

```json
{
  "strokes": [
    [
      {"x":0,"y":0,"t":0},
      {"x":-1.44,"y":-4.32,"t":1},
      {"x":-2.88,"y":-4.32,"t":2}
    ]
  ]
}
```

---

# 10. Why This Structure Is Ideal for Handwriting Recognition

The tldraw data model preserves:

```
stroke order
stroke geometry
pen pressure
stroke segmentation
```

This information is typically lost when using image-based OCR.

Because strokes are stored as vector data, they can be directly processed by digital ink recognition systems.

---

# 11. Relationship to the Recognition Pipeline

The handwriting recognition extension will observe shapes of type `draw`.

Pipeline:

```
editor.store
↓
detect new draw shape
↓
extract stroke points
↓
run recognizer
↓
store recognized text
```

The recognized text can then be indexed for search inside Obsidian.

---

# 12. Summary

The tldraw Obsidian plugin stores handwritten strokes as structured vector data inside markdown files.

Key properties:

```
vector-based stroke representation
stroke completion flag
relative coordinate storage
multi-segment stroke support
```

This structure provides a clean foundation for implementing **searchable handwritten notes**.

---
