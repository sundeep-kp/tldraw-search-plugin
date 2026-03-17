import { RecognitionCandidate } from 'src/handwriting/types'

export type DecodeGreedyCtcOptions = {
	blankIndex?: number
	nbest?: number
}

// Log probabilities shape: [timeSteps, classes]
export function decodeGreedyCtc(
	logProbabilities: Float32Array,
	timeSteps: number,
	classes: number,
	alphabet: string[],
	{ blankIndex = 0, nbest = 1 }: DecodeGreedyCtcOptions = {}
): RecognitionCandidate[] {
	if (timeSteps <= 0 || classes <= 0) return []
	if (alphabet.length + 1 !== classes) {
		throw new Error(
			`Alphabet/classes mismatch. Expected alphabet length ${classes - 1}, got ${alphabet.length}.`
		)
	}

	const indices: number[] = []
	let accumulatedLogProb = 0

	for (let t = 0; t < timeSteps; t++) {
		let maxClass = 0
		let maxValue = Number.NEGATIVE_INFINITY

		for (let c = 0; c < classes; c++) {
			const value = logProbabilities[t * classes + c]
			if (value > maxValue) {
				maxValue = value
				maxClass = c
			}
		}

		indices.push(maxClass)
		accumulatedLogProb += maxValue
	}

	const collapsed: number[] = []
	let previous = -1
	for (const idx of indices) {
		if (idx !== previous) {
			collapsed.push(idx)
			previous = idx
		}
	}

	const filtered = collapsed.filter((idx) => idx !== blankIndex)
	const chars = filtered.map((idx) => alphabet[idx - 1] ?? '')
	const text = chars.join('')

	// Use average per-step log probability as a stable confidence proxy in [0,1].
	const meanLogProb = accumulatedLogProb / Math.max(1, timeSteps)
	const confidence = Math.max(0, Math.min(1, Math.exp(meanLogProb)))

	return [{ text, confidence }].slice(0, Math.max(1, nbest))
}
