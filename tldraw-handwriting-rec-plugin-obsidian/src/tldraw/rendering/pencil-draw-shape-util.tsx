import * as React from 'react'
import {
	DrawShapeUtil,
	SvgExportContext,
	TLAnyShapeUtilConstructor,
	TLDrawShape,
	defaultShapeUtils,
} from 'tldraw'
import { getPressureOpacityStyle } from 'src/tldraw/rendering/pencil-texture'

export const PENCIL_FEATHER_FILTER_ID = 'pencil-feather-filter'

const DEFAULT_PENCIL_OPACITY_SENSITIVITY = 1
const DEFAULT_PENCIL_CROSS_SECTION_ASPECT_RATIO = 5
let pencilOpacitySensitivity = DEFAULT_PENCIL_OPACITY_SENSITIVITY
let pencilCrossSectionAspectRatio = DEFAULT_PENCIL_CROSS_SECTION_ASPECT_RATIO
let pencilDefaultStrokeEnabled = true
let pencilBaseStrokeEnabled = true
let pencilSampledOverlayEnabled = true
let pencilFallbackStylingEnabled = true

export function setPencilOpacitySensitivity(value: number) {
	if (!Number.isFinite(value)) {
		pencilOpacitySensitivity = DEFAULT_PENCIL_OPACITY_SENSITIVITY
		return
	}
	pencilOpacitySensitivity = Math.max(0, value)
}

export function setPencilCrossSectionAspectRatio(value: number) {
	if (!Number.isFinite(value)) {
		pencilCrossSectionAspectRatio = DEFAULT_PENCIL_CROSS_SECTION_ASPECT_RATIO
		return
	}
	pencilCrossSectionAspectRatio = Math.max(1, Math.min(12, value))
}

export function setPencilBaseStrokeEnabled(value: boolean) {
	console.log('[Pencil Renderer] Base stroke enabled:', value)
	pencilBaseStrokeEnabled = value
}

export function setPencilSampledOverlayEnabled(value: boolean) {
	console.log('[Pencil Renderer] Sampled overlay enabled:', value)
	pencilSampledOverlayEnabled = value
}

export function setPencilFallbackStylingEnabled(value: boolean) {
	console.log('[Pencil Renderer] Fallback styling enabled:', value)
	pencilFallbackStylingEnabled = value
}

export function setPencilDefaultStrokeEnabled(value: boolean) {
	const changed = pencilDefaultStrokeEnabled !== value
	console.log('[Pencil Renderer] Default stroke enabled:', value, '(changed:', changed, ')')
	if (changed) console.log('[Pencil Renderer] ⚠️ Module variable updated - tldraw cache may not invalidate')
	pencilDefaultStrokeEnabled = value
}

const STROKE_SIZE_BY_STYLE: Record<string, number> = {
	s: 2,
	m: 3.5,
	l: 5,
	xl: 10,
}

type LocalPressurePoint = {
	x: number
	y: number
	pressure: number
}

function clampUnit(value: number): number {
	if (!Number.isFinite(value)) return 0.5
	return Math.max(0, Math.min(1, value))
}

function getLocalPressurePointsFromShape(shape: TLDrawShape): LocalPressurePoint[] {
	const rawPoints: LocalPressurePoint[] = []
	for (const segment of shape.props.segments) {
		for (const point of segment.points) {
			rawPoints.push({
				x: point.x,
				y: point.y,
				pressure: typeof point.z === 'number' ? point.z : 0.5,
			})
		}
	}

	const pressures = rawPoints.map((point) => point.pressure)
	const minPressure = Math.min(...pressures)
	const maxPressure = Math.max(...pressures)
	const needsNormalization = minPressure < 0 || maxPressure > 1
	if (!needsNormalization || maxPressure <= minPressure) {
		return rawPoints.map((point) => ({
			...point,
			pressure: clampUnit(point.pressure),
		}))
	}

	const pressureRange = maxPressure - minPressure
	return rawPoints.map((point) => ({
		...point,
		pressure: clampUnit((point.pressure - minPressure) / pressureRange),
	}))
}

