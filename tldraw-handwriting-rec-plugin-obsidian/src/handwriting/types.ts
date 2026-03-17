import type { StrokeGroupCandidate } from 'src/handwriting/strokeGrouping'
import type { OnlineHtrModelConfig } from 'src/handwriting/modelConfig'
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

export type RecognitionStatus = 'pending' | 'success' | 'error'

export type RecognitionCandidate = {
	text: string
	confidence: number
}

export type RecognitionResult = {
	groupId: string
	shapeIds: TLShapeId[]
	boundingBox: StrokeBounds
	fingerprint: string
	status: RecognitionStatus
	updatedAt: number
	candidates: RecognitionCandidate[]
	error?: string
}

export interface HandwritingRecognizer {
	recognize(group: StrokeGroupCandidate): Promise<RecognitionCandidate[]>
	isReady(): boolean
	dispose(): Promise<void>
}

export type RecognizerEngine = 'stub' | 'onnx-web'

export type RecognizerFactoryOptions = {
	engine?: RecognizerEngine
	onnxModelConfig?: OnlineHtrModelConfig
}
