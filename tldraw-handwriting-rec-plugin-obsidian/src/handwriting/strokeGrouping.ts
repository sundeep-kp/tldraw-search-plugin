import { NormalizedStrokePayload, StrokeBounds } from 'src/handwriting/types'
import { calculateAdaptiveGroupingGaps } from 'src/handwriting/adaptiveGrouping'
import { TLShapeId } from 'tldraw'

export type StrokeGroupingOptions = {
	maxTimeDeltaMs?: number
	maxHorizontalGapPx?: number
	maxVerticalCenterDistancePx?: number
	adaptiveGapMultiplier?: number
	minShapesPerGroup?: number
}

export type SpatialGroupingOptions = {
	baseHorizontalGapPx?: number
	maxVerticalCenterDistancePx?: number
	gapJumpRatio?: number
	sizeMismatchRatio?: number
	minShapesPerGroup?: number
}

export type StrokeGroupCandidate = {
	id: string
	shapeIds: TLShapeId[]
	payloads: NormalizedStrokePayload[]
	boundingBox: StrokeBounds
	startedAt: number
	endedAt: number
}

const DEFAULT_OPTIONS: Required<StrokeGroupingOptions> = {
	maxTimeDeltaMs: 800,
	maxHorizontalGapPx: 120,
	maxVerticalCenterDistancePx: 80,
	minShapesPerGroup: 1,
}

const DEFAULT_SPATIAL_OPTIONS: Required<SpatialGroupingOptions> = {
	baseHorizontalGapPx: 42,
	maxVerticalCenterDistancePx: 96,
	gapJumpRatio: 3.5,
	sizeMismatchRatio: 2.4,
	minShapesPerGroup: 1,
}

function centerY(bounds: StrokeBounds): number {
	return (bounds.minY + bounds.maxY) / 2
}

function computeHorizontalGap(a: StrokeBounds, b: StrokeBounds): number {
	if (a.maxX < b.minX) return b.minX - a.maxX
	if (b.maxX < a.minX) return a.minX - b.maxX
	return 0
}

function mergeBounds(a: StrokeBounds, b: StrokeBounds): StrokeBounds {
	const minX = Math.min(a.minX, b.minX)
	const minY = Math.min(a.minY, b.minY)
	const maxX = Math.max(a.maxX, b.maxX)
	const maxY = Math.max(a.maxY, b.maxY)

	return {
		minX,
		minY,
		maxX,
		maxY,
		width: maxX - minX,
		height: maxY - minY,
	}
}

function median(values: number[]): number {
	if (values.length === 0) return 0
	const sorted = [...values].sort((a, b) => a - b)
	const middle = Math.floor(sorted.length / 2)
	if (sorted.length % 2 === 0) {
		return (sorted[middle - 1] + sorted[middle]) / 2
	}
	return sorted[middle]
}

function strokeVisualSize(payload: NormalizedStrokePayload): number {
	const width = Math.max(1, payload.worldBounds.width)
	const height = Math.max(1, payload.worldBounds.height)
	return Math.max(1, Math.sqrt(width * height))
}

function area(bounds: StrokeBounds): number {
	return Math.max(1, bounds.width * bounds.height)
}

function pushSpatialGroup(
	groups: StrokeGroupCandidate[],
	payloads: NormalizedStrokePayload[],
	groupIndex: number
) {
	if (payloads.length === 0) return
	const sortedByX = [...payloads].sort((a, b) => a.worldBounds.minX - b.worldBounds.minX)
	const mergedBounds = sortedByX.slice(1).reduce((acc, payload) => mergeBounds(acc, payload.worldBounds), sortedByX[0].worldBounds)
	const timestamps = sortedByX.map((payload) => payload.timestamp)
	groups.push({
		id: `spatial-group-${groupIndex}-${sortedByX[0].shapeId}`,
		shapeIds: sortedByX.map((payload) => payload.shapeId),
		payloads: sortedByX,
		boundingBox: mergedBounds,
		startedAt: Math.min(...timestamps),
		endedAt: Math.max(...timestamps),
	})
}

