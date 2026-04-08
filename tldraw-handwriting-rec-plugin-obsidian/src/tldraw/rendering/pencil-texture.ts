/**
 * Pencil texture utilities for adding grain and realistic appearance to strokes.
 */

/**
 * Generate a procedural noise-based grain texture as an SVG filter
 * that can be applied to draw shapes for a realistic pencil look.
 */
export function createPencilGrainFilter(filterId: string, intensity: number = 0.15): SVGFilterElement {
	const filter = document.createElementNS('http://www.w3.org/2000/svg', 'filter')
	filter.id = filterId
	filter.setAttribute('x', '-50%')
	filter.setAttribute('y', '-50%')
	filter.setAttribute('width', '200%')
	filter.setAttribute('height', '200%')

	// Turbulence creates Perlin-like noise
	const turbulence = document.createElementNS('http://www.w3.org/2000/svg', 'feTurbulence')
	turbulence.setAttribute('type', 'fractalNoise')
	turbulence.setAttribute('baseFrequency', `0.9`) // Controls grain size (higher = finer)
	turbulence.setAttribute('numOctaves', '4')
	turbulence.setAttribute('result', 'noise')
	turbulence.setAttribute('seed', '42') // Deterministic for consistency

	// DisplacementMap creates texture displacement effect
	const displace = document.createElementNS('http://www.w3.org/2000/svg', 'feDisplacementMap')
	displace.setAttribute('in', 'SourceGraphic')
	displace.setAttribute('in2', 'noise')
	displace.setAttribute('scale', `${intensity * 3}`) // Increased multiplier for more visible effect
	displace.setAttribute('xChannelSelector', 'R')
	displace.setAttribute('yChannelSelector', 'G')

	// Add turbulence for luminosity variation (grain appearance)
	const feTurbulence2 = document.createElementNS('http://www.w3.org/2000/svg', 'feTurbulence')
	feTurbulence2.setAttribute('type', 'fractalNoise')
	feTurbulence2.setAttribute('baseFrequency', '1.2')
	feTurbulence2.setAttribute('numOctaves', '3')
	feTurbulence2.setAttribute('result', 'grain')
	feTurbulence2.setAttribute('seed', '42')

	// Overlay grain as opacity variation
	const composite = document.createElementNS('http://www.w3.org/2000/svg', 'feComposite')
	composite.setAttribute('in', 'SourceGraphic')
	composite.setAttribute('in2', 'grain')
	composite.setAttribute('operator', 'multiply')
	composite.setAttribute('result', 'textured')

	// Optional: add slight color shift for pencil warmth
	const colorMatrix = document.createElementNS('http://www.w3.org/2000/svg', 'feColorMatrix')
	colorMatrix.setAttribute('in', 'textured')
	colorMatrix.setAttribute('type', 'saturate')
	colorMatrix.setAttribute('values', '0.95')

	filter.appendChild(turbulence)
	filter.appendChild(displace)
	filter.appendChild(feTurbulence2)
	filter.appendChild(composite)
	filter.appendChild(colorMatrix)

	return filter
}

/**
 * Apply pressure-based opacity modulation to a stroke path.
 * Returns a styled stroke that respects pressure values encoded in point data.
 * 
 * For tldraw integration: extract z-values from draw shape points
 * and modulate stroke-opacity during rendering.
 */
export function getPressureOpacityStyle(
	basePressure: number,
	minOpacity: number = 0.02,
	maxOpacity: number = 0.45
): number {
	// Clamp pressure to [0, 1]
	const p = Math.max(0, Math.min(1, basePressure))
	// Mild nonlinear contrast while preserving enough mid-range variation.
	const contrastPressure = p * p * 0.8 + p * 0.2
	return minOpacity + contrastPressure * (maxOpacity - minOpacity)
}

/**
 * Generate a subtle crosshatch/grain pattern as an SVG pattern fill.
 * Can be used as a post-processing texture overlay.
 */
