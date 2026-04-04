import { NormalizedStrokePayload } from 'src/handwriting/types'
import { TLShapeId } from 'tldraw'

type ShapePayloadMap = Map<TLShapeId, NormalizedStrokePayload>

const payloadsByDocumentId = new Map<string, ShapePayloadMap>()
const documentScopeRefCounts = new Map<string, number>()
const STROKE_PAYLOAD_STORAGE_KEY_PREFIX = 'ptl.handwriting.stroke-payloads.v1:'

function isPersistentDocument(documentId: string): boolean {
	return documentId !== 'volatile-document'
}

function getStorageKey(documentId: string): string {
	return `${STROKE_PAYLOAD_STORAGE_KEY_PREFIX}${documentId}`
}

function isFinitePoint(point: unknown): point is { x: number; y: number } {
	if (!point || typeof point !== 'object') return false
	const candidate = point as { x?: number; y?: number }
	return Number.isFinite(candidate.x) && Number.isFinite(candidate.y)
}

function isStrokeCollection(strokes: unknown): strokes is Array<Array<{ x: number; y: number }>> {
	if (!Array.isArray(strokes)) return false
	return strokes.every((stroke) => Array.isArray(stroke) && stroke.every((point) => isFinitePoint(point)))
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

function isNormalizedStrokePayload(payload: unknown): payload is NormalizedStrokePayload {
	if (!payload || typeof payload !== 'object') return false
	const candidate = payload as Partial<NormalizedStrokePayload>
	return (
		typeof candidate.shapeId === 'string' &&
		isStrokeCollection(candidate.rawStrokes) &&
		isStrokeCollection(candidate.normalizedStrokes) &&
		isFinitePoint(candidate.shapePosition) &&
		isFiniteBounds(candidate.bounds) &&
		isFiniteBounds(candidate.worldBounds) &&
		Number.isFinite(candidate.scale) &&
		Number.isFinite(candidate.timestamp)
	)
}

function hydrateDocumentPayloads(documentId: string) {
	if (!isPersistentDocument(documentId)) return
	if (payloadsByDocumentId.has(documentId)) return
	if (typeof window === 'undefined' || !window.localStorage) return

	const raw = window.localStorage.getItem(getStorageKey(documentId))
	if (!raw) return

	try {
		const parsed = JSON.parse(raw)
		if (!Array.isArray(parsed)) {
			window.localStorage.removeItem(getStorageKey(documentId))
			return
		}

		const hydrated = new Map<TLShapeId, NormalizedStrokePayload>()
		for (const item of parsed) {
			if (!isNormalizedStrokePayload(item)) continue
			hydrated.set(item.shapeId, item)
		}

		if (hydrated.size > 0) {
			payloadsByDocumentId.set(documentId, hydrated)
		}
	} catch {
		window.localStorage.removeItem(getStorageKey(documentId))
	}
}

function persistDocumentPayloads(documentId: string) {
	if (!isPersistentDocument(documentId)) return
	if (typeof window === 'undefined' || !window.localStorage) return

	const payloadMap = payloadsByDocumentId.get(documentId)
	if (!payloadMap || payloadMap.size === 0) {
		window.localStorage.removeItem(getStorageKey(documentId))
		return
	}

	window.localStorage.setItem(getStorageKey(documentId), JSON.stringify(Array.from(payloadMap.values())))
}

function getOrCreateDocumentPayloadMap(documentId: string): ShapePayloadMap {
	hydrateDocumentPayloads(documentId)

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
	persistDocumentPayloads(documentId)
}

export function getNormalizedStrokePayload(documentId: string, shapeId: TLShapeId) {
	hydrateDocumentPayloads(documentId)
	return payloadsByDocumentId.get(documentId)?.get(shapeId)
}

export function getAllNormalizedStrokePayloads(documentId: string): NormalizedStrokePayload[] {
	hydrateDocumentPayloads(documentId)
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
	persistDocumentPayloads(documentId)
}

export function clearDocumentNormalizedStrokePayloads(documentId: string) {
	payloadsByDocumentId.delete(documentId)
	persistDocumentPayloads(documentId)
}

export function acquireDocumentStrokePayloadScope(documentId: string) {
	hydrateDocumentPayloads(documentId)
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