function getPressureOpacityForPoint(pressure: number): number {
	const normalized = clampUnit(pressure)
	const phaseShift = Math.max(-0.45, Math.min(0.45, (pencilOpacitySensitivity - 1) * 0.2))
	const shifted = clampUnit(normalized + phaseShift)
	const eased = Math.pow(shifted, 1.65)
	return getPressureOpacityStyle(eased, 0.03, 0.55)
}

function lerp(start: number, end: number, t: number): number {
	return start + (end - start) * t
}

function distanceBetweenPoints(a: LocalPressurePoint, b: LocalPressurePoint): number {
	return Math.hypot(b.x - a.x, b.y - a.y)
}

function buildRectPoints(
	centerX: number,
	centerY: number,
	tangentX: number,
	tangentY: number,
	normalX: number,
	normalY: number,
	halfLength: number,
	halfWidth: number
) {
	const topLeft = {
		x: centerX - tangentX * halfLength - normalX * halfWidth,
		y: centerY - tangentY * halfLength - normalY * halfWidth,
	}
	const topRight = {
		x: centerX + tangentX * halfLength - normalX * halfWidth,
		y: centerY + tangentY * halfLength - normalY * halfWidth,
	}
	const bottomRight = {
		x: centerX + tangentX * halfLength + normalX * halfWidth,
		y: centerY + tangentY * halfLength + normalY * halfWidth,
	}
	const bottomLeft = {
		x: centerX - tangentX * halfLength + normalX * halfWidth,
		y: centerY - tangentY * halfLength + normalY * halfWidth,
	}

	return [topLeft, topRight, bottomRight, bottomLeft]
		.map((point) => `${point.x} ${point.y}`)
		.join(' ')
}

function interpolatePressurePoint(
	a: LocalPressurePoint,
	b: LocalPressurePoint,
	t: number
): LocalPressurePoint {
	return {
		x: lerp(a.x, b.x, t),
		y: lerp(a.y, b.y, t),
		pressure: lerp(a.pressure, b.pressure, t),
	}
}

function getAveragePressureOpacity(shape: TLDrawShape): number {
	const localPressurePoints = getLocalPressurePointsFromShape(shape)
	if (localPressurePoints.length === 0) return 0.28

	const averagePressure =
		localPressurePoints.reduce((sum, point) => sum + point.pressure, 0) / localPressurePoints.length
	return getPressureOpacityForPoint(averagePressure)
}

function cloneElementWithOpacity(node: React.ReactNode, opacity: number): React.ReactNode {
	if (!React.isValidElement(node)) return node
	return React.cloneElement(node, {
		...node.props,
		opacity,
		style: {
			...(node.props.style ?? {}),
			opacity,
		},
	})
}

function getPencilShapeStyle(shape: TLDrawShape): React.CSSProperties | undefined {
	const localPressurePoints = getLocalPressurePointsFromShape(shape)
	if (localPressurePoints.length > 1) return undefined

	if (shape.props.isPen) return undefined
	if (!shape.props.segments.length) {
		return {
			opacity: 0.28,
		}
	}
	return {
		opacity: 0.04,
	}
}

