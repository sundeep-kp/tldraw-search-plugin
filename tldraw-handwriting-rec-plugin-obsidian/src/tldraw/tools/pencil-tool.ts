import { DrawShapeTool } from 'tldraw'

/**
 * Standalone pencil tool.
 *
 * This reuses tldraw's native draw state machine under a separate tool id,
 * so selecting Pencil does not redirect the active tool to Draw/Pen.
 */
export default class PencilTool extends DrawShapeTool {
	static override id = 'pencil'
}
