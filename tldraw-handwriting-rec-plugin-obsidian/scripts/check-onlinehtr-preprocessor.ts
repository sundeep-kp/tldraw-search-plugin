import { preprocessGroupForOnlineHtr, toOnnxInkInput } from 'src/handwriting/preprocessors/onlineHtrCarbune2020'
import { StrokeGroupCandidate } from 'src/handwriting/strokeGrouping'
import { NormalizedStrokePayload } from 'src/handwriting/types'

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message)
	}
}

function createPayload(shapeId: string, offsetX: number, offsetY: number, timestamp: number) {
	const payload: NormalizedStrokePayload = {
		shapeId: shapeId as any,
		rawStrokes: [
			[
				{ x: 0, y: 0 },
				{ x: 10, y: 0 },
				{ x: 10, y: 10 },
			],
		],
		normalizedStrokes: [],
		shapePosition: { x: offsetX, y: offsetY },
		bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10, width: 10, height: 10 },
		worldBounds: {
			minX: offsetX,
			minY: offsetY,
			maxX: offsetX + 10,
			maxY: offsetY + 10,
			width: 10,
			height: 10,
		},
		scale: 10,
		timestamp,
	}
	return payload
}

function run() {
	const payloadA = createPayload('shape:a', 100, 200, 1000)
	const payloadB = createPayload('shape:b', 120, 205, 1200)

	const group: StrokeGroupCandidate = {
		id: 'group:test',
		shapeIds: [payloadA.shapeId, payloadB.shapeId],
		payloads: [payloadA, payloadB],
		boundingBox: { minX: 100, minY: 200, maxX: 130, maxY: 215, width: 30, height: 15 },
		startedAt: 1000,
		endedAt: 1200,
	}

	const result = preprocessGroupForOnlineHtr(group)
	assert(result, 'Expected preprocessor result to be non-null.')
	assert(result.channels === 4, `Expected channels=4, got ${result.channels}.`)
	assert(result.timeSteps > 0, `Expected timeSteps > 0, got ${result.timeSteps}.`)
	assert(
		result.ink.length === result.timeSteps * result.channels,
		`Expected ink length ${result.timeSteps * result.channels}, got ${result.ink.length}.`
	)

	for (let i = 0; i < result.ink.length; i++) {
		assert(Number.isFinite(result.ink[i]), `Found non-finite value at ink index ${i}.`)
	}

	const firstRowOffset = 0
	const firstDx = result.ink[firstRowOffset]
	const firstDy = result.ink[firstRowOffset + 1]
	const firstDt = result.ink[firstRowOffset + 2]
	const firstN = result.ink[firstRowOffset + 3]
	assert(firstDx === 0, `Expected first dx=0, got ${firstDx}.`)
	assert(firstDy === 0, `Expected first dy=0, got ${firstDy}.`)
	assert(firstDt === 0, `Expected first dt=0, got ${firstDt}.`)
	assert(firstN === 1, `Expected first n=1, got ${firstN}.`)

	let strokeStartMarkerCount = 0
	for (let i = 0; i < result.timeSteps; i++) {
		if (result.ink[i * 4 + 3] === 1) {
			strokeStartMarkerCount += 1
		}
	}
	assert(strokeStartMarkerCount >= 2, 'Expected at least two stroke start markers for two source strokes.')

	const onnxInput = toOnnxInkInput(result)
	assert(onnxInput.dims[0] === result.timeSteps, 'Expected ONNX dims[0] to match timeSteps.')
	assert(onnxInput.dims[1] === 1, 'Expected ONNX batch dimension to be 1.')
	assert(onnxInput.dims[2] === 4, 'Expected ONNX channel dimension to be 4.')

	console.log('[check-onlinehtr-preprocessor] PASS', {
		timeSteps: result.timeSteps,
		strokeStartMarkerCount,
		onnxDims: onnxInput.dims,
	})
}

run()
