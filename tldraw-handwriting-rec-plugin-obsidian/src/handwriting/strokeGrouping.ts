import { NormalizedStrokePayload, StrokeBounds } from 'src/handwriting/types'
import { TLShapeId } from 'tldraw'

export type StrokeGroupingOptions = {
	maxTimeDeltaMs?: number
	maxHorizontalGapPx?: number
	maxVerticalCenterDistancePx?: number
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

function canJoinGroup(
	group: StrokeGroupCandidate,
	next: NormalizedStrokePayload,
	options: Required<StrokeGroupingOptions>
): boolean {
	const previous = group.payloads[group.payloads.length - 1]
	const timeDeltaMs = next.timestamp - previous.timestamp
	if (timeDeltaMs > options.maxTimeDeltaMs) return false

	const horizontalGap = computeHorizontalGap(previous.worldBounds, next.worldBounds)
	if (horizontalGap > options.maxHorizontalGapPx) return false

	const verticalCenterDistance = Math.abs(centerY(previous.worldBounds) - centerY(next.worldBounds))
	if (verticalCenterDistance > options.maxVerticalCenterDistancePx) return false

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
