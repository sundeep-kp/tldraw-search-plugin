import {
	acquireDocumentRecognitionScope,
	clearDocumentRecognitionResults,
	getDocumentRecognitionResults,
	releaseDocumentRecognitionScope,
	upsertRecognitionResult,
} from 'src/handwriting/recognitionResultsStore'
import { StrokeGroupCandidate } from 'src/handwriting/strokeGrouping'
import { RecognitionCandidate } from 'src/handwriting/types'

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message)
}

function delay(ms: number) {
	return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function createGroup(id: string, endedAt: number): StrokeGroupCandidate {
	return {
		id,
		shapeIds: [`shape:${id}` as any],
		payloads: [],
		boundingBox: { minX: 0, minY: 0, maxX: 10, maxY: 10, width: 10, height: 10 },
		startedAt: endedAt - 10,
		endedAt,
	}
}

function buildFingerprint(group: StrokeGroupCandidate) {
	return `${group.id}:${group.endedAt}:${group.shapeIds.join(',')}`
}

class FakeDelayedRecognizer {
	constructor(private readonly latencyMs: number) {}

	async recognize(group: StrokeGroupCandidate): Promise<RecognitionCandidate[]> {
		await delay(this.latencyMs)
		return [{ text: `recognized-${group.id}`, confidence: 0.5 }]
	}
}

async function run() {
	const documentId = 'doc:lifecycle-test'
	const recognizer = new FakeDelayedRecognizer(120)
	const debounceMs = 40

	let timer: ReturnType<typeof setTimeout> | undefined
	let runVersion = 0
	let staleSkips = 0

	acquireDocumentRecognitionScope(documentId)
	clearDocumentRecognitionResults(documentId)

	const schedule = (groups: StrokeGroupCandidate[]) => {
		if (timer) clearTimeout(timer)
		timer = setTimeout(() => {
			const currentVersion = ++runVersion
			void (async () => {
				for (const group of groups) {
					const fingerprint = buildFingerprint(group)
					upsertRecognitionResult(documentId, {
						groupId: group.id,
						shapeIds: group.shapeIds,
						boundingBox: group.boundingBox,
						fingerprint,
						status: 'pending',
						updatedAt: Date.now(),
						candidates: [],
					})

					const candidates = await recognizer.recognize(group)
					if (currentVersion !== runVersion) {
						staleSkips += 1
						continue
					}

					upsertRecognitionResult(documentId, {
						groupId: group.id,
						shapeIds: group.shapeIds,
						boundingBox: group.boundingBox,
						fingerprint,
						status: 'success',
						updatedAt: Date.now(),
						candidates,
					})
				}
			})()
		}, debounceMs)
	}

	const groupsRun1 = [createGroup('g1', 1000)]
	const groupsRun2 = [createGroup('g2', 2000)]

	schedule(groupsRun1)
	await delay(60) // let run1 start and become in-flight
	schedule(groupsRun2) // supersedes run1

	await delay(260) // wait for both runs to settle

	const results = getDocumentRecognitionResults(documentId)
	const successResults = results.filter((r) => r.status === 'success')
	const latest = successResults.find((r) => r.groupId === 'g2')

	assert(staleSkips >= 1, `Expected at least one stale skip, got ${staleSkips}.`)
	assert(successResults.length === 1, `Expected exactly one successful result, got ${successResults.length}.`)
	assert(!!latest, 'Expected latest group (g2) to have successful recognition result.')
	assert(
		latest?.candidates[0]?.text === 'recognized-g2',
		`Expected recognized text for g2, got ${latest?.candidates[0]?.text}.`
	)

	if (timer) clearTimeout(timer)
	releaseDocumentRecognitionScope(documentId)

	const cleanedResults = getDocumentRecognitionResults(documentId)
	assert(
		cleanedResults.length === 0,
		`Expected recognition results to be cleared after scope release, got ${cleanedResults.length}.`
	)

	console.log('[check-recognition-lifecycle] PASS', {
		staleSkips,
		cleanupVerified: true,
		successResults: successResults.map((r) => ({ groupId: r.groupId, text: r.candidates[0]?.text })),
	})
}

void run()
