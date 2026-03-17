# Handwriting Recognition Progress Checklist

Last updated: 2026-03-17

## Workspace and Planning

- [x] Added workspace instructions: `.github/copilot-instructions.md`
- [x] Created execution prompt: `.github/prompts/plan-optimizeStrokeListenerExtractor.prompt.md`
- [x] Confirmed repo split and architecture boundaries (`plan/` docs vs plugin source)

## Stroke Capture and Extraction

- [x] Added shared handwriting contracts in `src/handwriting/types.ts`
- [x] Reworked stroke extraction in `src/handwriting/strokeExtractor.ts`
- [x] Reworked stroke listener in `src/handwriting/strokeListener.ts`
- [x] Listener handles both `changes.added` and `changes.updated`
- [x] Listener deduplicates completed shape processing by `shapeId`
- [x] Listener cleanup is returned for unsubscription

## React Integration

- [x] Added lifecycle hook `src/hooks/useStrokeListener.ts`
- [x] Integrated listener hook in `src/components/TldrawApp.tsx`
- [x] Made debug settings reactive in `TldrawApp`

## Normalization and Pipeline

- [x] Added `src/handwriting/strokeNormalizer.ts` (uniform normalization)
- [x] Added `src/handwriting/pipeline.ts` (`processExtractedStroke`)
- [x] Extended normalized payload with:
- [x] `shapePosition`
- [x] `bounds`
- [x] `worldBounds`
- [x] `timestamp`

## Persistence Layers

- [x] Added `src/handwriting/strokePayloadStore.ts`
- [x] Persist normalized payloads by `documentId + shapeId`
- [x] Added document scope ref-count acquire/release lifecycle
- [x] Added `src/handwriting/wordCandidateStore.ts`
- [x] Persist grouped candidates by `documentId`
- [x] Added document scope ref-count acquire/release lifecycle

## Grouping Stage

- [x] Added `src/handwriting/strokeGrouping.ts`
- [x] Implemented grouping with:
- [x] temporal threshold (`maxTimeDeltaMs`, default `800`)
- [x] horizontal gap threshold (`maxHorizontalGapPx`, default `120`)
- [x] vertical-center guard (`maxVerticalCenterDistancePx`, default `80`)
- [x] Integrated grouping into `TldrawApp` flow
- [x] Store grouped candidates after each extracted payload

## Logging and Validation

- [x] Retained extraction probes in listener for validation
- [x] Added normalized payload debug logging in `TldrawApp`
- [x] Added grouped candidate debug logging in `TldrawApp`
- [x] Added recognition run debug logging in `TldrawApp`
- [x] Added `scripts/check-onlinehtr-preprocessor.ts` invariant check script
- [x] Added `scripts/check-ctc-decoder.ts` decoder behavior check script
- [x] Added `scripts/check-recognition-lifecycle.ts` smoke script for debounce and stale-run behavior
- [x] Verified recognition store cleanup on scope release in `scripts/check-recognition-lifecycle.ts`
- [x] Added `scripts/check-model-config.ts` for model config normalization/readiness checks
- [x] Repeated `npm run build` checks succeeded after each implementation unit

## Pending Next Steps

- [ ] Provide real OnlineHTR model artifacts/config (`modelUrl`, `alphabet`) for `onnx-web` runtime
- [ ] Complete parity tuning of OnlineHTR preprocessor in `src/handwriting/preprocessors/onlineHtrCarbune2020.ts`
- [ ] Add `src/handwriting/indexer.ts` to write/read markdown handwriting index block
- [ ] Integrate search/navigation UI with recognized word bounding boxes
- [ ] Replace temporary probe logs with gated/final logging policy

## Recognizer Plan (OnlineHTR + ONNX Web)

Decision: use `PellelNitram/OnlineHTR` as the model source and integrate via pure plugin runtime (`onnxruntime-web`), no Python sidecar.

### Phase 0 - Freeze Upstream Model Contract

- [ ] Document exact OnlineHTR preprocessing contract (`carbune2020_xytn`) from upstream code.
- [ ] Confirm channel construction and conventions: `(dx, dy, dt, n)` with first row `(0, 0, 0, 1)`.
- [ ] Confirm interpolation rule (`POINTS_PER_UNIT_LENGTH = 20`) and stroke/time edge-case handling.
- [ ] Confirm model IO shapes and semantics: input `[T, N, C]`, output log-probs `[T, N, alphabet+blank]`.
- [ ] Capture decoder contract parity with upstream greedy CTC implementation.

