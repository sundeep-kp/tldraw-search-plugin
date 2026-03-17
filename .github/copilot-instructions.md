# Project Guidelines

## Workspace Layout

- This workspace has two main parts: `plan/` contains the handwriting-recognition design and execution notes, while `tldraw-handwriting-rec-plugin-obsidian/` contains the actual Obsidian plugin code.
- For implementation work, treat `tldraw-handwriting-rec-plugin-obsidian/` as the application root. Use `plan/` as the design reference for the handwriting feature, not as evidence that a module already exists.

## Architecture

- `tldraw-handwriting-rec-plugin-obsidian/src/main.ts` is the Obsidian plugin entry point. It registers views, commands, settings, and top-level integration points.
- `tldraw-handwriting-rec-plugin-obsidian/src/obsidian/` contains the Obsidian-specific view, file, settings, and plugin adapters.
- `tldraw-handwriting-rec-plugin-obsidian/src/components/TldrawApp.tsx` mounts the `Tldraw` React editor. Editor lifecycle integrations should usually start here.
- `tldraw-handwriting-rec-plugin-obsidian/src/handwriting/` is currently only a thin scaffold. `strokeListener.ts` and `strokeExtractor.ts` log and extract raw draw-shape data, but the recognition pipeline, grouping, indexing, and search integration described in `plan/` are not implemented yet.
- Preserve the existing split between Obsidian integration code, React UI code, and tldraw/editor helpers instead of adding cross-cutting logic ad hoc.

## Build And Validation

- Run Node commands from `tldraw-handwriting-rec-plugin-obsidian/`.
- Install dependencies with `npm install`. Postinstall applies `patch-package` patches required by the pinned tldraw version.
- Use `npm run dev` for development builds and `npm run build` for production builds.
- Use `npm run lint` for validation. There is no dedicated automated test suite in this repo at the moment.
- Use `npm run package` and `npm run make-release-files` only when the task affects release artifacts.

## Conventions

- Keep changes minimal and consistent with the existing TypeScript, React, and Obsidian plugin patterns.
- Do not edit generated build output unless the task explicitly targets generated artifacts.
- Edit `tldraw-handwriting-rec-plugin-obsidian/src/styles.css` instead of compiled root-level styles when changing plugin styling.
- Preserve the custom patches under `tldraw-handwriting-rec-plugin-obsidian/patches/`; this project depends on patched `tldraw` packages.
- When working on handwriting recognition, verify behavior against the current source before relying on the design docs in `plan/execution/`.

## Key References

- See `README.md` for the project goal and repository map.
- See `plan/plan.md`, `plan/data-flow-overview`, and `plan/execution/` for the intended handwriting-recognition architecture.
- See `tldraw-handwriting-rec-plugin-obsidian/README.md` for plugin development and release workflow.