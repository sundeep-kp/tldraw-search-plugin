import { StrokeGroupCandidate } from 'src/handwriting/strokeGrouping'
import { decodeGreedyCtc } from 'src/handwriting/ctcDecoder'
import { DEFAULT_ONLINE_HTR_MODEL_CONFIG, OnlineHtrModelConfig } from 'src/handwriting/modelConfig'
import { preprocessGroupForOnlineHtr } from 'src/handwriting/preprocessors/onlineHtrCarbune2020'
import {
	GoogleImeRecognizerConfig,
	HandwritingRecognizer,
	RecognitionCandidate,
	RecognizerFactoryOptions,
} from 'src/handwriting/types'

type OnnxRuntimeWebModule = typeof import('onnxruntime-web')

const ORT_DIST_VERSION = '1.24.3'
const ORT_WASM_DIST_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_DIST_VERSION}/dist/`
const GOOGLE_IME_ENDPOINT =
	'https://www.google.com.tw/inputtools/request?ime=handwriting&app=mobilesearch&cs=1&oe=UTF-8'

class GoogleImeRecognizer implements HandwritingRecognizer {
	constructor(
		private readonly config: GoogleImeRecognizerConfig = {
			language: 'en',
			numOfWords: 0,
			numOfReturn: 5,
		}
	) {}

	isReady() {
		return true
	}

	private buildTrace(group: StrokeGroupCandidate): number[][][] {
		const payloads = [...group.payloads].sort((a, b) => a.timestamp - b.timestamp)
		const trace: number[][][] = []

		for (const payload of payloads) {
			for (const stroke of payload.rawStrokes) {
				if (!Array.isArray(stroke) || stroke.length === 0) continue

				const xCoords: number[] = []
				const yCoords: number[] = []

				for (const point of stroke) {
					xCoords.push(payload.shapePosition.x + point.x)
					yCoords.push(payload.shapePosition.y + point.y)
				}

				if (xCoords.length > 0) {
					trace.push([xCoords, yCoords, []])
				}
			}
		}

		return trace
	}

	async recognize(group: StrokeGroupCandidate): Promise<RecognitionCandidate[]> {
		const trace = this.buildTrace(group)
		if (trace.length === 0) {
			throw new Error('No stroke data available for Google IME recognizer request.')
		}

		const language = (this.config.language ?? 'en').trim() || 'en'
		const numOfWords = Math.max(0, Math.floor(this.config.numOfWords ?? 0))
		const numOfReturn = Math.max(0, Math.floor(this.config.numOfReturn ?? 5))

		const payload = {
			options: 'enable_pre_space',
			requests: [
				{
					writing_guide: {
						writing_area_width: Math.max(1, Math.ceil(group.boundingBox.width || 1)),
						writing_area_height: Math.max(1, Math.ceil(group.boundingBox.height || 1)),
					},
					ink: trace,
					language,
				},
			],
		}

		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), 10000)
		try {
			const response = await fetch(GOOGLE_IME_ENDPOINT, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload),
				signal: controller.signal,
			})

			if (!response.ok) {
				throw new Error(`Google IME request failed (${response.status}).`)
			}

			const data = (await response.json()) as unknown
			if (Array.isArray(data) && data.length === 1) {
				throw new Error(String(data[0]))
			}

			const rawCandidates =
				Array.isArray(data) && Array.isArray(data[1]) && Array.isArray(data[1][0])
					? data[1][0][1]
					: []

			if (!Array.isArray(rawCandidates)) {
				throw new Error('Unexpected Google IME response shape.')
			}

			let textCandidates = rawCandidates.filter((c): c is string => typeof c === 'string')

			if (numOfWords > 0) {
				textCandidates = textCandidates.filter((candidate) => candidate.length === numOfWords)
			}
			if (numOfReturn > 0) {
				textCandidates = textCandidates.slice(0, numOfReturn)
			}

			return textCandidates.map((text, index) => ({
				text,
				confidence: Math.max(0, 1 - index * 0.1),
			}))
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error('Google IME request timed out.')
			}
			throw error
		} finally {
			clearTimeout(timeout)
		}
	}

	async dispose(): Promise<void> {
		return
	}
}

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

	constructor(
		private readonly config: OnlineHtrModelConfig,
		private readonly loadModelBytes?: (modelUrl: string) => Promise<Uint8Array | undefined>
	) {}

	isReady() {
		return !!this.session
	}

	private configureRuntimeEnvironment(ort: OnnxRuntimeWebModule) {
		// In Obsidian's bundled plugin runtime, ORT cannot always infer the script URL.
		// Provide an explicit dist base so WASM binaries can be resolved reliably.
		ort.env.wasm.wasmPaths = ORT_WASM_DIST_BASE
		ort.env.wasm.proxy = false
	}

	private resolveModelUrl(modelUrl: string) {
		const trimmed = modelUrl.trim()
		if (trimmed.length === 0) return trimmed

		if (/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)) {
			return trimmed
		}

		// Interpret POSIX absolute paths as local file URLs in Electron/Obsidian runtime.
		if (trimmed.startsWith('/')) {
			return `file://${encodeURI(trimmed)}`
		}

		return trimmed
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
		this.configureRuntimeEnvironment(this.ort)
		const resolvedModelUrl = this.resolveModelUrl(this.config.modelUrl)

		let modelSource: string | Uint8Array = resolvedModelUrl
		if (this.loadModelBytes) {
			try {
				const loadedBytes = await this.loadModelBytes(resolvedModelUrl)
				if (loadedBytes && loadedBytes.length > 0) {
					modelSource = loadedBytes
				}
			} catch (error) {
				throw new Error(
					`Failed to read ONNX model bytes for ${resolvedModelUrl}. Root error: ${error instanceof Error ? error.message : String(error)}`
				)
			}
		}

		try {
			this.session = await this.ort.InferenceSession.create(modelSource, {
				executionProviders: ['wasm'],
			})
		} catch (error) {
			throw new Error(
				`Failed to initialize ONNX session (wasm backend). Ensure model source is reachable (${resolvedModelUrl}) and WASM assets are reachable from ${ORT_WASM_DIST_BASE}. Root error: ${error instanceof Error ? error.message : String(error)}`
			)
		}
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
			allowedCharacters: this.config.allowedCharacters,
			maxOutputChars: this.config.maxOutputChars,
		})
	}

	async dispose(): Promise<void> {
		this.session = undefined
		this.ort = undefined
		return
	}
}

export function createHandwritingRecognizer(
	{ engine = 'stub', onnxModelConfig, googleImeConfig, loadModelBytes }: RecognizerFactoryOptions = {}
): HandwritingRecognizer {
	switch (engine) {
		case 'onnx-web':
			return new OnnxWebRecognizer(onnxModelConfig ?? DEFAULT_ONLINE_HTR_MODEL_CONFIG, loadModelBytes)
		case 'google-ime-js':
			return new GoogleImeRecognizer(googleImeConfig)
		case 'stub':
		default:
			return new StubRecognizer()
	}
}
