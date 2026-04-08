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

/**
 * Module-level reference to the active brush tip bitmap.
 * Set by TldrawApp to make the brush context accessible to the renderer.
 */
export const activeBrushTipRef: React.MutableRefObject<ImageBitmap | null> = { current: null }
export type StampShapeMode = 'auto' | 'circle' | 'rectangle'
export const activeStampShapeModeRef: React.MutableRefObject<StampShapeMode> = {
	current: 'auto',
}

/**
 * Cache for ImageBitmap -> data URL conversions to avoid repeated rendering.
 */
const bitmapDataUrlCache = new WeakMap<ImageBitmap, string>()

/**
 * Converts an ImageBitmap to a data URL for use in SVG <image> elements.
 */
function imageBitmapToDataUrl(bitmap: ImageBitmap): string {
	if (bitmapDataUrlCache.has(bitmap)) {
		return bitmapDataUrlCache.get(bitmap)!
	}

	const canvas = document.createElement('canvas')
	canvas.width = bitmap.width
	canvas.height = bitmap.height
	const ctx = canvas.getContext('2d')
	if (!ctx) throw new Error('Failed to create 2D canvas context')

	ctx.drawImage(bitmap, 0, 0)
	const dataUrl = canvas.toDataURL('image/png')
	bitmapDataUrlCache.set(bitmap, dataUrl)
	return dataUrl
}

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
	pencilBaseStrokeEnabled = value
}

export function setPencilSampledOverlayEnabled(value: boolean) {
	pencilSampledOverlayEnabled = value
}

export function setPencilFallbackStylingEnabled(value: boolean) {
	pencilFallbackStylingEnabled = value
}

export function setPencilDefaultStrokeEnabled(value: boolean) {
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

function wrapForHtmlRender(node: React.ReactNode): React.ReactNode {
	if (!node) return node
	return (
		<svg pointerEvents="none" style={{ overflow: 'visible' }}>
			{node}
		</svg>
	)
}

function buildPressureSampledRibbonStroke(shape: TLDrawShape, baseElement: React.ReactNode) {
	const localPressurePoints = getLocalPressurePointsFromShape(shape)
	if (localPressurePoints.length < 2) return null

	const basePath = findFirstPathElement(baseElement)

	const strokeColor =
		basePath && typeof basePath.props.stroke === 'string'
			? basePath.props.stroke
			: basePath && typeof basePath.props.fill === 'string' && basePath.props.fill !== 'none'
				? basePath.props.fill
				: '#000000'

	const strokeWidth =
		basePath && typeof basePath.props.strokeWidth === 'number'
			? basePath.props.strokeWidth
			: ((STROKE_SIZE_BY_STYLE[shape.props.size] ?? STROKE_SIZE_BY_STYLE.m) + 1) * shape.props.scale

	const paths: React.ReactNode[] = []
	// Performance: sample fewer dabs per segment to keep stroke rendering responsive.
	const maxSampleLength = Math.max(4.5, strokeWidth * 2.4)
	const stampShapeMode = activeStampShapeModeRef.current

	if (stampShapeMode === 'circle') {
		return buildCircleStampStroke(localPressurePoints, strokeColor, strokeWidth, maxSampleLength, shape.id)
	}

	if (stampShapeMode === 'rectangle') {
		return buildRectangleStampStroke(localPressurePoints, strokeColor, strokeWidth, maxSampleLength, shape.id)
	}

	// Check if we should use a brush bitmap stamp instead of polygon rendering
	const brushBitmap = activeBrushTipRef.current
	const useBrushStamp = brushBitmap !== null

	if (useBrushStamp && brushBitmap) {
		// Use brush bitmap stamping
		let brushDataUrl: string
		try {
			brushDataUrl = imageBitmapToDataUrl(brushBitmap)
		} catch (error) {
			console.error('[PencilDrawShapeUtil] Failed to convert brush bitmap to data URL:', error)
			// Fall back to polygon rendering
			return buildPolygonRibbonStroke(
				shape,
				localPressurePoints,
				strokeColor,
				strokeWidth,
				maxSampleLength
			)
		}

		for (let i = 0; i < localPressurePoints.length - 1; i++) {
			const p1 = localPressurePoints[i]
			const p2 = localPressurePoints[i + 1]
			if (p1.x === p2.x && p1.y === p2.y) continue

			const segmentLength = distanceBetweenPoints(p1, p2)
			const sampleCount = Math.max(1, Math.ceil(segmentLength / maxSampleLength))
			const sampleStride = sampleCount > 20 ? 2 : 1

			for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += sampleStride) {
				const startT = sampleIndex / sampleCount
				const endT = Math.min(1, (sampleIndex + sampleStride) / sampleCount)
				const startPoint = interpolatePressurePoint(p1, p2, startT)
				const endPoint = interpolatePressurePoint(p1, p2, endT)
				const segmentLength = distanceBetweenPoints(startPoint, endPoint)
				if (segmentLength === 0) continue

				const centerX = (startPoint.x + endPoint.x) / 2
				const centerY = (startPoint.y + endPoint.y) / 2
				const tangentX = (endPoint.x - startPoint.x) / segmentLength
				const tangentY = (endPoint.y - startPoint.y) / segmentLength
				const angle = Math.atan2(tangentY, tangentX) * (180 / Math.PI)

				const averagePressure = (startPoint.pressure + endPoint.pressure) / 2
				const sampledSize = strokeWidth * lerp(0.72, 0.96, averagePressure)

				// Use SVG transform for proper rotation instead of CSS
				const transformStr = `translate(${centerX} ${centerY}) rotate(${angle}) translate(${-sampledSize / 2} ${-sampledSize / 2})`

				paths.push(
					<image
						key={`${shape.id}-brush-stamp-${i}-${sampleIndex}`}
						href={brushDataUrl}
						x={0}
						y={0}
						width={sampledSize}
						height={sampledSize}
						opacity={Math.max(0.25, Math.min(1, averagePressure * 0.9))}
						transform={transformStr}
						pointerEvents="none"
					/>
				)
			}
		}
	} else {
		// Fall back to polygon rendering when no brush bitmap
		return buildPolygonRibbonStroke(
			shape,
			localPressurePoints,
			strokeColor,
			strokeWidth,
			maxSampleLength
		)
	}

	if (paths.length === 0) return null

	return (
		<g pointerEvents="none">
			{paths}
		</g>
	)
}

