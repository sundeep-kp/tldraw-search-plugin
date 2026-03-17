import { RecognitionResult } from 'src/handwriting/types'

const resultsByDocumentId = new Map<string, Map<string, RecognitionResult>>()
const documentScopeRefCounts = new Map<string, number>()

function getOrCreateDocumentMap(documentId: string): Map<string, RecognitionResult> {
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
}

export function getRecognitionResult(documentId: string, groupId: string) {
	return resultsByDocumentId.get(documentId)?.get(groupId)
}

export function getDocumentRecognitionResults(documentId: string): RecognitionResult[] {
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
}

export function clearDocumentRecognitionResults(documentId: string) {
	resultsByDocumentId.delete(documentId)
}

export function acquireDocumentRecognitionScope(documentId: string) {
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
