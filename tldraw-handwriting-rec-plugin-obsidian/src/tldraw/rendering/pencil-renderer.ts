/**
 * Renderer for pencil strokes with pressure-aware width and velocity-based tapering.
 * 
 * This module provides utilities for rendering strokes with natural pencil-like
 * appearance based on pressure and velocity data.
 */

import { PressureStrokeData, PressurePoint } from 'src/handwriting/pressureStore'

export type PencilRenderConfig = {
	/** Base stroke width in pixels */
	baseWidth: number
	/** Pressure sensitivity factor (0-1). Higher = more pressure variation. */
	pressureSensitivity: number
	/** Minimum width multiplier when pressure is 0 */
	minWidthMultiplier: number
	/** Minimum opacity when pressure is 0 */
	minOpacity: number
	/** Velocity threshold below which to apply tapering (pixels/frame) */
	tapererVelocityThreshold: number
	/** Strength of velocity-based tapering (0-1) */
	taperingStrength: number
}

export const DEFAULT_PENCIL_CONFIG: PencilRenderConfig = {
	baseWidth: 3,
	pressureSensitivity: 0.7,
	minWidthMultiplier: 0.3,
	minOpacity: 0.5,
	tapererVelocityThreshold: 0.1,
	taperingStrength: 1.0,
}

/**
 * Compute visual properties (width, opacity) for each point in a stroke
 * based on pressure and velocity data.
 */
export function computePencilStrokeProperties(
	pressureData: PressureStrokeData,
	config: PencilRenderConfig = DEFAULT_PENCIL_CONFIG
): Array<{ width: number; opacity: number }> {
	const { points } = pressureData
	if (points.length === 0) return []

	return points.map((point, index) => {
		// Compute width based on pressure
		const pressureWidthMultiplier =
			config.minWidthMultiplier +
			(1 - config.minWidthMultiplier) * point.pressure * config.pressureSensitivity
		const width = config.baseWidth * pressureWidthMultiplier

		// Compute opacity based on pressure
		const opacity = config.minOpacity + (1 - config.minOpacity) * point.pressure

		// Apply velocity-based tapering at stroke ends (low velocity = thinner/fading)
		let finalWidth = width
		let finalOpacity = opacity

		if (point.velocityMagnitude < config.tapererVelocityThreshold) {
			// Stronger tapering for slower points
			const taperingFactor = (point.velocityMagnitude / config.tapererVelocityThreshold) *
				config.taperingStrength

			// For end-of-stroke points, apply exponential fade
			const isNearEnd = index > points.length * 0.85
			if (isNearEnd) {
				const endFade = (index - points.length * 0.85) / (points.length * 0.15)
				finalWidth *= 1 - endFade * (1 - taperingFactor)
				finalOpacity *= 1 - endFade * 0.5 // Fade opacity more gradually
			} else {
				finalWidth *= taperingFactor
			}
		}

		return {
			width: Math.max(0.5, finalWidth), // Enforce minimum width
			opacity: Math.max(0.1, Math.min(1, finalOpacity)), // Clamp opacity
		}
	})
}

/**
 * Render a pencil stroke to a canvas context with pressure-aware width and opacity.
 * 
 * @param ctx Canvas 2D rendering context
 * @param pressureData Pressure data for the stroke
 * @param color Stroke color (CSS color string)
 * @param points Screen-space stroke points (from extracted/transformed stroke)
 * @param config Rendering configuration
 */
export function renderPencilStrokeToCanvas(
	ctx: CanvasRenderingContext2D,
	pressureData: PressureStrokeData,
	color: string,
	points: Array<{ x: number; y: number }>,
	config: PencilRenderConfig = DEFAULT_PENCIL_CONFIG
): void {
	if (points.length < 2 || pressureData.points.length === 0) return

	const properties = computePencilStrokeProperties(pressureData, config)
	if (properties.length !== points.length) {
		console.warn(`[pencil-renderer] Point count mismatch: ${properties.length} vs ${points.length}`)
		return
	}

	ctx.lineCap = 'round'
	ctx.lineJoin = 'round'

	// Draw each segment with interpolated width and opacity
	for (let i = 0; i < points.length - 1; i++) {
		const p1 = points[i]
		const p2 = points[i + 1]
		const prop1 = properties[i]
		const prop2 = properties[i + 1]

		// Use average width/opacity for this segment
		const avgWidth = (prop1.width + prop2.width) / 2
		const avgOpacity = (prop1.opacity + prop2.opacity) / 2

		ctx.strokeStyle = color.replace(')', `, ${avgOpacity})`)
			.replace('rgb(', 'rgba(')
		ctx.lineWidth = avgWidth

		ctx.beginPath()
		ctx.moveTo(p1.x, p1.y)
		ctx.lineTo(p2.x, p2.y)
		ctx.stroke()
	}
}

/**
 * Get the visual properties of a pencil stroke as CSS stroke-linecap friendly object.
 * Useful for SVG or canvas rendering without full point-by-point drawing.
 */
export function getPencilStrokeVisualProperties(
	pressureData: PressureStrokeData,
	config: PencilRenderConfig = DEFAULT_PENCIL_CONFIG
): {
	averageWidth: number
	averageOpacity: number
	minWidth: number
	maxWidth: number
} {
	const properties = computePencilStrokeProperties(pressureData, config)

	if (properties.length === 0) {
		return {
			averageWidth: config.baseWidth,
			averageOpacity: 1,
			minWidth: config.baseWidth * config.minWidthMultiplier,
			maxWidth: config.baseWidth,
		}
	}

	const widths = properties.map((p) => p.width)
	const opacities = properties.map((p) => p.opacity)

	return {
		averageWidth: widths.reduce((a, b) => a + b, 0) / widths.length,
		averageOpacity: opacities.reduce((a, b) => a + b, 0) / opacities.length,
		minWidth: Math.min(...widths),
		maxWidth: Math.max(...widths),
	}
}