function buildCircleStampStroke(
	localPressurePoints: LocalPressurePoint[],
	strokeColor: string,
	strokeWidth: number,
	maxSampleLength: number,
	shapeId: string
): React.ReactNode {
	const paths: React.ReactNode[] = []

	for (let i = 0; i < localPressurePoints.length - 1; i++) {
		const p1 = localPressurePoints[i]
		const p2 = localPressurePoints[i + 1]
		if (p1.x === p2.x && p1.y === p2.y) continue

		const segmentLength = distanceBetweenPoints(p1, p2)
		const sampleCount = Math.max(1, Math.ceil(segmentLength / maxSampleLength))
		const sampleStride = sampleCount > 20 ? 2 : 1

		for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += sampleStride) {
			const startT = sampleIndex / sampleCount
			const endT = Math.min(1, (sampleIndex + sampleStride) / sampleCount)
			const startPoint = interpolatePressurePoint(p1, p2, startT)
			const endPoint = interpolatePressurePoint(p1, p2, endT)
			const centerX = (startPoint.x + endPoint.x) / 2
			const centerY = (startPoint.y + endPoint.y) / 2
			const startOpacity = getPressureOpacityForPoint(startPoint.pressure)
			const endOpacity = getPressureOpacityForPoint(endPoint.pressure)
			const averagePressure = (startPoint.pressure + endPoint.pressure) / 2
			const averageOpacity = (startOpacity + endOpacity) / 2
			const sampledSize = strokeWidth * lerp(0.72, 0.96, averagePressure)
			const baseRadius = Math.max(0.2, sampledSize / 2)
			const layers = [
				{ scale: 1.18, opacity: 0.12 },
				{ scale: 0.92, opacity: 0.34 },
				{ scale: 0.68, opacity: 0.58 },
			]

			for (const [layerIndex, layer] of layers.entries()) {
				paths.push(
					<circle
						key={`${shapeId}-circle-stamp-${i}-${sampleIndex}-${layerIndex}`}
						cx={centerX}
						cy={centerY}
						r={baseRadius * layer.scale}
						fill={strokeColor}
						fillOpacity={Math.max(0.04, Math.min(0.42, averageOpacity * layer.opacity))}
					/>
				)
			}
		}
	}

	if (paths.length === 0) return null

	return <g pointerEvents="none">{paths}</g>
}

