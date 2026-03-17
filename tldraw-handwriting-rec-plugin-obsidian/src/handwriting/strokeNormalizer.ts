import { Stroke, StrokeBounds, StrokeCollection, StrokePoint } from 'src/handwriting/types'

export type NormalizedStrokeResult = {
	original: StrokeCollection
	normalized: StrokeCollection
	bounds: StrokeBounds
	scale: number
}

function getBounds(strokes: StrokeCollection): StrokeBounds | null {
	let minX = Number.POSITIVE_INFINITY
	let minY = Number.POSITIVE_INFINITY
	let maxX = Number.NEGATIVE_INFINITY
	let maxY = Number.NEGATIVE_INFINITY

	for (const stroke of strokes) {
		for (const point of stroke) {
			if (point.x < minX) minX = point.x
			if (point.y < minY) minY = point.y
			if (point.x > maxX) maxX = point.x
			if (point.y > maxY) maxY = point.y
		}
	}

	if (
		!Number.isFinite(minX) ||
		!Number.isFinite(minY) ||
		!Number.isFinite(maxX) ||
		!Number.isFinite(maxY)
	) {
		return null
	}

	return {
		minX,
		minY,
		maxX,
		maxY,
		width: maxX - minX,
		height: maxY - minY,
	}
}

export function normalizeStrokes(strokes: StrokeCollection): NormalizedStrokeResult | null {
	if (!Array.isArray(strokes) || strokes.length === 0) return null

	const bounds = getBounds(strokes)
	if (!bounds) return null

	// Preserve aspect ratio by scaling all points against the largest dimension.
	const scale = Math.max(bounds.width, bounds.height) || 1

	const normalized: StrokeCollection = strokes.map((stroke: Stroke): Stroke =>
		stroke.map((point: StrokePoint): StrokePoint => ({
			x: (point.x - bounds.minX) / scale,
			y: (point.y - bounds.minY) / scale,
		}))
	)

	return {
		original: strokes,
		normalized,
		bounds,
		scale,
	}
}
