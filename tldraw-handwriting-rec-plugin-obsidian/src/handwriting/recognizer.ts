import { StrokeGroupCandidate } from 'src/handwriting/strokeGrouping'
import { decodeGreedyCtc } from 'src/handwriting/ctcDecoder'
import { DEFAULT_ONLINE_HTR_MODEL_CONFIG, OnlineHtrModelConfig } from 'src/handwriting/modelConfig'
import { preprocessGroupForOnlineHtr } from 'src/handwriting/preprocessors/onlineHtrCarbune2020'
import {
	HandwritingRecognizer,
	RecognitionCandidate,
	RecognizerFactoryOptions,
} from 'src/handwriting/types'

type OnnxRuntimeWebModule = typeof import('onnxruntime-web')

class StubRecognizer implements HandwritingRecognizer {
	isReady() {
		return true
	}

	async recognize(group: StrokeGroupCandidate): Promise<RecognitionCandidate[]> {
		const text = `stub-${group.shapeIds.length}-${group.payloads.length}`
		return [
			{
				text,
				confidence: 0.5,
			},
		]
	}

	async dispose(): Promise<void> {
		return
	}
}

class OnnxWebRecognizer implements HandwritingRecognizer {
	private session?: import('onnxruntime-web').InferenceSession
	private ort?: OnnxRuntimeWebModule

	constructor(private readonly config: OnlineHtrModelConfig) {}

	isReady() {
		return !!this.session
	}

	private async ensureSession() {
		if (this.session) return this.session

		if (!this.config.modelUrl) {
			throw new Error('OnnxWebRecognizer requires a non-empty modelUrl in onnxModelConfig.')
		}
		if (!Array.isArray(this.config.alphabet) || this.config.alphabet.length === 0) {
			throw new Error('OnnxWebRecognizer requires a non-empty alphabet in onnxModelConfig.')
		}

		this.ort = await import('onnxruntime-web')
		this.session = await this.ort.InferenceSession.create(this.config.modelUrl)
		return this.session
	}

	async recognize(group: StrokeGroupCandidate): Promise<RecognitionCandidate[]> {
		const prepared = preprocessGroupForOnlineHtr(group)
		if (!prepared) {
			throw new Error('Unable to preprocess stroke group for OnlineHTR ONNX inference.')
		}

		const session = await this.ensureSession()
		if (!this.ort) {
			throw new Error('ONNX runtime module failed to initialize.')
		}

		const inputName = this.config.inputName ?? session.inputNames[0]
		const outputName = this.config.outputName ?? session.outputNames[0]
		if (!inputName || !outputName) {
			throw new Error('Unable to resolve ONNX input/output names for recognizer session.')
		}

		const tensor = new this.ort.Tensor('float32', prepared.ink, [prepared.timeSteps, 1, 4])
		const results = await session.run({ [inputName]: tensor })
		const outputTensor = results[outputName]
		if (!outputTensor) {
			throw new Error(`ONNX output tensor "${outputName}" not found in inference results.`)
		}

		const outputData = outputTensor.data
		const dims = outputTensor.dims
		if (!(outputData instanceof Float32Array)) {
			throw new Error('Expected ONNX output tensor data to be Float32Array.')
		}
		if (!dims || dims.length < 3) {
			throw new Error('Expected ONNX output dims to include [timeSteps, batch, classes].')
		}

		const timeSteps = dims[0]
		const batchSize = dims[1]
		const classes = dims[2]
		if (batchSize !== 1) {
			throw new Error(`Expected batch size 1 for recognizer inference, got ${batchSize}.`)
		}

		// Output is [T, N, C], and N=1 here. Collapse to [T, C] for decoder.
		const perBatch = new Float32Array(timeSteps * classes)
		for (let t = 0; t < timeSteps; t++) {
			for (let c = 0; c < classes; c++) {
				perBatch[t * classes + c] = outputData[t * batchSize * classes + c]
			}
		}

		return decodeGreedyCtc(perBatch, timeSteps, classes, this.config.alphabet, {
			blankIndex: this.config.blankIndex ?? 0,
		})
	}

	async dispose(): Promise<void> {
		this.session = undefined
		this.ort = undefined
		return
	}
}

export function createHandwritingRecognizer(
	{ engine = 'stub', onnxModelConfig }: RecognizerFactoryOptions = {}
): HandwritingRecognizer {
	switch (engine) {
		case 'onnx-web':
			return new OnnxWebRecognizer(onnxModelConfig ?? DEFAULT_ONLINE_HTR_MODEL_CONFIG)
		case 'stub':
		default:
			return new StubRecognizer()
	}
}
