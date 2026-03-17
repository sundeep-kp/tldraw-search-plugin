import { NormalizedStrokePayload } from 'src/handwriting/types'
import { TLShapeId } from 'tldraw'

type ShapePayloadMap = Map<TLShapeId, NormalizedStrokePayload>

const payloadsByDocumentId = new Map<string, ShapePayloadMap>()
const documentScopeRefCounts = new Map<string, number>()

function getOrCreateDocumentPayloadMap(documentId: string): ShapePayloadMap {
	let payloadMap = payloadsByDocumentId.get(documentId)
	if (!payloadMap) {
		payloadMap = new Map<TLShapeId, NormalizedStrokePayload>()
		payloadsByDocumentId.set(documentId, payloadMap)
	}
	return payloadMap
}

export function upsertNormalizedStrokePayload(documentId: string, payload: NormalizedStrokePayload) {
	const payloadMap = getOrCreateDocumentPayloadMap(documentId)
	payloadMap.set(payload.shapeId, payload)
}

export function getNormalizedStrokePayload(documentId: string, shapeId: TLShapeId) {
	return payloadsByDocumentId.get(documentId)?.get(shapeId)
}

export function getAllNormalizedStrokePayloads(documentId: string): NormalizedStrokePayload[] {
	const payloadMap = payloadsByDocumentId.get(documentId)
	if (!payloadMap) return []
	return Array.from(payloadMap.values())
}

export function removeNormalizedStrokePayload(documentId: string, shapeId: TLShapeId) {
	const payloadMap = payloadsByDocumentId.get(documentId)
	if (!payloadMap) return

	payloadMap.delete(shapeId)
	if (payloadMap.size === 0) {
		payloadsByDocumentId.delete(documentId)
	}
}

export function clearDocumentNormalizedStrokePayloads(documentId: string) {
	payloadsByDocumentId.delete(documentId)
}

export function acquireDocumentStrokePayloadScope(documentId: string) {
	const current = documentScopeRefCounts.get(documentId) ?? 0
	documentScopeRefCounts.set(documentId, current + 1)
}

export function releaseDocumentStrokePayloadScope(documentId: string) {
	const current = documentScopeRefCounts.get(documentId) ?? 0
	if (current <= 1) {
		documentScopeRefCounts.delete(documentId)
		payloadsByDocumentId.delete(documentId)
		return
	}

	documentScopeRefCounts.set(documentId, current - 1)
}