export function groupNormalizedStrokePayloadsBySpatialProximity(
	payloads: NormalizedStrokePayload[],
	overrides: SpatialGroupingOptions = {}
): StrokeGroupCandidate[] {
	if (!Array.isArray(payloads) || payloads.length === 0) return []

	const options: Required<SpatialGroupingOptions> = {
		...DEFAULT_SPATIAL_OPTIONS,
		...overrides,
	}

	const sortedPayloads = [...payloads].sort((a, b) => {
		const centerDelta = centerY(a.worldBounds) - centerY(b.worldBounds)
		if (Math.abs(centerDelta) > options.maxVerticalCenterDistancePx) return centerDelta
		if (a.worldBounds.minX !== b.worldBounds.minX) return a.worldBounds.minX - b.worldBounds.minX
		return a.timestamp - b.timestamp
	})

	const groups: StrokeGroupCandidate[] = []
	let pending: NormalizedStrokePayload[] = []
	let gapHistory: number[] = []

	for (const payload of sortedPayloads) {
		if (pending.length === 0) {
			pending.push(payload)
			continue
		}

		const previous = pending[pending.length - 1]
		const horizontalGap = Math.max(0, computeHorizontalGap(previous.worldBounds, payload.worldBounds))
		const verticalCenterDistance = Math.abs(centerY(previous.worldBounds) - centerY(payload.worldBounds))
		const medianGap = gapHistory.length > 0 ? median(gapHistory) : options.baseHorizontalGapPx
		const medianSize = median(pending.map((entry) => strokeVisualSize(entry)))
		const adaptiveGapLimit = Math.max(options.baseHorizontalGapPx, medianSize * 1.15)

		const previousArea = area(previous.worldBounds)
		const nextArea = area(payload.worldBounds)
		const sizeRatio = Math.max(previousArea, nextArea) / Math.max(1, Math.min(previousArea, nextArea))

		const isGapDiscontinuity = horizontalGap > Math.max(adaptiveGapLimit, medianGap * options.gapJumpRatio)
		const isVerticalMismatch = verticalCenterDistance > Math.max(options.maxVerticalCenterDistancePx, medianSize * 0.9)
		const isMixedScaleBreak =
			sizeRatio > options.sizeMismatchRatio &&
			horizontalGap > Math.max(10, Math.min(previous.worldBounds.width, payload.worldBounds.width) * 0.3)

		if (isGapDiscontinuity || isVerticalMismatch || isMixedScaleBreak) {
			pushSpatialGroup(groups, pending, groups.length)
			pending = [payload]
			gapHistory = []
			continue
		}

		pending.push(payload)
		gapHistory.push(horizontalGap)
	}

	pushSpatialGroup(groups, pending, groups.length)
	return groups.filter((group) => group.shapeIds.length >= options.minShapesPerGroup)
}

function canJoinGroup(
	group: StrokeGroupCandidate,
	next: NormalizedStrokePayload,
	options: Required<Omit<StrokeGroupingOptions, 'adaptiveGapMultiplier'>> & {
		adaptiveGapMultiplier?: number
	}
): boolean {
	const previous = group.payloads[group.payloads.length - 1]
	const timeDeltaMs = next.timestamp - previous.timestamp
	if (timeDeltaMs > options.maxTimeDeltaMs) return false

	const adaptiveThresholds =
		typeof options.adaptiveGapMultiplier === 'number'
			? calculateAdaptiveGroupingGaps(next.worldBounds, group.boundingBox, {
					multiplier: options.adaptiveGapMultiplier,
			  })
			: undefined

	const horizontalGapLimit = adaptiveThresholds?.horizontalGapPx ?? options.maxHorizontalGapPx
	const verticalCenterGapLimit =
		adaptiveThresholds?.verticalCenterDistancePx ?? options.maxVerticalCenterDistancePx

	const horizontalGap = computeHorizontalGap(previous.worldBounds, next.worldBounds)
	if (horizontalGap > horizontalGapLimit) return false

	const verticalCenterDistance = Math.abs(centerY(previous.worldBounds) - centerY(next.worldBounds))
	if (verticalCenterDistance > verticalCenterGapLimit) return false

	return true
}

export function groupNormalizedStrokePayloads(
	payloads: NormalizedStrokePayload[],
	overrides: StrokeGroupingOptions = {}
): StrokeGroupCandidate[] {
	if (!Array.isArray(payloads) || payloads.length === 0) return []

	const options: Required<StrokeGroupingOptions> = {
		...DEFAULT_OPTIONS,
		...overrides,
	}

	const sortedPayloads = [...payloads].sort((a, b) => {
		if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp
		return a.worldBounds.minX - b.worldBounds.minX
	})

	const groups: StrokeGroupCandidate[] = []

	for (const payload of sortedPayloads) {
		const lastGroup = groups[groups.length - 1]
		if (!lastGroup || !canJoinGroup(lastGroup, payload, options)) {
			groups.push({
				id: `stroke-group-${payload.timestamp}-${payload.shapeId}`,
				shapeIds: [payload.shapeId],
				payloads: [payload],
				boundingBox: payload.worldBounds,
				startedAt: payload.timestamp,
				endedAt: payload.timestamp,
			})
			continue
		}

		lastGroup.shapeIds.push(payload.shapeId)
		lastGroup.payloads.push(payload)
		lastGroup.boundingBox = mergeBounds(lastGroup.boundingBox, payload.worldBounds)
		lastGroup.endedAt = payload.timestamp
	}

	return groups.filter((group) => group.shapeIds.length >= options.minShapesPerGroup)
}
