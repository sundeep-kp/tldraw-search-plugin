# Workspace Agent Instructions

## Scope And Source Of Truth

- This workspace has four major areas:
	- `tldraw-handwriting-rec-plugin-obsidian/` (Obsidian plugin app root)
	- `plan/` (design docs and execution notes)
	- `OnlineHTR/` (PyTorch Lightning handwriting model)
	- `LstmOnlineHTR/` (alternate BiLSTM+CTC pipeline)
- For plugin implementation, treat `tldraw-handwriting-rec-plugin-obsidian/src/` as source of truth.
- Treat `plan/` as design reference only; parts are aspirational and not fully implemented.
- When docs disagree, prefer: nearest subproject README/instructions, then this file, then high-level planning docs.

## Command Quick Reference

### Plugin (`tldraw-handwriting-rec-plugin-obsidian/`)

- Run Node commands from `tldraw-handwriting-rec-plugin-obsidian/`.
- Required setup: `npm install` (postinstall applies `patch-package` patches).
- Development: `npm run dev`
- Production build: `npm run build`
- Lint: `npm run lint`
- Package artifacts: `npm run package`
- Release files: `npm run make-release-files`

### OnlineHTR (`OnlineHTR/`)

- Run commands from `OnlineHTR/`.
- Use project `make` targets where possible.
- Common commands:
	- `make test-installation`
	- `make train`
	- `make test-full`
	- `python src/eval.py --config-name eval.yaml ckpt_path=<path>`
	- diagnostics targets in `Makefile` (for example `logits-diagnostics`, `preprocess-validation`)

### LstmOnlineHTR (`LstmOnlineHTR/`)

- Run commands from `LstmOnlineHTR/`.
- Common commands:
	- `python scripts/train.py --config config/model_config.yaml`
	- `python scripts/evaluate.py --checkpoint <ckpt> --data <dir>`
	- `python scripts/infer.py --input <json> --checkpoint <ckpt>`

## Plugin Architecture Boundaries

- `src/main.ts`: Obsidian plugin entry point; registers views, commands, settings, and top-level integration.
- `src/obsidian/`: Obsidian-specific integration (views, file I/O, settings, adapters, commands).
- `src/components/TldrawApp.tsx`: React editor mount and lifecycle integration point.
- `src/tldraw/`: editor-level tools, stores, and UI overrides.
- `src/handwriting/`: recognition-related pipeline modules; verify feature status in code before assuming docs are implemented.
- Preserve this separation instead of introducing cross-cutting logic ad hoc.

## Conventions

- Keep changes minimal and aligned with existing TypeScript/React/Obsidian patterns.
- Do not edit generated outputs unless the task explicitly targets generated artifacts.
- Edit `tldraw-handwriting-rec-plugin-obsidian/src/styles.css` for styling; do not edit compiled root-level `styles.css`.
- Preserve custom patches under `tldraw-handwriting-rec-plugin-obsidian/patches/`.
- Avoid manual edits to:
	- `tldraw-handwriting-rec-plugin-obsidian/release/manifest.json`
	- `tldraw-handwriting-rec-plugin-obsidian/release/versions.json`
	- Generate them through release scripts.

## Validation Workflow

- For plugin TypeScript/React changes, run:
	- `npm run lint` (when code paths touched are linted)
	- `npm run build` before finishing
- If UI changes do not appear, rebuild and reload the plugin in Obsidian (plugin caching can hide updates).
- Keep Python/model checks scoped to their own project roots; do not mix OnlineHTR and LstmOnlineHTR environments.

## Known Pitfalls

- `plan/` and `plan/execution/` may describe not-yet-implemented functionality.
- `OnlineHTR/ROOTCAUSE_ANALYSIS_PLAN.md` documents active risks (for example blank-class dominance and single-character mismatch).
- `OnlineHTR/` has compatibility caveats (for example NumPy 2.x API removals and PyTorch checkpoint-loading behavior changes).
- Prefer existing scripts and Make targets over ad hoc environment or pipeline changes.

## Key References

- `README.md` (workspace map and intent)
- `tldraw-handwriting-rec-plugin-obsidian/README.md` (plugin dev and release workflow)
- `tldraw-handwriting-rec-plugin-obsidian/src/main.ts` (plugin entrypoint)
- `tldraw-handwriting-rec-plugin-obsidian/src/components/TldrawApp.tsx` (editor integration)
- `OnlineHTR/README.md` and `OnlineHTR/Makefile` (model workflow and diagnostics)
- `LstmOnlineHTR/README.md` and `LstmOnlineHTR/CLAUDE.md` (alternate model workflow)
- `plan/plan.md` and `plan/data-flow-overview` (design reference)