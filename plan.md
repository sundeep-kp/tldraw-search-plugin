# Searchable Handwritten Notes for Obsidian using tldraw and Digital Ink Recognition

## Problem Statement

Modern knowledge tools such as Obsidian are excellent for typed notes, but they struggle with handwritten or diagrammatic thinking.

Many users prefer sketching ideas, drawing systems diagrams, or writing with a stylus on an infinite canvas. Tools like:

- Excalidraw
- tldraw

allow freeform drawing inside Obsidian. However, handwritten content inside these canvases is **not searchable**. Users cannot:

- search handwritten words
- quickly locate handwritten notes
- index their diagrams or scribbles

This creates a gap in knowledge management systems. A user may draw an important diagram or write a concept by hand, but later cannot find it through search.

## Existing Solutions and Their Limitations

Some plugins attempt to solve this with OCR (Optical Character Recognition).

Typical workflow:

```
drawing
↓
export canvas as image
↓
OCR engine
↓
recognized text
```

This approach has several problems:

**Loss of stroke data**  
Handwriting on digital canvases contains rich information:
- (x, y) coordinates
- stroke order
- stroke timing
- pressure

Image OCR discards this information.

**Lower recognition accuracy**  
Handwriting recognition engines perform better when they receive vector strokes rather than images.

**Manual workflows**  
Many OCR systems require:

```
user presses OCR button
↓
image processed
↓
text extracted
```

This interrupts the note-taking workflow.

**Cloud dependency**  
Many OCR systems rely on external APIs, raising concerns about:
- privacy
- latency
- API limits

## Proposed Solution

Instead of image OCR, this project uses **digital ink recognition** (online handwriting recognition).

Digital ink recognition processes native stylus stroke vectors rather than images.

Pipeline:

```
pen stroke
↓
stroke vector captured
↓
handwriting recognition engine
↓
recognized text
↓
search index updated
```

This allows handwritten content to become searchable automatically and in real time.

Users will be able to:

- write notes by hand
- use Ctrl+F or Obsidian search
- jump to the handwritten word

This creates a system similar to handwriting search features in advanced note apps like:

- Microsoft OneNote
- Nebo

but implemented inside Obsidian using open tools.

## Why We Chose This Architecture

**Reason 1 — Preserve vector stroke data**  
Digital handwriting contains:
- stroke order
- stroke grouping
- pen movement

Using vector recognition improves accuracy.

**Reason 2 — Real-time indexing**  
Recognition can happen automatically after a word or stroke group is completed.

```
user writes
↓
recognition runs
↓
search index updated
```

No manual export required.

**Reason 3 — Better user experience**  
Users interact naturally with the canvas. They do not need to trigger OCR manually.

**Reason 4 — Offline capability**  
Many digital ink engines can run locally, allowing:
- privacy
- no API limits
- low latency

## Why tldraw Was Selected

The canvas engine used is **tldraw**.

tldraw was chosen because:

- It exposes a programmable editor API
- It allows listening to shape and stroke events
- It stores drawings as vector stroke data
- It is designed as a canvas framework, not just a drawing tool

Example event hook:

```javascript
editor.store.listen()
```

This allows the plugin to capture stroke data as users draw.

Other tools like Excalidraw use canvas rendering and expose fewer stroke-level APIs.

## System Architecture

High-level architecture:

```
Obsidian Plugin
      │
      │
      ├── tldraw canvas
      │
      ├── stroke listener
      │
      ├── handwriting recognizer
      │
      ├── recognition index
      │
      └── search integration
```

Pipeline:

```
user writes stroke
↓
stroke data captured
↓
strokes grouped into word candidates
↓
recognizer predicts text
↓
text stored in index
↓
search finds handwritten words
```

### Core Features

The system should support:

1. **Handwritten canvas inside Obsidian**  
   Users can draw freely using stylus or mouse.

2. **Stroke capture**  
   When a stroke is created, stroke vectors are extracted.

3. **Stroke grouping**  
   Strokes belonging to the same word are grouped based on:
   - distance threshold
   - time threshold

4. **Handwriting recognition**  
   Grouped strokes are sent to a digital ink recognizer.  
   Possible recognizers include:
   - Google ML Kit Digital Ink Recognition
   - MyScript iink SDK

5. **Search indexing**  
   Recognized text is stored in a searchable format.  
   Possible methods:
   - hidden markdown block
   - separate index file

6. **Navigation**  
   When a search result is selected, the canvas zooms to the bounding box of the word.

## Tech Stack

**Host Environment**
- Ubuntu 22.04
- Node.js
- pnpm package manager

**Application Platform**
- Obsidian

**Canvas Engine**
- tldraw  
  Key libraries:
  - `@tldraw/tldraw`
  - `react`
  - `react-dom`

**Programming Language**
- TypeScript

**Plugin Framework**
- Obsidian plugin API  
  Key files:
  - `manifest.json`
  - `main.ts`

**Build Tools**
- pnpm
- esbuild

**Handwriting Recognition**
Possible engines:
- Google ML Kit Digital Ink Recognition
- MyScript iink SDK

The recognizer should accept stroke vectors in the form:
- x coordinate
- y coordinate
- timestamp

## Data Model

Stroke example:

```javascript
stroke = [
  {x:10, y:20, t:100},
  {x:15, y:25, t:110}
]
```

Recognized entry:

```json
{
  text: "motor",
  bounds: [x, y, width, height],
  confidence: 0.92
}
```

## Development Goal

Build an Obsidian plugin that enables:
- handwritten notes
- automatic handwriting recognition
- searchable canvas

The final result should allow users to search their handwritten diagrams and notes as easily as typed text.

---

**Note:** The idea is to use an existing Obsidian plugin: [https://github.com/tldraw/obsidian-plugin](https://github.com/tldraw/obsidian-plugin) instead of coding from scratch and going through dependency hell of supporting different platforms like iPads and pen tablets.