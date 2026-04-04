---
name: krita-implementation-checkpoint
description: Implement one step from the Krita brush integration plan and verify its checkpoint.
argument-hint: Step id (P1-P8), plus optional scope notes
agent: agent
---

Use this prompt to execute exactly one checkpointed step from the Krita plan, with implementation plus verification.

## Inputs
- Required: `step` in `P1`..`P8`
- Optional: `scope notes` (for example: "only parser changes", "no UI redesign", "skip persistence")

If `step` is missing or invalid, ask a concise clarification question before editing.

## Source Of Truth
- Plan file: `.github/prompts/plan-krita-implementaion.md`
- Implementation root: `tldraw-handwriting-rec-plugin-obsidian/src/`
- Workspace instructions: `.github/copilot-instructions.md`

## Execution Rules
1. Read only the selected step from the plan and its matching handoff verification checkpoint.
2. Implement only what that step requests. Do not pre-implement later steps.
3. Keep architecture boundaries intact:
   - Obsidian integration in `src/obsidian/`
   - React/editor wiring in `src/components/TldrawApp.tsx`
   - tldraw rendering logic in `src/tldraw/`
4. Prefer minimal, targeted edits. Reuse existing helpers before adding new modules.
5. Preserve current behavior outside the selected step.
6. If a requirement conflicts with existing code constraints, state the conflict and choose the safest compatible implementation.

## Validation
After edits, run the smallest relevant checks from plugin root:
- `npm run lint` (if TypeScript/React files changed)
- `npm run build`

Then execute the selected step's manual verification from the plan handoff notes and report observed results.

## Output Format
Use this structure in the final response:

1. `Step Implemented`
- Step id and short title
- What was changed

2. `Files Changed`
- Paths and why each changed

3. `Verification Results`
- Lint/build status
- Step-specific checkpoint result with concrete evidence

4. `Gaps Or Risks`
- Any partial requirement, assumption, or follow-up needed

5. `Next Step`
- Suggest exactly one next prompt (`P{n+1}`) if current step passed

## Quality Bar
- No destructive git operations.
- No unrelated refactors.
- No placeholder TODOs for required logic in the selected step.
- Do not store `ImageBitmap` in React state/settings where plan forbids it.
- For pointer/render loops, avoid expensive pixel APIs (`getImageData`/`putImageData`) unless explicitly required.

## Example Invocations
- `krita-implementation-checkpoint P1`
- `krita-implementation-checkpoint P4 only pointer loop and stamping`
- `krita-implementation-checkpoint P7 skip jpeg fallback for now and explain why`
