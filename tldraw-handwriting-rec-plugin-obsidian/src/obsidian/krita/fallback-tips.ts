import { applyGrainToDab } from 'src/tldraw/rendering/pencil-texture'

type BrushProfileLike = {
	baseSize: number
	pencilCrossSectionAspectRatio?: number
	pencilTextureIntensity?: number
}

type Canvas2dContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value))
}

function drawSoftEllipse(
	ctx: Canvas2dContext,
	size: number,
	aspectRatio: number,
	alpha: number
): void {
	const cx = size / 2
	const cy = size / 2
	const rx = size * 0.46
	const ry = rx * aspectRatio
	ctx.save()
	ctx.translate(cx, cy)
	const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx)
	g.addColorStop(0, `rgba(0,0,0,${alpha})`)
	g.addColorStop(0.75, `rgba(0,0,0,${alpha * 0.55})`)
	g.addColorStop(1, 'rgba(0,0,0,0)')
	ctx.fillStyle = g
	ctx.beginPath()
	ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
	ctx.fill()
	ctx.restore()
}

function drawHardRoundTip(ctx: Canvas2dContext, size: number, alpha: number): void {
	const cx = size / 2
	const cy = size / 2
	const r = size * 0.42
	ctx.fillStyle = `rgba(0,0,0,${alpha})`
	ctx.beginPath()
	ctx.arc(cx, cy, r, 0, Math.PI * 2)
	ctx.fill()
}

function drawRadialCircle(ctx: Canvas2dContext, size: number): void {
	const cx = size / 2
	const cy = size / 2
	const r = size * 0.45
	const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
	g.addColorStop(0, 'rgba(0,0,0,1)')
	g.addColorStop(1, 'rgba(0,0,0,0)')
	ctx.fillStyle = g
	ctx.beginPath()
	ctx.arc(cx, cy, r, 0, Math.PI * 2)
	ctx.fill()
}

export async function generateFallbackTip(
	presetName: string,
	profile: BrushProfileLike,
	size: number
): Promise<ImageBitmap> {
	const tipSize = Math.max(16, Math.round(size))
	const canvas = new OffscreenCanvas(tipSize, tipSize)
	const ctx = canvas.getContext('2d')
	if (!ctx) throw new Error('Could not create fallback tip rendering context')

	const name = presetName.toLowerCase()
	const texture = clamp(profile.pencilTextureIntensity ?? 0.35, 0, 1)

	if (/(pencil|graphite|basic)/.test(name)) {
		const aspect = clamp(
			profile.pencilCrossSectionAspectRatio
				? 1 / Math.max(1, profile.pencilCrossSectionAspectRatio)
				: 0.6,
			0.2,
			1
		)
		drawSoftEllipse(ctx, tipSize, aspect, 1)
		applyGrainToDab(ctx, tipSize / 2, tipSize / 2, tipSize * 0.92, Math.max(0.15, texture))
	} else if (/(ink|pen|liner|marker)/.test(name)) {
		drawHardRoundTip(ctx, tipSize, 0.98)
		applyGrainToDab(ctx, tipSize / 2, tipSize / 2, tipSize * 0.85, Math.min(0.05, texture))
	} else if (/(charcoal|chalk|pastel)/.test(name)) {
		drawSoftEllipse(ctx, tipSize, 0.4, 0.95)
		ctx.save()
		ctx.globalCompositeOperation = 'multiply'
		applyGrainToDab(ctx, tipSize / 2, tipSize / 2, tipSize, Math.max(0.45, texture))
		ctx.restore()
	} else {
		drawRadialCircle(ctx, tipSize)
	}

	return createImageBitmap(canvas)
}
