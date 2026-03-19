import { RecognitionCandidate } from 'src/handwriting/types'

export type DecodeGreedyCtcOptions = {
	blankIndex?: number
	nbest?: number
	allowedCharacters?: string[]
	maxOutputChars?: number
}

// Log probabilities shape: [timeSteps, classes]
export function decodeGreedyCtc(
	logProbabilities: Float32Array,
	timeSteps: number,
	classes: number,
	alphabet: string[],
	{ blankIndex = 0, nbest = 1, allowedCharacters, maxOutputChars }: DecodeGreedyCtcOptions = {}
): RecognitionCandidate[] {
	if (timeSteps <= 0 || classes <= 0) return []
	if (alphabet.length + 1 !== classes) {
		throw new Error(
			`Alphabet/classes mismatch. Expected alphabet length ${classes - 1}, got ${alphabet.length}.`
		)
	}

	const indices: number[] = []
	let accumulatedLogProb = 0
	const hasAllowedCharacters = Array.isArray(allowedCharacters) && allowedCharacters.length > 0
	const allowedCharacterSet = hasAllowedCharacters ? new Set(allowedCharacters) : null
	const allowedClassIndices = new Set<number>([blankIndex])

	if (allowedCharacterSet) {
		for (let c = 0; c < classes; c++) {
			if (c === blankIndex) continue
			const char = alphabet[c - 1]
			if (char && allowedCharacterSet.has(char)) {
				allowedClassIndices.add(c)
			}
		}
	}

	for (let t = 0; t < timeSteps; t++) {
		let maxClass = 0
		let maxValue = Number.NEGATIVE_INFINITY

		for (let c = 0; c < classes; c++) {
			if (allowedCharacterSet && !allowedClassIndices.has(c)) continue
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

	let filtered = collapsed.filter((idx) => idx !== blankIndex)
	if (typeof maxOutputChars === 'number' && Number.isFinite(maxOutputChars) && maxOutputChars >= 0) {
		filtered = filtered.slice(0, Math.floor(maxOutputChars))
	}

	if (filtered.length === 0 && allowedCharacterSet && allowedCharacterSet.size > 0) {
		let fallbackClass = -1
		let fallbackScore = Number.NEGATIVE_INFINITY

		for (let c = 0; c < classes; c++) {
			if (c === blankIndex) continue
			if (!allowedClassIndices.has(c)) continue

			let score = 0
			for (let t = 0; t < timeSteps; t++) {
				score += logProbabilities[t * classes + c]
			}

			if (score > fallbackScore) {
				fallbackScore = score
				fallbackClass = c
			}
		}

		if (fallbackClass >= 0) {
			filtered = [fallbackClass]
		}
	}
	const chars = filtered.map((idx) => alphabet[idx - 1] ?? '')
	const text = chars.join('')

	// Use average per-step log probability as a stable confidence proxy in [0,1].
	const meanLogProb = accumulatedLogProb / Math.max(1, timeSteps)
	const confidence = Math.max(0, Math.min(1, Math.exp(meanLogProb)))

	return [{ text, confidence }].slice(0, Math.max(1, nbest))
}