function buildPressureSampledRibbonStroke(shape: TLDrawShape, baseElement: React.ReactNode) {
	const localPressurePoints = getLocalPressurePointsFromShape(shape)
	if (localPressurePoints.length < 2) return null

	const basePath = findFirstPathElement(baseElement)
	if (!basePath) return null

	const strokeColor =
		typeof basePath.props.stroke === 'string'
			? basePath.props.stroke
			: typeof basePath.props.fill === 'string' && basePath.props.fill !== 'none'
				? basePath.props.fill
				: undefined
	if (!strokeColor) return null

	const strokeWidth =
		typeof basePath.props.strokeWidth === 'number'
			? basePath.props.strokeWidth
			: ((STROKE_SIZE_BY_STYLE[shape.props.size] ?? STROKE_SIZE_BY_STYLE.m) + 1) * shape.props.scale

	const paths: React.ReactNode[] = []
	const maxSampleLength = Math.max(2.2, strokeWidth * 1.1)

	for (let i = 0; i < localPressurePoints.length - 1; i++) {
		const p1 = localPressurePoints[i]
		const p2 = localPressurePoints[i + 1]
		if (p1.x === p2.x && p1.y === p2.y) continue

		const segmentLength = distanceBetweenPoints(p1, p2)
		const sampleCount = Math.max(1, Math.ceil(segmentLength / maxSampleLength))

		for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
			const startT = sampleIndex / sampleCount
			const endT = (sampleIndex + 1) / sampleCount
			const startPoint = interpolatePressurePoint(p1, p2, startT)
			const endPoint = interpolatePressurePoint(p1, p2, endT)
			const segmentLength = distanceBetweenPoints(startPoint, endPoint)
			if (segmentLength === 0) continue
			const centerX = (startPoint.x + endPoint.x) / 2
			const centerY = (startPoint.y + endPoint.y) / 2
			const tangentX = (endPoint.x - startPoint.x) / segmentLength
			const tangentY = (endPoint.y - startPoint.y) / segmentLength
			const normalX = -tangentY
			const normalY = tangentX
			const startOpacity = getPressureOpacityForPoint(startPoint.pressure)
			const endOpacity = getPressureOpacityForPoint(endPoint.pressure)
			const averagePressure = (startPoint.pressure + endPoint.pressure) / 2
			const averageOpacity = (startOpacity + endOpacity) / 2
			const sampledWidth = strokeWidth * lerp(0.72, 0.96, averagePressure)
			const sampledLength = Math.max(segmentLength, sampledWidth * pencilCrossSectionAspectRatio)

			paths.push(
				<polygon
					key={`${shape.id}-pressure-sample-${i}-${sampleIndex}`}
					points={buildRectPoints(
						centerX,
						centerY,
						tangentX,
						tangentY,
						normalX,
						normalY,
						sampledLength / 2,
						sampledWidth / 2
					)}
					fill={strokeColor}
					fillOpacity={Math.max(0.025, Math.min(0.26, averageOpacity * 0.42))}
				/>
			)
		}
	}

	if (paths.length === 0) return null

	return (
		<g pointerEvents="none">
			{paths}
		</g>
	)
}

