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

/**
 * Linear interpolation helper function.
 * Given arrays of x-values (xp) and y-values (fp), interpolate at point x.
 */
function linearInterpolate(xp: number[], fp: number[], x: number): number {
	if (xp.length === 0) return 0
	if (xp.length === 1) return fp[0]
	if (x <= xp[0]) return fp[0]
	if (x >= xp[xp.length - 1]) return fp[fp.length - 1]

	let i = 0
	while (i < xp.length - 1 && xp[i + 1] < x) {
		i++
	}

	const x0 = xp[i]
	const x1 = xp[i + 1]
	const y0 = fp[i]
	const y1 = fp[i + 1]

	if (x1 === x0) return y0
	const alpha = (x - x0) / (x1 - x0)
	return y0 + alpha * (y1 - y0)
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

/**
 * Implements Carbune2020 resampling: time-normalized linear interpolation.
 * 
 * Algorithm:
 * 1. Compute cumulative distances along the stroke
 * 2. Calculate stroke length and target point count
 * 3. Allocate synthetic time proportional to cumulative distance
 * 4. Normalize time to [0, 1] per stroke
 * 5. Interpolate X, Y, and time in normalized time space
 * 
 * This matches the OnlineHTR training preprocessing exactly.
 */
function resampleStrokes(
	strokes: Point2D[][],
	pointsPerUnitLength: number
): { points: TimedPoint[]; discarded: boolean } {
	const points: TimedPoint[] = []
	let currentTimeBase = 0

	for (let strokeNr = 0; strokeNr < strokes.length; strokeNr++) {
		const stroke = strokes[strokeNr]
		if (stroke.length === 0) continue

		// Handle single-point strokes
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

		// Calculate stroke length and target point count
		const cumDist = cumulativeDistances(stroke)
		const totalDistance = cumDist[cumDist.length - 1]

		if (totalDistance <= 0) {
			// Degenerate stroke: all points at same location
			points.push({
				x: stroke[0].x,
				y: stroke[0].y,
				t: currentTimeBase,
				strokeNr,
			})
			currentTimeBase += 2
			continue
		}

		let targetCount = Math.ceil(totalDistance * pointsPerUnitLength)
		if (targetCount <= 1) targetCount = 2

		// Step 1: Create synthetic time proportional to cumulative distance
		const syntheticTime = cumDist.map((d) => (d / totalDistance) * 1.0) // Allocate [0, 1]

		// Step 2: Normalize time to [0, 1] per stroke
		const timeMin = syntheticTime[0]
		const timeMax = syntheticTime[syntheticTime.length - 1]
		const timeSpan = timeMax - timeMin
		const normalizedTime = syntheticTime.map((t) =>
			timeSpan > 0 ? (t - timeMin) / timeSpan : 0
		)

		// Step 3: Create target normalized time points (uniformly spaced in time space)
		const targetNormalizedTime: number[] = []
		for (let i = 0; i < targetCount; i++) {
			targetNormalizedTime.push(
				targetCount === 1 ? 0.5 : i / (targetCount - 1)
			)
		}

		// Step 4: Extract x, y coordinates
		const xs = stroke.map((p) => p.x)
		const ys = stroke.map((p) => p.y)

		// Step 5: Interpolate X, Y in normalized time space
		const resampledX: number[] = []
		const resampledY: number[] = []
		const resampledT: number[] = []

		for (const targetTime of targetNormalizedTime) {
			resampledX.push(linearInterpolate(normalizedTime, xs, targetTime))
			resampledY.push(linearInterpolate(normalizedTime, ys, targetTime))
			// Recover original time value via interpolation
			resampledT.push(linearInterpolate(normalizedTime, syntheticTime, targetTime))
		}

		// Step 6: Convert to absolute time and add to output
		const startTime = currentTimeBase
		const endTime = currentTimeBase + 1
		for (let i = 0; i < resampledX.length; i++) {
			points.push({
				x: resampledX[i],
				y: resampledY[i],
				t: startTime + (endTime - startTime) * (resampledT[i] - timeMin) / (timeMax - timeMin),
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
