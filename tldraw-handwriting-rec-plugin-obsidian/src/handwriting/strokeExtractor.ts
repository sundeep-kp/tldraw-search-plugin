import { StrokeCollection, StrokePoint } from 'src/handwriting/types'
import { TLDrawShape } from 'tldraw'

export function extractStroke(shape: TLDrawShape): StrokeCollection {
	if (!Array.isArray(shape.props?.segments) || shape.props.segments.length === 0) {
		return []
	}

	const strokes: StrokeCollection = []

	for (const segment of shape.props.segments) {
		if (!Array.isArray(segment.points) || segment.points.length === 0) continue

		const points: StrokePoint[] = segment.points
			.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
			.map((point) => ({
				x: point.x,
				y: point.y,
			}))

		if (points.length > 0) {
			strokes.push(points)
		}
	}

	return strokes
}