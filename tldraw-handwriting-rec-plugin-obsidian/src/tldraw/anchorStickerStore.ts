export type AnchorSticker = {
	shapeId: string
	targetPath: string
	targetWikilink: string
	targetDisplay: string
	createdAt: number
	updatedAt: number
}

const anchorStickersByDocumentId = new Map<string, Map<string, AnchorSticker>>()
const documentScopeRefCounts = new Map<string, number>()
const STORAGE_KEY_PREFIX = 'ptl.anchor-stickers.v1:'

function isPersistentDocument(documentId: string) {
	return documentId !== 'volatile-document'
}

function getStorageKey(documentId: string) {
	return `${STORAGE_KEY_PREFIX}${documentId}`
}

function hydrateDocument(documentId: string) {
	if (!isPersistentDocument(documentId)) return
	if (anchorStickersByDocumentId.has(documentId)) return
	if (typeof window === 'undefined' || !window.localStorage) return

	const raw = window.localStorage.getItem(getStorageKey(documentId))
	if (!raw) return

	try {
		const parsed = JSON.parse(raw)
		if (!Array.isArray(parsed)) return

		const hydrated = new Map<string, AnchorSticker>()
		for (const item of parsed) {
			if (!item || typeof item !== 'object') continue
			const candidate = item as AnchorSticker
			if (typeof candidate.shapeId !== 'string') continue
			if (typeof candidate.targetPath !== 'string') continue
			if (typeof candidate.targetWikilink !== 'string') continue
			if (typeof candidate.targetDisplay !== 'string') continue
			hydrated.set(candidate.shapeId, candidate)
		}

		if (hydrated.size > 0) {
			anchorStickersByDocumentId.set(documentId, hydrated)
		}
	} catch {
		window.localStorage.removeItem(getStorageKey(documentId))
	}
}

function persistDocument(documentId: string) {
	if (!isPersistentDocument(documentId)) return
	if (typeof window === 'undefined' || !window.localStorage) return

	const documentMap = anchorStickersByDocumentId.get(documentId)
	if (!documentMap || documentMap.size === 0) {
		window.localStorage.removeItem(getStorageKey(documentId))
		return
	}

	window.localStorage.setItem(getStorageKey(documentId), JSON.stringify(Array.from(documentMap.values())))
}

function getOrCreateDocumentMap(documentId: string) {
	hydrateDocument(documentId)

	let documentMap = anchorStickersByDocumentId.get(documentId)
	if (!documentMap) {
		documentMap = new Map<string, AnchorSticker>()
		anchorStickersByDocumentId.set(documentId, documentMap)
	}

	return documentMap
}

export function upsertAnchorSticker(documentId: string, sticker: AnchorSticker) {
	const documentMap = getOrCreateDocumentMap(documentId)
	documentMap.set(sticker.shapeId, sticker)
	persistDocument(documentId)
}

export function getAnchorSticker(documentId: string, shapeId: string) {
	hydrateDocument(documentId)
	return anchorStickersByDocumentId.get(documentId)?.get(shapeId)
}

export function getDocumentAnchorStickers(documentId: string): AnchorSticker[] {
	hydrateDocument(documentId)
	const documentMap = anchorStickersByDocumentId.get(documentId)
	if (!documentMap) return []
	return Array.from(documentMap.values())
}

export function removeAnchorSticker(documentId: string, shapeId: string) {
	const documentMap = anchorStickersByDocumentId.get(documentId)
	if (!documentMap) return

	documentMap.delete(shapeId)
	if (documentMap.size === 0) {
		anchorStickersByDocumentId.delete(documentId)
	}
	persistDocument(documentId)
}

export function clearDocumentAnchorStickers(documentId: string) {
	anchorStickersByDocumentId.delete(documentId)
	persistDocument(documentId)
}

export function acquireDocumentAnchorStickerScope(documentId: string) {
	hydrateDocument(documentId)
	const current = documentScopeRefCounts.get(documentId) ?? 0
	documentScopeRefCounts.set(documentId, current + 1)
}

export function releaseDocumentAnchorStickerScope(documentId: string) {
	const current = documentScopeRefCounts.get(documentId)
	if (!current) return

	if (current <= 1) {
		documentScopeRefCounts.delete(documentId)
		if (!isPersistentDocument(documentId)) {
			anchorStickersByDocumentId.delete(documentId)
		}
		return
	}

	documentScopeRefCounts.set(documentId, current - 1)
}