export function createPencilGrainPattern(patternId: string, scale: number = 1): SVGPatternElement {
	const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern')
	pattern.id = patternId
	pattern.setAttribute('x', '0')
	pattern.setAttribute('y', '0')
	pattern.setAttribute('width', `${4 * scale}`)
	pattern.setAttribute('height', `${4 * scale}`)
	pattern.setAttribute('patternUnits', 'userSpaceOnUse')

	// Create subtle crosshatch lines
	const line1 = document.createElementNS('http://www.w3.org/2000/svg', 'line')
	line1.setAttribute('x1', '0')
	line1.setAttribute('y1', '0')
	line1.setAttribute('x2', `${4 * scale}`)
	line1.setAttribute('y2', `${4 * scale}`)
	line1.setAttribute('stroke', 'rgba(0, 0, 0, 0.03)')
	line1.setAttribute('stroke-width', '0.5')

	const line2 = document.createElementNS('http://www.w3.org/2000/svg', 'line')
	line2.setAttribute('x1', `${4 * scale}`)
	line2.setAttribute('y1', '0')
	line2.setAttribute('x2', '0')
	line2.setAttribute('y2', `${4 * scale}`)
	line2.setAttribute('stroke', 'rgba(0, 0, 0, 0.03)')
	line2.setAttribute('stroke-width', '0.5')

	pattern.appendChild(line1)
	pattern.appendChild(line2)

	return pattern
}

function sampleNoise2d(x: number, y: number): number {
	const t = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
	return t - Math.floor(t)
}

export function applyGrainToDab(
	ctx: CanvasRenderingContext2D,
	x: number,
	y: number,
	size: number,
	intensity: number
): void {
	const clampedIntensity = Math.max(0, Math.min(1, intensity))
	if (clampedIntensity <= 0) return

	const radius = Math.max(2, size / 2)
	const dots = Math.max(16, Math.floor(radius * 1.8))

	ctx.save()
	ctx.globalCompositeOperation = 'multiply'
	ctx.globalAlpha = clampedIntensity
	ctx.fillStyle = 'rgba(0,0,0,1)'

	for (let i = 0; i < dots; i++) {
		const angle = sampleNoise2d(x + i * 1.13, y - i * 0.91) * Math.PI * 2
		const dist = Math.sqrt(sampleNoise2d(x - i * 0.37, y + i * 1.71)) * radius
		const px = x + Math.cos(angle) * dist
		const py = y + Math.sin(angle) * dist
		const pr = Math.max(0.35, sampleNoise2d(px, py) * 1.5)
		ctx.beginPath()
		ctx.arc(px, py, pr, 0, Math.PI * 2)
		ctx.fill()
	}

	ctx.restore()
}

/**
 * Inject pencil texture definitions into the SVG defs section.
 * Call this once during editor initialization to make filters available.
 */
export function injectPencilTexureFilters(svgElement: SVGSVGElement): void {
	let defs = svgElement.querySelector('defs')
	if (!defs) {
		defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
		svgElement.prepend(defs)
	}

	// Check if filters already exist
	if (!defs.querySelector('#pencil-grain-filter')) {
		defs.appendChild(createPencilGrainFilter('pencil-grain-filter', 0.12))
	}

	if (!defs.querySelector('#pencil-grain-pattern')) {
		defs.appendChild(createPencilGrainPattern('pencil-grain-pattern', 1.2))
	}
}

/**
 * Apply grain texture filter to a shape element.
 */
export function applyGrainTextureToElement(element: SVGElement): void {
	element.style.filter = 'url(#pencil-grain-filter)'
}

/**
 * Configuration for pencil texture effect strength
 */
export type PencilTextureConfig = {
	/** Grain texture intensity (0-1) */
	grainIntensity: number
	/** Minimum opacity for pressure-based variation (0-1) */
	minOpacity: number
	/** Maximum opacity for pressure-based variation (0-1) */
	maxOpacity: number
	/** Enable grain texture overlay */
	enableGrain: boolean
	/** Enable pressure-based opacity */
	enablePressureOpacity: boolean
}

export const DEFAULT_PENCIL_TEXTURE_CONFIG: PencilTextureConfig = {
	grainIntensity: 0.12,
	minOpacity: 0.4,
	maxOpacity: 1.0,
	enableGrain: true,
	enablePressureOpacity: true,
}