function toRgba(color: string, alpha: number) {
	if (color.startsWith('#')) {
		const hex = color.slice(1)
		const expanded =
			hex.length === 3
				? hex
					.split('')
					.map((part) => part + part)
					.join('')
				: hex.length === 8
					? hex.slice(0, 6)
					: hex
		if (expanded.length === 6) {
			const r = Number.parseInt(expanded.slice(0, 2), 16)
			const g = Number.parseInt(expanded.slice(2, 4), 16)
			const b = Number.parseInt(expanded.slice(4, 6), 16)
			return `rgba(${r}, ${g}, ${b}, ${alpha})`
		}
	}

	const rgbMatch = color.match(/rgba?\(([^)]+)\)/i)
	if (rgbMatch) {
		const parts = rgbMatch[1].split(',').map((part) => part.trim())
		if (parts.length >= 3) {
			return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`
		}
	}

	return color
}

function cloneStrokeNode(node: React.ReactElement, overrides: React.CSSProperties): React.ReactElement {
	const strokeColor = typeof overrides.stroke === 'string' ? overrides.stroke : undefined
	const fillColor = typeof overrides.fill === 'string' ? overrides.fill : undefined
	return React.cloneElement(node, {
		...node.props,
		style: {
			...(node.props.style ?? {}),
			...overrides,
		},
		opacity: 1,
		stroke: strokeColor ?? node.props.stroke,
		fill: fillColor ?? node.props.fill,
		strokeOpacity: 1,
		fillOpacity: 1,
		strokeWidth:
			overrides.strokeWidth !== undefined ? overrides.strokeWidth : node.props.strokeWidth,
	})
}

function applyStrokeStyling(node: React.ReactNode, style: React.CSSProperties): React.ReactNode {
	if (!React.isValidElement(node)) return node

	if (node.type === 'path' && (node.props.stroke !== undefined || node.props.fill === 'none')) {
		const baseOpacity = typeof style.opacity === 'number' ? style.opacity : 1
		const strokeWidth = typeof node.props.strokeWidth === 'number' ? node.props.strokeWidth : undefined
		const stroke = typeof node.props.stroke === 'string' ? node.props.stroke : '#000000'
		return React.createElement(
			React.Fragment,
			null,
			cloneStrokeNode(node, {
				stroke: toRgba(stroke, Math.max(0.06, baseOpacity * 0.16)),
				strokeWidth: strokeWidth ? strokeWidth * 1.45 : undefined,
			}),
			cloneStrokeNode(node, {
				stroke: toRgba(stroke, Math.max(0.1, baseOpacity * 0.38)),
				strokeWidth: strokeWidth ? strokeWidth * 1.12 : undefined,
			}),
			cloneStrokeNode(node, {
				stroke: toRgba(stroke, Math.max(0.22, baseOpacity)),
				strokeWidth: strokeWidth ? strokeWidth * 0.94 : undefined,
			})
		)
	}

	if (node.type === 'path' && typeof node.props.fill === 'string' && node.props.fill !== 'none') {
		const baseOpacity = typeof style.opacity === 'number' ? style.opacity : 1
		const fill = node.props.fill
		return React.createElement(
			React.Fragment,
			null,
			cloneStrokeNode(node, {
				fill: toRgba(fill, Math.max(0.06, baseOpacity * 0.2)),
			}),
			cloneStrokeNode(node, {
				fill: toRgba(fill, Math.max(0.1, baseOpacity * 0.45)),
			}),
			cloneStrokeNode(node, {
				fill: toRgba(fill, Math.max(0.22, baseOpacity * 0.9)),
			})
		)
	}

	const children = node.props?.children
	if (children === undefined) {
		return React.cloneElement(node, node.props)
	}

	const styledChildren = React.Children.map(children, (child) => applyStrokeStyling(child, style))
	return React.cloneElement(node, {
		...node.props,
		children: styledChildren,
	})
}

function findFirstPathElement(
	node: React.ReactNode
): React.ReactElement<{ stroke?: string; strokeWidth?: number; style?: React.CSSProperties }> | null {
	if (!React.isValidElement(node)) return null
	if (node.type === 'path') {
		return node as React.ReactElement<{
			stroke?: string
			strokeWidth?: number
			style?: React.CSSProperties
		}>
	}

	const children = node.props?.children
	if (children === undefined) return null

	for (const child of React.Children.toArray(children)) {
		const pathElement = findFirstPathElement(child)
		if (pathElement) return pathElement
	}

	return null
}

function buildOpacityBuckets(bucketCount: number) {
	return Array.from({ length: bucketCount }, () => ({
		segments: [] as string[],
		sumOpacity: 0,
		count: 0,
	}))
}

function buildPressureGradientOverlay(
	shape: TLDrawShape,
	baseElement: React.ReactNode
) {
	let localPressurePoints = getLocalPressurePointsFromShape(shape)
	if (localPressurePoints.length < 2) return null

	const basePath = findFirstPathElement(baseElement)
	if (!basePath) return null

	const strokeOrFillColor =
		typeof basePath.props.stroke === 'string'
			? basePath.props.stroke
			: typeof basePath.props.fill === 'string' && basePath.props.fill !== 'none'
				? basePath.props.fill
				: undefined
	const computedStrokeWidth =
		typeof basePath.props.strokeWidth === 'number'
			? basePath.props.strokeWidth
			: ((STROKE_SIZE_BY_STYLE[shape.props.size] ?? STROKE_SIZE_BY_STYLE.m) + 1) * shape.props.scale
	if (!strokeOrFillColor) return null

	const bucketCount = 18
	const buckets = buildOpacityBuckets(bucketCount)

	for (let i = 0; i < localPressurePoints.length - 1; i++) {
		const p1 = localPressurePoints[i]
		const p2 = localPressurePoints[i + 1]
		const pressure1 = p1.pressure
		const pressure2 = p2.pressure
		const localOpacity =
			(getPressureOpacityStyle(pressure1) + getPressureOpacityStyle(pressure2)) / 2
		const bucketIndex = Math.max(0, Math.min(bucketCount - 1, Math.round(localOpacity * (bucketCount - 1))))
		const bucket = buckets[bucketIndex]
		bucket.segments.push(`M ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`)
		bucket.sumOpacity += localOpacity
		bucket.count += 1
	}

	const renderedBuckets = buckets
		.map((bucket, index) => ({
			...bucket,
			index,
			averageOpacity: bucket.count ? bucket.sumOpacity / bucket.count : 0,
		}))
		.filter((bucket) => bucket.count > 0)
		.sort((a, b) => a.averageOpacity - b.averageOpacity)

	if (renderedBuckets.length === 0) return null

	return (
		<g pointerEvents="none">
			{renderedBuckets.map((bucket) => (
				<path
					key={bucket.index}
					d={bucket.segments.join(' ')}
					stroke={toRgba(strokeOrFillColor, Math.max(0.01, Math.min(0.55, bucket.averageOpacity)))}
					strokeWidth={computedStrokeWidth}
					strokeLinecap="butt"
					strokeLinejoin="round"
					fill="none"
				/>
			))}
		</g>
	)
}

/**
 * Pencil draw shape util that keeps the built-in draw geometry/rendering, but
 * applies a grain filter and pressure-based opacity when the pencil tool has
 * captured pressure data for the shape.
 */
export class PencilDrawShapeUtil extends DrawShapeUtil {
	override component(shape: TLDrawShape) {
		console.log('[PencilDrawShapeUtil.component] rendering shape', {
			shapeId: shape.id,
			pencilDefaultStrokeEnabled,
			pencilCrossSectionAspectRatio,
			willRender: pencilDefaultStrokeEnabled ? 'full' : 'empty-g',
		})
		const element = super.component(shape)
		const ribbonStroke = buildPressureSampledRibbonStroke(shape, element)
		if (!pencilDefaultStrokeEnabled && pencilCrossSectionAspectRatio === 1) {
			return <g pointerEvents="none" />
		}
		if (pencilCrossSectionAspectRatio !== 1 && ribbonStroke) {
			return ribbonStroke
		}
		if (ribbonStroke) {
			return React.createElement(
				React.Fragment,
				null,
				pencilBaseStrokeEnabled ? cloneElementWithOpacity(element, getAveragePressureOpacity(shape)) : null,
				ribbonStroke
			)
		}
		const style = getPencilShapeStyle(shape)
		if (!pencilFallbackStylingEnabled) return element
		return style ? applyStrokeStyling(element, style) : element
	}

	override toSvg(shape: TLDrawShape, ctx: SvgExportContext) {
		console.log('[PencilDrawShapeUtil.toSvg] exporting shape', {
			shapeId: shape.id,
			pencilDefaultStrokeEnabled,
			pencilCrossSectionAspectRatio,
			willRender: pencilDefaultStrokeEnabled ? 'full' : 'empty-g',
		})
		const element = super.toSvg(shape, ctx)
		const ribbonStroke = buildPressureSampledRibbonStroke(shape, element)
		if (!pencilDefaultStrokeEnabled && pencilCrossSectionAspectRatio === 1) {
			return <g pointerEvents="none" />
		}
		if (pencilCrossSectionAspectRatio !== 1 && ribbonStroke) {
			return ribbonStroke
		}
		if (ribbonStroke) {
			return React.createElement(
				React.Fragment,
				null,
				pencilBaseStrokeEnabled ? cloneElementWithOpacity(element, getAveragePressureOpacity(shape)) : null,
				ribbonStroke
			)
		}
		const style = getPencilShapeStyle(shape)
		if (!pencilFallbackStylingEnabled) return element
		return style ? applyStrokeStyling(element, style) : element
	}
}

export const PENCIL_SHAPE_UTILS: readonly TLAnyShapeUtilConstructor[] = [
	...defaultShapeUtils.filter((shapeUtil) => shapeUtil.type !== 'draw'),
	PencilDrawShapeUtil,
]