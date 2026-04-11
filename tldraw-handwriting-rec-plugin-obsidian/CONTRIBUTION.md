# Contributing to tldraw Handwriting Recognition Plugin

## Project Overview

This Obsidian plugin integrates tldraw canvas editor with online handwriting recognition (HTR), allowing users to draw and have their handwriting automatically convert to recognized shapes within tldraw files.

## Architecture

### Core Folders

- **`src/main.ts`**: Plugin entry point; registers views, commands, settings, and top-level lifecycle
- **`src/obsidian/`**: Obsidian-specific integration (file I/O, settings, UI adapters, views)
- **`src/components/`**: React components, primarily `TldrawApp.tsx` (editor mount and lifecycle)
- **`src/tldraw/`**: Editor customization (tools, rendering overrides, UI modifications)
- **`src/handwriting/`**: Recognition pipeline modules (recognition, batching, preprocessing)
- **`src/hooks/`**: React hooks for app effects and state management

### Architecture Boundaries

- **Obsidian layer** (`src/obsidian/`) handles Obsidian-specific concerns (vault files, settings UI, menu integration)
- **Tldraw layer** (`src/tldraw/`) customizes the editor (tools, rendering, UI panel overrides)
- **Handwriting layer** (`src/handwriting/`) manages recognition pipeline and result caching
- Each layer should be isolated; avoid cross-cutting concerns between layers

## Current Focus Areas

### 1. Handwriting Recognition Pipeline

**Status**: Implemented and optimized

- **Recognition Engine**: Google IME (`'google-ime-js'`) for online handwriting, with ONNX model fallback capability
- **Batching Strategy**: Groups pending strokes into batches using configurable policies (`DEFAULT_BATCH_POLICY`)
- **Preprocessing**: Normalizes stroke input using online HTR preprocessing (line interpolation, motion features)
- **Result Caching**: Stores recognition results by fingerprint to avoid redundant recognition runs
- **Engine Fallback**: Reverted to `'stub'` fallback (not expensive Google IME) to optimize performance

### 2. Performance Optimizations

**Status**: Completed

- **Bitmap Conversion**: Once recognized, draw shapes are converted to optimized bitmaps
- **Recognition Gating**: Recognition is only triggered after stroke completion; no camera-motion override
- **Sync Consolidation**: `syncPerformancePathAfterRecognition` consolidated to 2 call sites (mount + end of recognition run) instead of 9
- **Memory Management**: Pressure store sessions cleaned up after recognition completes

### 3. Drawing Tools

**Status**: Implemented with alt+drag brush scrub

- **Pencil Tool**: Custom tool (`id='pencil'`) with alt+drag brush size adjustment (hardware stylus context)
- **Pen Tool**: Custom tool (`id='pen'`) with matching alt+drag brush scrub feature
- **Brush Scrub**: When Alt is held during stylus contact, horizontal drag adjusts brush size
- **Tool Registration**: Both tools registered in `BaseTldrawFileView.getTldrawOptions()` 

### 4. Stroke Listener Reliability

**Status**: Hardened and integrated

- **Completion Gating**: Listener only fires after stroke completion (not during drawing)
- **Deduplication**: Strokes checked against existing shapes to avoid duplicate recognition
- **Lifecycle Management**: `useStrokeListener` hook ensures cleanup on unmount
- **Integration**: Called once per recognition batch from `syncPerformancePathAfterRecognition`

## Known Disabled Features

### Krita Brush Support

**Status**: Disabled (can reactivate if needed)

All Krita-related code is commented out:
- Krita preset import/export UI (`KritaBrushPresetPanel` - lines 477-621 in TldrawApp.tsx)
- Krita brush style derivation (`deriveKritaPresetStyle` - commented)
- Krita runtime context and preset types (commented)
- Krita CSS styling (commented in src/styles.css)

To re-enable: Uncomment the marked sections in TldrawApp.tsx and src/styles.css

## Development Workflow

### Building

```bash
npm run build
```

Compiles TypeScript and applies patches from `patches/` directory (required for custom tldraw modifications).

### Development

```bash
npm run dev
```

Runs watch mode for local testing. Load the plugin in Obsidian using the plugin development settings.

### Linting

```bash
npm run lint
```

Runs ESLint on source files. Fix issues before committing.

### Testing Scenarios

Manual testing focuses on:
1. Drawing with pencil and pen tools separately
2. Alt+drag with stylus to adjust brush size
3. Handwriting recognition on completed strokes
4. Pressure sensitivity (if supported by device)
5. Performance with large canvas (many shapes)
6. Switching between tools and brush sizes

## Common Tasks

### Adding a New Drawing Tool

1. Create a new tool class in `src/tldraw/tools/` extending `DrawShapeTool`
2. Register in `BaseTldrawFileView.getTldrawOptions()` under `tools` array
3. If you want alt+drag brush scrub, add a React effect similar to pencil/pen handling in `TldrawApp.tsx` (see lines ~3462-3850)

### Adding Recognition Engine Variants

1. Update `src/handwriting/recognizer.ts` to support new engine configuration
2. Modify preprocessing in `src/handwriting/pipeline.ts` if needed for new engine
3. Update result caching fingerprint logic to account for engine differences

### Debugging Recognition

- Enable `userSettings.debugMode` in plugin settings
- Check browser console for recognition logging ("handwriting" topic)
- Use `OnlineHTR/scripts/logits_diagnostics.py` for model-level debugging (see OnlineHTR README)

## Build & Release

### Pre-release Checklist

- [ ] Run `npm run lint` — no linting errors
- [ ] Run `npm run build` — compiles successfully
- [ ] Manual test core scenario (draw -> recognize)
- [ ] Update `manifest.json` version and `versions.json`

### Release Files

```bash
npm run make-release-files
```

Generates release artifacts in `release/` folder.

## References

- **Plugin**: [README.md](README.md) for setup and user guide
- **Handwriting Models**: [OnlineHTR/README.md](../OnlineHTR/README.md) and [LstmOnlineHTR/README.md](../LstmOnlineHTR/README.md)
- **Workspace Planning**: [plan/plan.md](../plan/plan.md) and [plan/data-flow-overview](../plan/data-flow-overview)

## Architecture Principles

1. **Preserve Layer Separation**: Keep Obsidian, tldraw, and handwriting concerns isolated
2. **Minimize Custom Patches**: Use tldraw customization APIs before resorting to monkey-patching
3. **Performance-First**: Test with large canvases; prefer bitmap rendering over node rendering
4. **Graceful Degradation**: Fallback engines should work if primary engine unavailable
5. **Clean Lifecycle**: Ensure effects, listeners, and stores are properly cleaned up