### Phase 1 - ONNX Export and Parity Harness (External Spike)

- [ ] Export OnlineHTR checkpoint to ONNX with dynamic time axis.
- [ ] Produce pinned inference artifacts: ONNX model + alphabet mapping + checksum/version metadata.
- [ ] Run parity tests (PyTorch vs ONNX runtime) on known samples until decoded outputs align.
- [ ] Treat parity as a hard gate before plugin integration.

### Phase 2 - Plugin Contracts and Recognition Store

- [x] Extend `src/handwriting/types.ts` with recognizer types (`RecognitionResult`, status, metadata).
- [x] Add `src/handwriting/recognitionResultsStore.ts` with per-document scoped lifecycle (acquire/release).
- [x] Add stable group fingerprinting (`groupId + endedAt`) to avoid redundant re-recognition.

### Phase 3 - TypeScript Preprocessor Parity

- [x] Add `src/handwriting/preprocessors/onlineHtrCarbune2020.ts`.
- [ ] Implement parity-safe conversion from grouped strokes to `(dx, dy, dt, n)` sequences.
- [x] Implement interpolation to 20 points per unit length and NaN/invalid-sample guards.
- [x] Emit tensor-ready buffers and sequence metadata expected by ONNX inference.

### Phase 4 - ONNX Recognizer Adapter

- [x] Add `src/handwriting/recognizer.ts` engine abstraction.
- [x] Implement `OnnxOnlineHtrRecognizer` using `onnxruntime-web`.
- [x] Add model lazy-loading/warm-up and robust error reporting.
- [x] Implement TS greedy CTC decoder equivalent to upstream behavior.
- [x] Return ranked recognition candidates with confidence heuristic.

### ONNX Runtime Plumbing (In Repo)

- [x] Add `onnxruntime-web` dependency.
- [x] Add `src/handwriting/ctcDecoder.ts` for greedy CTC decoding.
- [x] Add `src/handwriting/modelConfig.ts` for model URL/alphabet/runtime configuration.
- [x] Add model config normalization/readiness helpers in `src/handwriting/modelConfig.ts`.

### Phase 5 - App Integration (In-Memory Results Only)

- [x] Integrate debounced automatic recognition in `src/components/TldrawApp.tsx`.
- [x] Consume groups from `wordCandidateStore` and persist outputs in `recognitionResultsStore`.
- [x] Add stale-run cancellation/versioning to drop outdated async results.
- [x] Keep scope to in-memory recognition only (defer markdown index writeback).
- [x] Add guarded recognizer engine selection in `TldrawApp` (`onnx-web` when config is valid, else `stub`).
- [x] Source recognizer model config from `userSettings.handwritingRecognition` in `TldrawApp`.

### Settings Plumbing

- [x] Extend `TldrawPluginSettings` with optional `handwritingRecognition` model fields.
- [x] Merge nested `handwritingRecognition` defaults in `UserSettingsManager.loadSettings()`.
- [x] Add `src/components/settings/HandwritingRecognitionSettings.tsx` and register `Handwriting` tab in settings UI.

### Phase 6 - Verification and Hardening

- [x] Validate build and diagnostics after each unit.
- [x] Add deterministic check scripts for preprocessor + decoder behavior.
- [x] Add lifecycle smoke check for debounced recognition and stale-run cancellation.
- [ ] Verify no UI hitching under rapid drawing (debounce effectiveness).
- [x] Verify per-document cleanup/lifecycle correctness for recognition results.
- [ ] Compare plugin ONNX predictions against external parity harness for identical serialized input.

## Update Protocol

For each new implementation unit, update this file using the following pattern:

1. Update `Last updated` date.
2. Mark completed items as `[x]`.
3. Add new completed work under the correct section.
4. Keep `Pending Next Steps` to the next 3-6 actionable items only.
5. Add file paths inline when a change introduces a new module.

Template snippet for new entries:

```md
- [x] Added `src/handwriting/<module>.ts` for <purpose>
- [x] Integrated <module> in `src/components/TldrawApp.tsx`
- [x] Validated with `npm run build`
```
