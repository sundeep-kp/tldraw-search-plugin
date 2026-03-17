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
- [x] Repeated `npm run build` checks succeeded after each implementation unit

## Pending Next Steps

- [ ] Add `src/handwriting/recognizer.ts` consuming `wordCandidateStore`
- [ ] Add recognized-word model and storage contract
- [ ] Add `src/handwriting/indexer.ts` to write/read markdown handwriting index block
- [ ] Integrate search/navigation UI with recognized word bounding boxes
- [ ] Replace temporary probe logs with gated/final logging policy

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
