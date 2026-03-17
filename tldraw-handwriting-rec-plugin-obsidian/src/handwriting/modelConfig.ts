export type OnlineHtrModelConfig = {
	modelUrl: string
	alphabet: string[]
	inputName?: string
	outputName?: string
	blankIndex?: number
}

// Placeholder config for local development. Replace with real model artifact and alphabet.
export const DEFAULT_ONLINE_HTR_MODEL_CONFIG: OnlineHtrModelConfig = {
	modelUrl: '',
	alphabet: [],
	inputName: 'input',
	outputName: 'output',
	blankIndex: 0,
}
