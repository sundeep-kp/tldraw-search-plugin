import { StrokeGroupCandidate } from 'src/handwriting/strokeGrouping'

export type OnlineHtrPreprocessorOptions = {
	pointsPerUnitLength?: number
}

export type OnlineHtrPreprocessedGroup = {
	groupId: string
	timeSteps: number
	channels: 4
	ink: Float32Array
}

type Point2D = {
	x: number
	y: number
}

type TimedPoint = {
	x: number
	y: number
	t: number
	strokeNr: number
}

const DEFAULT_POINTS_PER_UNIT_LENGTH = 20

function distance(a: Point2D, b: Point2D): number {
	const dx = b.x - a.x
	const dy = b.y - a.y
	return Math.hypot(dx, dy)
}

function cumulativeDistances(points: Point2D[]): number[] {
	const result = new Array<number>(points.length)
	result[0] = 0
	for (let i = 1; i < points.length; i++) {
		result[i] = result[i - 1] + distance(points[i - 1], points[i])
	}
	return result
}

function interpolateByDistance(points: Point2D[], targetCount: number): Point2D[] {
	if (points.length <= 1 || targetCount <= 1) return [...points]

	const cumDist = cumulativeDistances(points)
	const totalDistance = cumDist[cumDist.length - 1]
	if (totalDistance <= 0) {
		return [points[0], ...new Array(Math.max(0, targetCount - 1)).fill(points[0])]
	}

	const result: Point2D[] = []
	for (let i = 0; i < targetCount; i++) {
		const targetDistance = (i / (targetCount - 1)) * totalDistance

		let segmentIndex = 1
		while (segmentIndex < cumDist.length && cumDist[segmentIndex] < targetDistance) {
			segmentIndex += 1
		}

		if (segmentIndex >= cumDist.length) {
			result.push(points[points.length - 1])
			continue
		}

		const leftIndex = Math.max(0, segmentIndex - 1)
		const rightIndex = segmentIndex
		const leftDistance = cumDist[leftIndex]
		const rightDistance = cumDist[rightIndex]
		const span = rightDistance - leftDistance

		if (span <= 0) {
			result.push(points[rightIndex])
			continue
		}

		const alpha = (targetDistance - leftDistance) / span
		result.push({
			x: points[leftIndex].x + alpha * (points[rightIndex].x - points[leftIndex].x),
			y: points[leftIndex].y + alpha * (points[rightIndex].y - points[leftIndex].y),
		})
	}

	return result
}

function flattenGroupStrokes(group: StrokeGroupCandidate): Point2D[][] {
	const strokes: Point2D[][] = []

	for (const payload of group.payloads) {
		for (const stroke of payload.rawStrokes) {
			if (stroke.length === 0) continue
			strokes.push(
				stroke
					.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
					.map((point) => ({
						x: point.x + payload.shapePosition.x,
						y: point.y + payload.shapePosition.y,
					}))
			)
		}
	}

	return strokes.filter((stroke) => stroke.length > 0)
}

function shiftAndScale(strokes: Point2D[][]): Point2D[][] | null {
	const firstPoint = strokes[0]?.[0]
	if (!firstPoint) return null

	let minY = Number.POSITIVE_INFINITY
	for (const stroke of strokes) {
		for (const point of stroke) {
			if (point.y < minY) minY = point.y
		}
	}

	const shifted = strokes.map((stroke) =>
		stroke.map((point) => ({
			x: point.x - firstPoint.x,
			y: point.y - minY,
		}))
	)

	let maxY = 0
	for (const stroke of shifted) {
		for (const point of stroke) {
			if (point.y > maxY) maxY = point.y
		}
	}
	if (!Number.isFinite(maxY) || maxY <= 0) return null

	return shifted.map((stroke) =>
		stroke.map((point) => ({
			x: point.x / maxY,
			y: point.y / maxY,
		}))
	)
}

function resampleStrokes(
	strokes: Point2D[][],
	pointsPerUnitLength: number
): { points: TimedPoint[]; discarded: boolean } {
	const points: TimedPoint[] = []
	let currentTimeBase = 0

	for (let strokeNr = 0; strokeNr < strokes.length; strokeNr++) {
		const stroke = strokes[strokeNr]
		if (stroke.length === 0) continue

		if (stroke.length === 1) {
			points.push({
				x: stroke[0].x,
				y: stroke[0].y,
				t: currentTimeBase,
				strokeNr,
			})
			currentTimeBase += 2
			continue
		}

		const strokeLength = cumulativeDistances(stroke).at(-1) ?? 0
		let targetCount = Math.ceil(strokeLength * pointsPerUnitLength)
		if (targetCount <= 1) targetCount = 2

		const resampled = interpolateByDistance(stroke, targetCount)
		if (resampled.length === 0) continue

		const startTime = currentTimeBase
		const endTime = currentTimeBase + 1
		const step = resampled.length <= 1 ? 0 : (endTime - startTime) / (resampled.length - 1)

		for (let i = 0; i < resampled.length; i++) {
			points.push({
				x: resampled[i].x,
				y: resampled[i].y,
				t: startTime + step * i,
				strokeNr,
			})
		}

		currentTimeBase = endTime + 1
	}

	return { points, discarded: points.length === 0 }
}

function toDxDyDtN(points: TimedPoint[]): Float32Array | null {
	if (points.length === 0) return null

	const channelCount = 4
	const out = new Float32Array(points.length * channelCount)

	for (let i = 0; i < points.length; i++) {
		const prev = points[Math.max(0, i - 1)]
		const curr = points[i]
		const sameStroke = i > 0 && curr.strokeNr === prev.strokeNr

		const dx = i === 0 ? 0 : curr.x - prev.x
		const dy = i === 0 ? 0 : curr.y - prev.y
		const dt = i === 0 ? 0 : Math.max(0, curr.t - prev.t)
		const n = i === 0 || !sameStroke ? 1 : 0

		const idx = i * channelCount
		out[idx] = dx
		out[idx + 1] = dy
		out[idx + 2] = dt
		out[idx + 3] = n
	}

	for (let i = 0; i < out.length; i++) {
		if (!Number.isFinite(out[i])) {
			return null
		}
	}

	return out
}

export function preprocessGroupForOnlineHtr(
	group: StrokeGroupCandidate,
	{ pointsPerUnitLength = DEFAULT_POINTS_PER_UNIT_LENGTH }: OnlineHtrPreprocessorOptions = {}
): OnlineHtrPreprocessedGroup | null {
	if (!group.payloads.length) return null
	if (pointsPerUnitLength <= 0) return null

	const strokes = flattenGroupStrokes(group)
	if (!strokes.length) return null

	const shiftedScaledStrokes = shiftAndScale(strokes)
	if (!shiftedScaledStrokes) return null

	const { points, discarded } = resampleStrokes(shiftedScaledStrokes, pointsPerUnitLength)
	if (discarded) return null

	const ink = toDxDyDtN(points)
	if (!ink) return null

	return {
		groupId: group.id,
		timeSteps: points.length,
		channels: 4,
		ink,
	}
}

export function toOnnxInkInput(preprocessed: OnlineHtrPreprocessedGroup) {
	return {
		data: preprocessed.ink,
		dims: [preprocessed.timeSteps, 1, preprocessed.channels] as [number, number, number],
	}
}
