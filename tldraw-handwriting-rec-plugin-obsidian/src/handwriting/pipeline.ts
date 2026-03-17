import { normalizeStrokes } from 'src/handwriting/strokeNormalizer'
import { NormalizedStrokePayload, StrokeExtractionResult } from 'src/handwriting/types'

export type StrokePipelineOptions = {
	minSegments?: number
	minPoints?: number
}

export function processExtractedStroke(
	result: StrokeExtractionResult,
	{ minSegments = 1, minPoints = 2 }: StrokePipelineOptions = {}
): NormalizedStrokePayload | null {
	if (result.strokes.length < minSegments) return null

	const totalPoints = result.strokes.reduce((sum, stroke) => sum + stroke.length, 0)
	if (totalPoints < minPoints) return null

	const normalizedResult = normalizeStrokes(result.strokes)
	if (!normalizedResult) return null

	const shapePosition = {
		x: result.shape.x,
		y: result.shape.y,
	}

	const worldBounds = {
		minX: normalizedResult.bounds.minX + shapePosition.x,
		minY: normalizedResult.bounds.minY + shapePosition.y,
		maxX: normalizedResult.bounds.maxX + shapePosition.x,
		maxY: normalizedResult.bounds.maxY + shapePosition.y,
		width: normalizedResult.bounds.width,
		height: normalizedResult.bounds.height,
	}

	return {
		shapeId: result.shapeId,
		rawStrokes: result.strokes,
		normalizedStrokes: normalizedResult.normalized,
		shapePosition,
		bounds: normalizedResult.bounds,
		worldBounds,
		scale: normalizedResult.scale,
		timestamp: Date.now(),
	}
}
