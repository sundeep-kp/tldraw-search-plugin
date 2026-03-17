import { extractStroke } from 'src/handwriting/strokeExtractor'
import { CompletedDrawShape, StrokeListenerOptions } from 'src/handwriting/types'
import { Editor, HistoryEntry, TLRecord, TLShape, TLShapeId } from 'tldraw'

function isDrawShape(shape: TLRecord | TLShape | null | undefined): shape is TLShape {
	return !!shape && typeof shape === 'object' && 'type' in shape && shape.type === 'draw'
}

function isCompletedDrawShape(
	shape: TLRecord | TLShape | null | undefined
): shape is CompletedDrawShape {
	if (!isDrawShape(shape)) return false

	const props = (shape as TLShape).props as { isComplete?: boolean } | undefined
	return props?.isComplete === true
}

function logDebug(enabled: boolean, message: string, ...args: unknown[]) {
	if (!enabled) return
	console.log(`[handwriting] ${message}`, ...args)
}

export function initializeStrokeListener(
	editor: Editor,
	{ debug = false, onStrokeExtracted }: StrokeListenerOptions = {}
) {
	const processedShapeIds = new Set<TLShapeId>()
	logDebug(debug, 'stroke listener initialized')

	return editor.store.listen(
		(update: HistoryEntry<TLRecord>) => {
			const removed = update?.changes?.removed
			if (removed) {
				for (const shapeId of Object.keys(removed) as TLShapeId[]) {
					processedShapeIds.delete(shapeId)
				}
			}

			const addedRecords = Object.values(update?.changes?.added ?? {})
			const updatedRecords = Object.values(update?.changes?.updated ?? {}).map(([, to]) => to)

			for (const record of [...addedRecords, ...updatedRecords]) {
				if (!isCompletedDrawShape(record)) continue

				const shapeId = record.id as TLShapeId
				if (processedShapeIds.has(shapeId)) {
					logDebug(debug, 'skipped duplicate draw shape', shapeId)
					continue
				}

				const shape = editor.getShape(shapeId)
				if (!isCompletedDrawShape(shape)) continue

				const strokes = extractStroke(shape)
				if (strokes.length === 0) {
					logDebug(debug, 'skipped draw shape with no stroke points', shapeId)
					continue
				}

				processedShapeIds.add(shapeId)

				const totalPoints = strokes.reduce((total, segment) => total + segment.length, 0)
				console.log('[handwriting-probe] extraction success', {
					shapeId,
					segments: strokes.length,
					totalPoints,
				})
				console.log('[handwriting-probe] final stroke vector', {
					shapeId,
					strokes,
				})

				logDebug(debug, 'extracted stroke geometry', {
					shapeId,
					segments: strokes.length,
					totalPoints,
				})

				onStrokeExtracted?.({
					shapeId,
					shape,
					strokes,
				})
			}
		},
		{
			scope: 'document',
			source: 'user',
		}
	)
}