import { TLDrawShape, TLShapeId } from 'tldraw'

export type StrokePoint = {
	x: number
	y: number
}

export type Stroke = StrokePoint[]

export type StrokeCollection = Stroke[]

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

export type StrokeListenerOptions = {
	debug?: boolean
	onStrokeExtracted?: (result: StrokeExtractionResult) => void
}
