export type OnlineHtrModelConfig = {
	modelUrl: string
	alphabet: string[]
	inputName?: string
	outputName?: string
	blankIndex?: number
	allowedCharacters?: string[]
	maxOutputChars?: number
}

export type OnlineHtrModelConfigInput = {
	modelUrl?: string
	alphabet?: string[] | string
	inputName?: string
	outputName?: string
	blankIndex?: number
	allowedCharacters?: string[] | string
	maxOutputChars?: number
}

// Placeholder config for local development. Replace with real model artifact and alphabet.
export const DEFAULT_ONLINE_HTR_MODEL_CONFIG: OnlineHtrModelConfig = {
	modelUrl: '',
	alphabet: [],
	inputName: 'input',
	outputName: 'output',
	blankIndex: 0,
	allowedCharacters: [],
	maxOutputChars: 0,
}

function normalizeAlphabet(input: OnlineHtrModelConfigInput['alphabet']): string[] {
	if (Array.isArray(input)) {
		return input.filter((entry): entry is string => typeof entry === 'string')
	}

	if (typeof input === 'string') {
		const text = input.trim()
		if (text.length === 0) return []

		// Support JSON-array input so special tokens (e.g. space or comma) are preserved losslessly.
		if (text.startsWith('[') && text.endsWith(']')) {
			try {
				const parsed = JSON.parse(text)
				if (Array.isArray(parsed)) {
					return parsed.filter((entry): entry is string => typeof entry === 'string')
				}
			} catch {
				// Fall back to legacy parsing below.
			}
		}

		if (text.includes(',') || text.includes('\n')) {
			return text
				.split(/[\n,]/)
				.map((entry) => entry.trim())
				.filter((entry) => entry.length > 0)
		}

		return Array.from(text)
	}

	return []
}

function normalizeAllowedCharacters(input: OnlineHtrModelConfigInput['allowedCharacters']): string[] {
	const parsed = normalizeAlphabet(input)
	return parsed.filter((char, index) => char.length > 0 && parsed.indexOf(char) === index)
}

export function resolveOnlineHtrModelConfig(
	input?: OnlineHtrModelConfigInput | null
): OnlineHtrModelConfig {
	if (!input) {
		return DEFAULT_ONLINE_HTR_MODEL_CONFIG
	}

	return {
		modelUrl: typeof input.modelUrl === 'string' ? input.modelUrl.trim() : '',
		alphabet: normalizeAlphabet(input.alphabet),
		inputName:
			typeof input.inputName === 'string' && input.inputName.trim().length > 0
				? input.inputName.trim()
				: DEFAULT_ONLINE_HTR_MODEL_CONFIG.inputName,
		outputName:
			typeof input.outputName === 'string' && input.outputName.trim().length > 0
				? input.outputName.trim()
				: DEFAULT_ONLINE_HTR_MODEL_CONFIG.outputName,
		blankIndex:
			typeof input.blankIndex === 'number' && Number.isFinite(input.blankIndex) && input.blankIndex >= 0
				? Math.floor(input.blankIndex)
				: DEFAULT_ONLINE_HTR_MODEL_CONFIG.blankIndex,
		allowedCharacters: normalizeAllowedCharacters(input.allowedCharacters),
		maxOutputChars:
			typeof input.maxOutputChars === 'number' && Number.isFinite(input.maxOutputChars) && input.maxOutputChars >= 0
				? Math.floor(input.maxOutputChars)
				: DEFAULT_ONLINE_HTR_MODEL_CONFIG.maxOutputChars,
	}
}

export function isOnlineHtrModelConfigReady(config: OnlineHtrModelConfig): boolean {
	const hasModelUrl = typeof config.modelUrl === 'string' && config.modelUrl.length > 0
	const hasAlphabet = Array.isArray(config.alphabet) && config.alphabet.length > 0
	return hasModelUrl && hasAlphabet
}
