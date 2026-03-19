import {
	DEFAULT_ONLINE_HTR_MODEL_CONFIG,
	isOnlineHtrModelConfigReady,
	resolveOnlineHtrModelConfig,
} from 'src/handwriting/modelConfig'

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message)
}

function run() {
	const empty = resolveOnlineHtrModelConfig(undefined)
	assert(empty === DEFAULT_ONLINE_HTR_MODEL_CONFIG, 'Expected undefined input to return default config.')
	assert(!isOnlineHtrModelConfigReady(empty), 'Expected default config to be not ready.')

	const fromCsv = resolveOnlineHtrModelConfig({
		modelUrl: '  https://example.com/model.onnx  ',
		alphabet: 'a,b,c',
		blankIndex: 2.8,
	})
	assert(fromCsv.modelUrl === 'https://example.com/model.onnx', 'Expected modelUrl to be trimmed.')
	assert(fromCsv.alphabet.join('') === 'abc', 'Expected CSV alphabet parsing to preserve order.')
	assert(fromCsv.blankIndex === 2, 'Expected blankIndex to be normalized with floor().')
	assert(isOnlineHtrModelConfigReady(fromCsv), 'Expected CSV config to be recognized as ready.')

	const fromChars = resolveOnlineHtrModelConfig({
		modelUrl: '/vault/model.onnx',
		alphabet: 'ab ',
		inputName: '  ink  ',
		outputName: ' logits ',
		blankIndex: -1,
	})
	assert(fromChars.alphabet.join('') === 'ab', 'Expected character alphabet parsing for plain strings.')
	assert(fromChars.inputName === 'ink', 'Expected inputName to be trimmed.')
	assert(fromChars.outputName === 'logits', 'Expected outputName to be trimmed.')
	assert(fromChars.blankIndex === 0, 'Expected invalid blankIndex to fall back to default.')

	const fromJsonArray = resolveOnlineHtrModelConfig({
		modelUrl: '/vault/model.onnx',
		alphabet: '[" ",",","a"]',
		allowedCharacters: 'a,a,b',
		maxOutputChars: 1.9,
	})
	assert(fromJsonArray.alphabet.length === 3, 'Expected JSON-array alphabet length to be preserved.')
	assert(fromJsonArray.alphabet[0] === ' ', 'Expected JSON-array to preserve space token.')
	assert(fromJsonArray.alphabet[1] === ',', 'Expected JSON-array to preserve comma token.')
	assert(fromJsonArray.alphabet[2] === 'a', 'Expected JSON-array to preserve literal token order.')
	assert(
		fromJsonArray.allowedCharacters?.join(',') === 'a,b',
		'Expected allowedCharacters to be deduplicated and normalized.'
	)
	assert(fromJsonArray.maxOutputChars === 1, 'Expected maxOutputChars to be normalized with floor().')

	console.log('[check-model-config] PASS', {
		defaultReady: isOnlineHtrModelConfigReady(empty),
		csvReady: isOnlineHtrModelConfigReady(fromCsv),
		charsAlphabetLength: fromChars.alphabet.length,
		jsonArrayAlphabetLength: fromJsonArray.alphabet.length,
		allowedCharactersLength: fromJsonArray.allowedCharacters?.length,
		maxOutputChars: fromJsonArray.maxOutputChars,
	})
}

run()
