import { StrokeBounds } from 'src/handwriting/types'

export type AdaptiveGapOptions = {
	multiplier: number
	minHorizontalGapPx?: number
	maxHorizontalGapPx?: number
	minVerticalCenterDistancePx?: number
	maxVerticalCenterDistancePx?: number
}

export type AdaptiveGapResult = {
	horizontalGapPx: number
	verticalCenterDistancePx: number
}

const DEFAULT_MIN_HORIZONTAL_GAP_PX = 8
const DEFAULT_MAX_HORIZONTAL_GAP_PX = 420
const DEFAULT_MIN_VERTICAL_CENTER_DISTANCE_PX = 10
const DEFAULT_MAX_VERTICAL_CENTER_DISTANCE_PX = 520

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value))
}

function normalizeDimension(value: number): number {
	if (!Number.isFinite(value)) return 1
	return Math.max(1, value)
}

/**
 * Compute adaptive grouping thresholds from stroke geometry.
 *
 * The algorithm blends the incoming stroke dimensions with the current group size,
 * then derives horizontal/vertical limits from weighted dimensions + geometric scale.
 * This keeps tiny handwriting strict and large handwriting permissive without hardcoding
 * one-size-fits-all pixel limits.
 */
export function calculateAdaptiveGroupingGaps(
	nextStrokeBounds: StrokeBounds,
	groupBounds: StrokeBounds,
	options: AdaptiveGapOptions
): AdaptiveGapResult {
	const multiplier = clamp(options.multiplier, 0.5, 2.0)

	const nextWidth = normalizeDimension(nextStrokeBounds.width)
	const nextHeight = normalizeDimension(nextStrokeBounds.height)
	const groupWidth = normalizeDimension(groupBounds.width)
	const groupHeight = normalizeDimension(groupBounds.height)

	// Bias toward the incoming stroke while still accounting for the established group envelope.
	const weightedWidth = 0.68 * nextWidth + 0.32 * groupWidth
	const weightedHeight = 0.68 * nextHeight + 0.32 * groupHeight

	// Geometric scale captures overall stroke magnitude without overreacting to one axis.
	const geometricScale = Math.sqrt(weightedWidth * weightedHeight)

	const aspectRatio = weightedWidth / weightedHeight
	const isAscenderLike = weightedHeight > weightedWidth * 1.25
	const isWideShape = aspectRatio > 1.35

	let horizontalBase = 10 + weightedWidth * 0.52 + geometricScale * 0.12
	let verticalBase = 12 + weightedHeight * 0.66 + geometricScale * 0.1

	if (isAscenderLike) {
		verticalBase += weightedHeight * 0.14
	}

	if (isWideShape) {
		horizontalBase += weightedWidth * 0.12
	}

	const minHorizontalGap = options.minHorizontalGapPx ?? DEFAULT_MIN_HORIZONTAL_GAP_PX
	const maxHorizontalGap = options.maxHorizontalGapPx ?? DEFAULT_MAX_HORIZONTAL_GAP_PX
	const minVerticalGap =
		options.minVerticalCenterDistancePx ?? DEFAULT_MIN_VERTICAL_CENTER_DISTANCE_PX
	const maxVerticalGap =
		options.maxVerticalCenterDistancePx ?? DEFAULT_MAX_VERTICAL_CENTER_DISTANCE_PX

	return {
		horizontalGapPx: clamp(horizontalBase * multiplier, minHorizontalGap, maxHorizontalGap),
		verticalCenterDistancePx: clamp(verticalBase * multiplier, minVerticalGap, maxVerticalGap),
	}
}