function buildRectangleStampStroke(
	localPressurePoints: LocalPressurePoint[],
	strokeColor: string,
	strokeWidth: number,
	maxSampleLength: number,
	shapeId: string
): React.ReactNode {
	const paths: React.ReactNode[] = []

	for (let i = 0; i < localPressurePoints.length - 1; i++) {
		const p1 = localPressurePoints[i]
		const p2 = localPressurePoints[i + 1]
		if (p1.x === p2.x && p1.y === p2.y) continue

		const segmentLength = distanceBetweenPoints(p1, p2)
		const sampleCount = Math.max(1, Math.ceil(segmentLength / maxSampleLength))
		const sampleStride = sampleCount > 20 ? 2 : 1

		for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += sampleStride) {
			const startT = sampleIndex / sampleCount
			const endT = Math.min(1, (sampleIndex + sampleStride) / sampleCount)
			const startPoint = interpolatePressurePoint(p1, p2, startT)
			const endPoint = interpolatePressurePoint(p1, p2, endT)
			const segmentLen = distanceBetweenPoints(startPoint, endPoint)
			if (segmentLen === 0) continue
			const centerX = (startPoint.x + endPoint.x) / 2
			const centerY = (startPoint.y + endPoint.y) / 2
			const tangentX = (endPoint.x - startPoint.x) / segmentLen
			const tangentY = (endPoint.y - startPoint.y) / segmentLen
			const normalX = -tangentY
			const normalY = tangentX
			const startOpacity = getPressureOpacityForPoint(startPoint.pressure)
			const endOpacity = getPressureOpacityForPoint(endPoint.pressure)
			const averagePressure = (startPoint.pressure + endPoint.pressure) / 2
			const averageOpacity = (startOpacity + endOpacity) / 2
			const sampledSize = strokeWidth * lerp(0.72, 0.96, averagePressure)

			paths.push(
				<polygon
					key={`${shapeId}-rect-stamp-${i}-${sampleIndex}`}
					points={buildRectPoints(
						centerX,
						centerY,
						tangentX,
						tangentY,
						normalX,
						normalY,
						sampledSize / 2,
						sampledSize / 2
					)}
					fill={strokeColor}
					fillOpacity={Math.max(0.045, Math.min(0.32, averageOpacity * 0.55))}
				/>
			)
		}
	}

	if (paths.length === 0) return null

	return <g pointerEvents="none">{paths}</g>
}

/**
 * Build polygon-based ribbon stroke (original implementation)
 */
function buildPolygonRibbonStroke(
	shape: TLDrawShape,
	localPressurePoints: LocalPressurePoint[],
	strokeColor: string,
	strokeWidth: number,
	maxSampleLength: number
): React.ReactNode {
	const paths: React.ReactNode[] = []

	for (let i = 0; i < localPressurePoints.length - 1; i++) {
		const p1 = localPressurePoints[i]
		const p2 = localPressurePoints[i + 1]
		if (p1.x === p2.x && p1.y === p2.y) continue

		const segmentLength = distanceBetweenPoints(p1, p2)
		const sampleCount = Math.max(1, Math.ceil(segmentLength / maxSampleLength))
		const sampleStride = sampleCount > 20 ? 2 : 1

		for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += sampleStride) {
			const startT = sampleIndex / sampleCount
			const endT = Math.min(1, (sampleIndex + sampleStride) / sampleCount)
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
	private shouldBypassRibbonForDebugShape(shape: TLDrawShape): boolean {
		const meta = (shape as { meta?: Record<string, unknown> }).meta
		return meta?.ptlDebugNoRibbon === true
	}

	override component(shape: TLDrawShape) {
		const element = super.component(shape)
		if (this.shouldBypassRibbonForDebugShape(shape)) {
			return element
		}
		const ribbonStroke = buildPressureSampledRibbonStroke(shape, element)
		// Never return an empty group for a valid draw shape; keep at least base element visible.
		if (pencilCrossSectionAspectRatio !== 1 && ribbonStroke) {
			return wrapForHtmlRender(ribbonStroke)
		}
		if (ribbonStroke) {
			return React.createElement(
				React.Fragment,
				null,
				pencilBaseStrokeEnabled ? cloneElementWithOpacity(element, getAveragePressureOpacity(shape)) : null,
				wrapForHtmlRender(ribbonStroke)
			)
		}
		const style = getPencilShapeStyle(shape)
		if (!pencilFallbackStylingEnabled) return element
		return style ? applyStrokeStyling(element, style) : element
	}

	override toSvg(shape: TLDrawShape, ctx: SvgExportContext) {
		const element = super.toSvg(shape, ctx)
		if (this.shouldBypassRibbonForDebugShape(shape)) {
			return element
		}
		const ribbonStroke = buildPressureSampledRibbonStroke(shape, element)
		// Never export an empty group for a valid draw shape; keep at least base element visible.
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