import { DrawShapeTool } from 'tldraw'

/**
 * Standalone pen tool.
 *
 * This reuses tldraw's native draw state machine under a separate tool id,
 * so selecting Pen does not redirect the active tool to Draw/Pencil.
 * It supports the same alt+drag brush scrub feature as the pencil tool.
 */
export default class PenTool extends DrawShapeTool {
	static override id = 'pen'
}
