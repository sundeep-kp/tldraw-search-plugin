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

function hydrateDocumentResults(documentId: string) {
	if (!isPersistentDocument(documentId)) return
	if (resultsByDocumentId.has(documentId)) return
	if (typeof window === 'undefined' || !window.localStorage) return

	const raw = window.localStorage.getItem(getStorageKey(documentId))
	if (!raw) return

	try {
		const parsed = JSON.parse(raw)
		if (!Array.isArray(parsed)) return

		const hydrated = new Map<string, RecognitionResult>()
		for (const item of parsed) {
			if (!item || typeof item !== 'object') continue
			const candidate = item as RecognitionResult
			if (typeof candidate.groupId !== 'string') continue
			hydrated.set(candidate.groupId, candidate)
		}

		if (hydrated.size > 0) {
			resultsByDocumentId.set(documentId, hydrated)
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
