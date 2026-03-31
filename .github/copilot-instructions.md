# Project Guidelines

## Workspace Layout

- This workspace has four major areas:
- `tldraw-handwriting-rec-plugin-obsidian/` is the Obsidian plugin application root.
- `plan/` contains handwriting-recognition design and execution notes.
- `OnlineHTR/` contains the primary PyTorch/Lightning online handwriting model code and diagnostics.
- `LstmOnlineHTR/` contains an alternate BiLSTM+CTC training pipeline.
- For plugin implementation tasks, treat `tldraw-handwriting-rec-plugin-obsidian/` as the source of truth and use `plan/` as design reference only.

## Architecture

- `tldraw-handwriting-rec-plugin-obsidian/src/main.ts` is the Obsidian plugin entry point. It registers views, commands, settings, and top-level integration points.
- `tldraw-handwriting-rec-plugin-obsidian/src/obsidian/` contains the Obsidian-specific view, file, settings, and plugin adapters.
- `tldraw-handwriting-rec-plugin-obsidian/src/components/TldrawApp.tsx` mounts the `Tldraw` React editor. Editor lifecycle integrations should usually start here.
- `tldraw-handwriting-rec-plugin-obsidian/src/tldraw/` contains editor-level stores, tools, and UI overrides. Keep low-level editor customization here.
- `tldraw-handwriting-rec-plugin-obsidian/src/handwriting/` is partially implemented. Validate current module behavior in source before assuming design-doc features from `plan/` are live.
- Preserve the existing split between Obsidian integration code, React UI code, and tldraw/editor helpers instead of adding cross-cutting logic ad hoc.

## Build And Validation

- Run Node commands from `tldraw-handwriting-rec-plugin-obsidian/`.
- Install dependencies with `npm install`. Postinstall applies `patch-package` patches required by the pinned tldraw version.
- Use `npm run dev` for development builds and `npm run build` for production builds.
- Use `npm run lint` for validation. There is no dedicated automated test suite in this repo at the moment.
- Use `npm run package` and `npm run make-release-files` only when the task affects release artifacts.
- Run Python model commands from their own project roots, not from the plugin folder.
- In `OnlineHTR/`, use `make` targets (`make train`, `make test-installation`, `make test-full`, diagnostics targets) or project scripts.
- In `LstmOnlineHTR/`, use `python scripts/train.py`, `python scripts/evaluate.py`, and related scripts.

## Practical Workflow

- For plugin tasks, validate with `npm run build` before finishing. Use `npm run lint` when touching TypeScript/React code.
- If a plugin/UI change is not visible, reload the plugin in Obsidian after rebuilding because cached plugin code can mask updates.
- Keep model/runtime checks scoped to the correct project root (`OnlineHTR/` or `LstmOnlineHTR/`) and do not mix their environments.

## Current Status And Pitfalls

- The handwriting-recognition design in `plan/` is aspirational in parts. Verify implementation status in `tldraw-handwriting-rec-plugin-obsidian/src/handwriting/` before assuming full pipeline behavior exists.
- `OnlineHTR/ROOTCAUSE_ANALYSIS_PLAN.md` documents known recognition issues (for example blank-class dominance and single-character mismatch). Treat this as active known-risk context during model work.
- In `OnlineHTR/`, compatibility caveats may apply (for example NumPy 2.x API removals and PyTorch checkpoint-loading behavior changes). Prefer project scripts/Make targets and existing code patterns over ad hoc environment changes.

## Conventions

- Keep changes minimal and consistent with the existing TypeScript, React, and Obsidian plugin patterns.
- Do not edit generated build output unless the task explicitly targets generated artifacts.
- Edit `tldraw-handwriting-rec-plugin-obsidian/src/styles.css` instead of compiled root-level styles when changing plugin styling.
- Preserve the custom patches under `tldraw-handwriting-rec-plugin-obsidian/patches/`; this project depends on patched `tldraw` packages.
- When working on handwriting recognition, verify behavior against the current source before relying on the design docs in `plan/execution/`.
- Avoid manual edits to `tldraw-handwriting-rec-plugin-obsidian/release/manifest.json` and `tldraw-handwriting-rec-plugin-obsidian/release/versions.json`; generate them via `npm run make-release-files`.

## Source-Of-Truth Rules

- For release workflow details, prioritize `tldraw-handwriting-rec-plugin-obsidian/README.md` over abbreviated summaries elsewhere.
- For plugin implementation decisions, prioritize code under `tldraw-handwriting-rec-plugin-obsidian/src/` over planning docs.
- When docs disagree, prefer the nearest project-local README/instructions in this order: subproject README/instructions, then workspace `.github/copilot-instructions.md`, then high-level planning docs.

## Key References

- See `README.md` for the project goal and repository map.
- See `plan/plan.md`, `plan/data-flow-overview`, and `plan/execution/` for the intended handwriting-recognition architecture.
- See `tldraw-handwriting-rec-plugin-obsidian/README.md` for plugin development and release workflow.
- See `OnlineHTR/README.md` and `OnlineHTR/Makefile` for model training/evaluation and diagnostics workflow.
- See `LstmOnlineHTR/README.md` for the alternate BiLSTM+CTC pipeline.