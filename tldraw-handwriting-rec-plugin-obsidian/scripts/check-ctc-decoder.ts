import { decodeGreedyCtc } from 'src/handwriting/ctcDecoder'

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) {
		throw new Error(message)
	}
}

function run() {
	const alphabet = ['a', 'b']
	const classes = alphabet.length + 1 // blank + alphabet
	const blank = 0

	// Target greedy path: [blank, a, a, blank, b] => collapse + remove blank => "ab"
	const timeSteps = 5
	const logProbabilities = new Float32Array([
		0, -10, -10,
		-10, 0, -10,
		-10, 0, -10,
		0, -10, -10,
		-10, -10, 0,
	])

	const decoded = decodeGreedyCtc(logProbabilities, timeSteps, classes, alphabet, {
		blankIndex: blank,
	})

	assert(decoded.length === 1, `Expected one decoded candidate, got ${decoded.length}.`)
	assert(decoded[0].text === 'ab', `Expected decoded text "ab", got "${decoded[0].text}".`)
	assert(
		decoded[0].confidence >= 0 && decoded[0].confidence <= 1,
		`Expected confidence in [0,1], got ${decoded[0].confidence}.`
	)

	const repeatedPath = new Float32Array([
		-10, 0, -10,
		-10, 0, -10,
		-10, 0, -10,
	])
	const repeatedDecoded = decodeGreedyCtc(repeatedPath, 3, classes, alphabet, {
		blankIndex: blank,
	})
	assert(
		repeatedDecoded[0].text === 'a',
		`Expected collapsed repeated text "a", got "${repeatedDecoded[0].text}".`
	)

	const blankOnlyPath = new Float32Array([
		0, -10, -10,
		0, -10, -10,
	])
	const blankOnlyDecoded = decodeGreedyCtc(blankOnlyPath, 2, classes, alphabet, {
		blankIndex: blank,
	})
	assert(
		blankOnlyDecoded[0].text === '',
		`Expected blank-only decode to empty string, got "${blankOnlyDecoded[0].text}".`
	)

	console.log('[check-ctc-decoder] PASS', {
		decoded: decoded[0],
		repeated: repeatedDecoded[0],
		blankOnly: blankOnlyDecoded[0],
	})
}

run()
