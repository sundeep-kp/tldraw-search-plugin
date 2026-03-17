import { StrokeGroupCandidate } from 'src/handwriting/strokeGrouping'

const candidatesByDocumentId = new Map<string, StrokeGroupCandidate[]>()
const documentScopeRefCounts = new Map<string, number>()

export function setDocumentWordCandidates(documentId: string, candidates: StrokeGroupCandidate[]) {
	candidatesByDocumentId.set(documentId, candidates)
}

export function getDocumentWordCandidates(documentId: string): StrokeGroupCandidate[] {
	return candidatesByDocumentId.get(documentId) ?? []
}

export function clearDocumentWordCandidates(documentId: string) {
	candidatesByDocumentId.delete(documentId)
}

export function acquireDocumentWordCandidateScope(documentId: string) {
	const current = documentScopeRefCounts.get(documentId) ?? 0
	documentScopeRefCounts.set(documentId, current + 1)
}

export function releaseDocumentWordCandidateScope(documentId: string) {
	const current = documentScopeRefCounts.get(documentId) ?? 0
	if (current <= 1) {
		documentScopeRefCounts.delete(documentId)
		candidatesByDocumentId.delete(documentId)
		return
	}

	documentScopeRefCounts.set(documentId, current - 1)
}
