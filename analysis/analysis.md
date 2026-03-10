# analysis.md

## Architecture Analysis of the Official Tldraw Obsidian Plugin

### Overview

The **tldraw Obsidian plugin** integrates the tldraw canvas editor directly into **Obsidian** as a custom file type.

It allows users to create and edit drawings that behave like native Obsidian documents.  
Each drawing is stored as a **markdown file containing serialized tldraw state**.

The plugin acts as a bridge between:

- Obsidian plugin system
- React UI
- tldraw editor runtime
- markdown file storage

---

### High Level Architecture

The runtime flow of the plugin is:

```
Obsidian Plugin
      │
      │
      ▼
main.ts
(register plugin + views)
      │
      ▼
TldrawView.ts
(Obsidian file view)
      │
      ▼
React root
      │
      ▼
TldrawApp.tsx
(React wrapper)
      │
      ▼
<Tldraw />
(editor instance)
      │
      ▼
editor.store
(tldraw state manager)
      │
      ▼
serialization
      │
      ▼
markdown file in vault
```

---

### Plugin Initialization

The plugin entry point is:

```
src/main.ts
```

This file:

- registers the plugin with Obsidian
- registers commands
- registers the **Tldraw file view**
- initializes plugin settings

Typical initialization pattern:

```typescript
export default class TldrawPlugin extends Plugin
```

Inside `onload()` the plugin registers:

- `TldrawView`
- settings tab
- commands
- markdown processors

---

### Tldraw File View

The file view is implemented in:

```
src/obsidian/TldrawView.ts
```

This class extends an Obsidian file view and is responsible for:

- opening tldraw files
- creating React root
- mounting canvas
- loading document data

When a `.tldraw` markdown file is opened:

```
Obsidian
↓
TldrawView created
↓
React component mounted
↓
Tldraw editor rendered
```

---

### React Canvas Layer

The canvas UI is implemented in:

```
src/components/TldrawApp.tsx
```

This component renders the editor:

```tsx
<Tldraw />
```

This is the core editor component provided by the tldraw library.

The component:

- initializes the editor
- loads the document store
- connects UI elements
- handles editor lifecycle

---

### Tldraw Editor Runtime

The tldraw editor maintains application state using a **store system**.

The store tracks:

- shapes
- pages
- camera
- pointer
- instance state
- assets

This state is accessed via:

```javascript
editor.store
```

The store emits updates whenever changes occur.

Examples:

- shape created
- shape modified
- shape deleted
- camera moved
- selection changed

These events allow external modules to observe canvas activity.

---

### Shape System

All visual elements inside the canvas are represented as **shapes**.

Examples of shape types include:

- `text`
- `geo`
- `arrow`
- `image`
- `draw`
- `note`
- `frame`

The shape relevant for handwriting is:

```
type: "draw"
```

Draw shapes represent **freehand strokes** created using the pen tool.

---

### Freehand Stroke Representation

A freehand stroke shape has the following structure:

```json
shape
 ├─ type: "draw"
 ├─ props
 │    ├─ segments
 │    │    └─ points[]
 │    │
 │    ├─ color
 │    ├─ size
 │    ├─ fill
 │    └─ scale
```

Each segment contains multiple points.

Example point:

```json
{
  x: number,
  y: number,
  z: number
}
```

Where:

- `x` → horizontal movement
- `y` → vertical movement
- `z` → pen pressure

Points are stored **relative to the shape origin**.

Global position is defined by:

```
shape.x
shape.y
```

---

### Persistence Model

Unlike many drawing tools, the plugin does not store drawings as images.

Instead it serializes the **entire tldraw store** into JSON embedded inside a markdown file.

Example structure:

```
markdown content
↓
JSON block
↓
!!!_START_OF_TLDRAW_DATA__DO_NOT_CHANGE_THIS_PHRASE_!!!
{
  meta: {...},
  raw: {...}
}
!!!_END_OF_TLDRAW_DATA__DO_NOT_CHANGE_THIS_PHRASE_!!!
```

The `raw` section contains the full store state including:

- document
- pages
- shapes
- camera
- instance state

This allows drawings to remain:

- versionable
- human readable
- portable

---

### Runtime Storage

The plugin also uses an IndexedDB layer.

Relevant modules:

- `src/tldraw/indexeddb-store.ts`
- `src/tldraw/TldrawStoresManager.ts`

This enables:

- fast local editing
- autosave
- state restoration

The IndexedDB store is eventually synchronized with the markdown document.

---

### Important Observation Points

The plugin exposes several useful observation points for extensions.

**Editor Instance**  
The editor instance is created inside:

```
TldrawApp.tsx
```

This instance exposes:

- `editor.store`
- `editor.getShape()`
- `editor.getCurrentPageShapes()`

**Store Listener**  
The store allows subscriptions:

```javascript
editor.store.listen()
```

This allows extensions to detect:

- shape creation
- shape updates
- shape deletion

This mechanism is ideal for implementing handwriting recognition.

---

### Handwriting Integration Strategy

A handwriting recognition system can be implemented as an **observer layer**.

Pipeline:

```
editor.store
↓
detect draw shapes
↓
extract stroke points
↓
run recognizer
↓
store recognized text
```

The recognizer should process only shapes where:

```
props.isComplete == true
```

to ensure strokes are finished.

---

### Recognition Metadata

Recognition results should not modify the tldraw store directly.

Instead metadata can be stored inside the markdown document.

Example:

```html
<!-- tldraw-handwriting-index
shape-id = recognized-text
-->
```

This allows Obsidian's search engine to index handwritten content.

---

### Extension Architecture

The extension layer should be implemented as independent modules.

Recommended structure:

```
src/handwriting
  stroke-listener.ts
  stroke-grouping.ts
  recognizer.ts
  indexer.ts
```

These modules should interact with the editor without modifying the tldraw core.

---

### Summary

The official tldraw plugin integrates a full canvas editor into Obsidian while preserving document portability through markdown serialization.

Key architectural properties:

- React-based canvas editor
- state managed by tldraw store
- vector stroke representation
- markdown persistence
- event-based store updates

These properties make the plugin an ideal foundation for implementing **searchable handwritten notes**.

The store listener system provides a clean extension point for observing freehand strokes and running handwriting recognition without modifying the core drawing engine.

---
