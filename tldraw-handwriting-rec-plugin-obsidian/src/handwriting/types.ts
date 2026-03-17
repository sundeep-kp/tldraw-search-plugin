import { TLDrawShape, TLShapeId } from 'tldraw'

export type StrokePoint = {
	x: number
	y: number
}

export type Stroke = StrokePoint[]

export type StrokeCollection = Stroke[]

export type StrokeBounds = {
	minX: number
	minY: number
	maxX: number
	maxY: number
	width: number
	height: number
}

export type CompletedDrawShape = TLDrawShape & {
	props: TLDrawShape['props'] & {
		isComplete: true
	}
}

export type StrokeExtractionResult = {
	shapeId: TLShapeId
	shape: CompletedDrawShape
	strokes: StrokeCollection
}

export type NormalizedStrokePayload = {
	shapeId: TLShapeId
	rawStrokes: StrokeCollection
	normalizedStrokes: StrokeCollection
	shapePosition: StrokePoint
	bounds: StrokeBounds
	worldBounds: StrokeBounds
	scale: number
	timestamp: number
}

export type StrokeListenerOptions = {
	debug?: boolean
	onStrokeExtracted?: (result: StrokeExtractionResult) => void
}
