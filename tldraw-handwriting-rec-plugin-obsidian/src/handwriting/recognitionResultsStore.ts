import { RecognitionResult } from 'src/handwriting/types'

const resultsByDocumentId = new Map<string, Map<string, RecognitionResult>>()
const documentScopeRefCounts = new Map<string, number>()
const RECOGNITION_RESULTS_STORAGE_KEY_PREFIX = 'ptl.handwriting.recognition-results.v1:'

function isPersistentDocument(documentId: string): boolean {
	return documentId !== 'volatile-document'
}

function getStorageKey(documentId: string): string {
	return `${RECOGNITION_RESULTS_STORAGE_KEY_PREFIX}${documentId}`
}

function isFiniteBounds(
	bounds: unknown
): bounds is {
	minX: number
	minY: number
	maxX: number
	maxY: number
	width: number
	height: number
} {
	if (!bounds || typeof bounds !== 'object') return false
	const candidate = bounds as {
		minX?: number
		minY?: number
		maxX?: number
		maxY?: number
		width?: number
		height?: number
	}
	return (
		Number.isFinite(candidate.minX) &&
		Number.isFinite(candidate.minY) &&
		Number.isFinite(candidate.maxX) &&
		Number.isFinite(candidate.maxY) &&
		Number.isFinite(candidate.width) &&
		Number.isFinite(candidate.height)
	)
}

function isRecognitionResult(result: unknown): result is RecognitionResult {
	if (!result || typeof result !== 'object') return false
	const candidate = result as Partial<RecognitionResult>
	const statusValid =
		candidate.status === 'pending' || candidate.status === 'success' || candidate.status === 'error'
	const candidatesValid =
		Array.isArray(candidate.candidates) &&
		candidate.candidates.every(
			(entry) =>
				!!entry &&
				typeof entry === 'object' &&
				typeof (entry as { text?: unknown }).text === 'string' &&
				Number.isFinite((entry as { confidence?: unknown }).confidence)
		)

	return (
		typeof candidate.groupId === 'string' &&
		Array.isArray(candidate.shapeIds) &&
		candidate.shapeIds.every((shapeId) => typeof shapeId === 'string') &&
		isFiniteBounds(candidate.boundingBox) &&
		typeof candidate.fingerprint === 'string' &&
		statusValid &&
		Number.isFinite(candidate.updatedAt) &&
		candidatesValid
	)
}

function hydrateDocumentResults(documentId: string) {
	if (!isPersistentDocument(documentId)) return
	if (resultsByDocumentId.has(documentId)) return
	if (typeof window === 'undefined' || !window.localStorage) return

	const raw = window.localStorage.getItem(getStorageKey(documentId))
	if (!raw) return

	try {
		const parsed = JSON.parse(raw)
		if (!Array.isArray(parsed)) {
			window.localStorage.removeItem(getStorageKey(documentId))
			return
		}

		const hydrated = new Map<string, RecognitionResult>()
		for (const item of parsed) {
			if (!isRecognitionResult(item)) continue
			hydrated.set(item.groupId, item)
		}

		if (hydrated.size > 0) {
			resultsByDocumentId.set(documentId, hydrated)
			if (hydrated.size !== parsed.length) {
				window.localStorage.setItem(getStorageKey(documentId), JSON.stringify(Array.from(hydrated.values())))
			}
		} else {
			window.localStorage.removeItem(getStorageKey(documentId))
		}
	} catch {
		window.localStorage.removeItem(getStorageKey(documentId))
	}
}

function persistDocumentResults(documentId: string) {
	if (!isPersistentDocument(documentId)) return
	if (typeof window === 'undefined' || !window.localStorage) return

	const documentMap = resultsByDocumentId.get(documentId)
	if (!documentMap || documentMap.size === 0) {
		window.localStorage.removeItem(getStorageKey(documentId))
		return
	}

	const serialized = JSON.stringify(Array.from(documentMap.values()))
	window.localStorage.setItem(getStorageKey(documentId), serialized)
}

function getOrCreateDocumentMap(documentId: string): Map<string, RecognitionResult> {
	hydrateDocumentResults(documentId)

	let documentMap = resultsByDocumentId.get(documentId)
	if (!documentMap) {
		documentMap = new Map<string, RecognitionResult>()
		resultsByDocumentId.set(documentId, documentMap)
	}
	return documentMap
}

export function upsertRecognitionResult(documentId: string, result: RecognitionResult) {
	const documentMap = getOrCreateDocumentMap(documentId)
	documentMap.set(result.groupId, result)
	persistDocumentResults(documentId)
}

export function getRecognitionResult(documentId: string, groupId: string) {
	hydrateDocumentResults(documentId)
	return resultsByDocumentId.get(documentId)?.get(groupId)
}

export function getRecognitionResultByFingerprint(documentId: string, fingerprint: string) {
	hydrateDocumentResults(documentId)
	const documentMap = resultsByDocumentId.get(documentId)
	if (!documentMap) return undefined

	for (const result of documentMap.values()) {
		if (result.fingerprint === fingerprint) return result
	}

	return undefined
}

export function getDocumentRecognitionResults(documentId: string): RecognitionResult[] {
	hydrateDocumentResults(documentId)
	const documentMap = resultsByDocumentId.get(documentId)
	if (!documentMap) return []
	return Array.from(documentMap.values())
}

export function removeRecognitionResult(documentId: string, groupId: string) {
	const documentMap = resultsByDocumentId.get(documentId)
	if (!documentMap) return

	documentMap.delete(groupId)
	if (documentMap.size === 0) {
		resultsByDocumentId.delete(documentId)
	}
	persistDocumentResults(documentId)
}

export function clearDocumentRecognitionResults(documentId: string) {
	resultsByDocumentId.delete(documentId)
	persistDocumentResults(documentId)
}

export function acquireDocumentRecognitionScope(documentId: string) {
	hydrateDocumentResults(documentId)
	const current = documentScopeRefCounts.get(documentId) ?? 0
	documentScopeRefCounts.set(documentId, current + 1)
}

export function releaseDocumentRecognitionScope(documentId: string) {
	const current = documentScopeRefCounts.get(documentId) ?? 0
	if (current <= 1) {
		documentScopeRefCounts.delete(documentId)
		resultsByDocumentId.delete(documentId)
		return
	}

	documentScopeRefCounts.set(documentId, current - 1)
}
