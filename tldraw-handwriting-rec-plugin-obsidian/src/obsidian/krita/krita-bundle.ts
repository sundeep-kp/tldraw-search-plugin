import JSZip from 'jszip'
import { normalizePath } from 'obsidian'
import TldrawPlugin from 'src/main'
import { checkAndCreateFolder, getNewUniqueFilepath } from 'src/utils/utils'

export type KritaBundleResourceType = 'brush-preset' | 'brush-tip' | 'pattern' | 'gradient' | 'workspace' | 'other'

export type KritaBundleManifestEntry = {
	fullPath: string
	mediaType?: string
	md5?: string
	tags: string[]
	resourceType: KritaBundleResourceType
	name: string
}

export type KritaBundleMetadata = {
	title?: string
	author?: string
	description?: string
	generator?: string
	version?: string
	created?: string
	modified?: string
}

export type KritaDerivedPresetStyle = {
	pencilBrushSizePx: number
	pencilOpacitySensitivity: number
	pencilTextureIntensity: number
	pencilCrossSectionAspectRatio: number
	pencilTextureEnabled: boolean
	brushTipData: Uint8Array | null
	spacingFactor: number
	sizeCurveExponent: number
	opacityCurveExponent: number
	rotationJitter: number
}

export type KritaBundleImportSummary = {
	fileName: string
	bundleName: string
	meta: KritaBundleMetadata
	manifestEntries: KritaBundleManifestEntry[]
	presetEntries: KritaBundleManifestEntry[]
	derivedPresetStyles?: Record<string, KritaDerivedPresetStyle>
	resourceEntries: KritaBundleManifestEntry[]
	previewEntryPath?: string
	warnings: string[]
}

export type KritaImportedBrushBundleRecord = {
	id: string
	name: string
	originalFileName: string
	vaultPath: string
	importedAt: string
	summary: KritaBundleImportSummary
}

export function isKritaBundleFileName(name: string) {
	return /\.(bundle|zip)$/i.test(name)
}

function normalizeBundlePath(path: string): string {
	return path.replace(/^\.\//, '').replace(/^\/+/, '')
}

function inferResourceType(fullPath: string, mediaType?: string): KritaBundleResourceType {
	const normalizedPath = normalizeBundlePath(fullPath).toLowerCase()
	if (
		normalizedPath.startsWith('kis_paintoppresets/') ||
		normalizedPath.startsWith('paintoppresets/') ||
		normalizedPath.includes('/paintoppresets/') ||
		normalizedPath.endsWith('.kpp')
	)
		return 'brush-preset'
	if (
		normalizedPath.startsWith('kis_brushes/') ||
		normalizedPath.startsWith('brushes/') ||
		normalizedPath.includes('/brushes/')
	)
		return 'brush-tip'
	if (normalizedPath.startsWith('ko_patterns/') || normalizedPath.includes('/patterns/')) return 'pattern'
	if (normalizedPath.startsWith('ko_gradients/') || normalizedPath.includes('/gradients/')) return 'gradient'
	if (normalizedPath.startsWith('kis_workspaces/') || normalizedPath.includes('/workspaces/')) return 'workspace'
	if (mediaType?.includes('krita')) return 'brush-tip'
	return 'other'
}

function parseXml(xmlText: string): Document {
	return new DOMParser().parseFromString(xmlText, 'application/xml')
}

function isPngSignature(bytes: Uint8Array) {
	return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
}

function readPngChunks(bytes: Uint8Array) {
	const chunks: Array<{ type: string; data: Uint8Array }> = []
	let offset = 8
	while (offset + 8 <= bytes.length) {
		const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4)
		const length = view.getUint32(0, false)
		const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
		const dataStart = offset + 8
		const dataEnd = dataStart + length
		chunks.push({ type, data: bytes.slice(dataStart, dataEnd) })
		offset = dataEnd + 4
		if (type === 'IEND') break
	}
	return chunks
}

async function inflateDeflateBytes(bytes: Uint8Array): Promise<string> {
	if (typeof DecompressionStream === 'undefined') {
		throw new Error('DecompressionStream is not available in this runtime.')
	}
	const blobBytes = new Uint8Array(bytes)
	const decompressed = new Blob([blobBytes]).stream().pipeThrough(new DecompressionStream('deflate'))
	const arrayBuffer = await new Response(decompressed).arrayBuffer()
	return new TextDecoder().decode(arrayBuffer)
}

async function extractPresetXmlFromKppBytes(bytes: Uint8Array): Promise<string | undefined> {
	if (!isPngSignature(bytes)) return undefined
	for (const chunk of readPngChunks(bytes)) {
		if (chunk.type !== 'zTXt') continue
		const nulIndex = chunk.data.indexOf(0)
		if (nulIndex < 0 || nulIndex + 2 > chunk.data.length) continue
		const keyword = new TextDecoder().decode(chunk.data.slice(0, nulIndex))
		if (keyword !== 'preset') continue
		const compressionMethod = chunk.data[nulIndex + 1]
		if (compressionMethod !== 0) continue
		try {
			return await inflateDeflateBytes(chunk.data.slice(nulIndex + 2))
		} catch (error) {
			console.warn('[KritaBundle] failed to inflate preset PNG text chunk', { error })
			return undefined
		}
	}
	return undefined
}

function getTextContent(node: Element, ...selectors: string[]) {
	for (const selector of selectors) {
		const selected = node.getAttribute(selector)
		if (selected) return selected
	}
	for (const attr of node.getAttributeNames()) {
		for (const selector of selectors) {
			if (attr === selector || attr.endsWith(`:${selector}`)) {
				const selected = node.getAttribute(attr)
				if (selected) return selected
			}
		}
	}
	return undefined
}

function parseManifestXml(manifestXml: string): KritaBundleManifestEntry[] {
	const document = parseXml(manifestXml)
	const allElements = Array.from(document.getElementsByTagName('*'))
	const fileEntries = allElements.filter((entry) => {
		const tagName = entry.tagName.toLowerCase()
		const localName = entry.localName?.toLowerCase()
		return tagName === 'manifest:file-entry' || localName === 'file-entry' || tagName === 'file-entry'
	})

	return fileEntries
		.map<KritaBundleManifestEntry | undefined>((entry) => {
			const fullPathRaw = getTextContent(entry, 'manifest:full-path', 'full-path')
			if (!fullPathRaw || fullPathRaw === '/') return undefined
			const fullPath = normalizeBundlePath(fullPathRaw)
			const mediaType = getTextContent(entry, 'manifest:media-type', 'media-type')
			const md5 = getTextContent(entry, 'manifest:md5sum', 'md5sum')
			const tags = Array.from(entry.getElementsByTagName('*'))
				.filter((tag) => {
					const tagName = tag.tagName.toLowerCase()
					const localName = tag.localName?.toLowerCase()
					return tagName === 'manifest:tag' || localName === 'tag' || tagName === 'tag'
				})
				.map((tag) => tag.textContent?.trim() ?? '')
				.filter(Boolean)
			return {
				fullPath,
				mediaType: mediaType || undefined,
				md5: md5 || undefined,
				tags,
				resourceType: inferResourceType(fullPath, mediaType),
				name: fullPath.split('/').at(-1) ?? fullPath,
			}
		})
		.filter((entry): entry is KritaBundleManifestEntry => entry !== undefined)
}

function parseMetaXml(metaXml: string): KritaBundleMetadata {
	const document = parseXml(metaXml)
	const lookup = (tagSuffix: string) =>
		Array.from(document.getElementsByTagName('*')).find((node) => node.tagName.endsWith(`:${tagSuffix}`))
	return {
		title: lookup('title')?.textContent?.trim() || undefined,
		author: lookup('author')?.textContent?.trim() || undefined,
		description: lookup('description')?.textContent?.trim() || undefined,
		generator: lookup('generator')?.textContent?.trim() || undefined,
		version: lookup('version')?.textContent?.trim() || undefined,
		created: lookup('creation-date')?.textContent?.trim() || undefined,
		modified: lookup('date')?.textContent?.trim() || undefined,
	}
}

async function getZipEntryText(zip: JSZip, path: string) {
	const entry = zip.file(path)
	if (!entry) return undefined
	return entry.async('text')
}

async function getZipEntryBytes(zip: JSZip, path: string) {
	const entry = zip.file(path)
	if (!entry) return undefined
	return entry.async('uint8array')
}

async function getZipEntryTextByBundlePath(zip: JSZip, path: string) {
	const normalized = normalizeBundlePath(path)
	const directCandidates = [normalized, `./${normalized}`, `/${normalized}`]

	for (const candidate of directCandidates) {
		const text = await getZipEntryText(zip, candidate)
		if (text) return text
	}

	const normalizedLookup = normalized.toLowerCase()
	for (const key of Object.keys(zip.files)) {
		if (normalizeBundlePath(key).toLowerCase() === normalizedLookup) {
			const text = await getZipEntryText(zip, key)
			if (text) return text
		}
	}

	return undefined
}

async function getZipEntryBytesByBundlePath(zip: JSZip, path: string) {
	const normalized = normalizeBundlePath(path)
	const directCandidates = [normalized, `./${normalized}`, `/${normalized}`]

	for (const candidate of directCandidates) {
		const bytes = await getZipEntryBytes(zip, candidate)
		if (bytes) return bytes
	}

	const normalizedLookup = normalized.toLowerCase()
	for (const key of Object.keys(zip.files)) {
		if (normalizeBundlePath(key).toLowerCase() === normalizedLookup) {
			const bytes = await getZipEntryBytes(zip, key)
			if (bytes) return bytes
		}
	}

	return undefined
}

function clamp(value: number, min: number, max: number) {
	return Math.max(min, Math.min(max, value))
}

function parseNumber(value: string | null | undefined) {
	if (!value) return undefined
	const parsed = Number.parseFloat(value)
	if (!Number.isFinite(parsed)) return undefined
	return parsed
}

function findParamElements(document: Document, paramName: string): Element[] {
	const wanted = paramName.trim().toLowerCase()
	if (!wanted) return []

	return Array.from(document.getElementsByTagName('*')).filter((node) => {
		const localName = (node.localName || node.tagName || '').toLowerCase()
		if (localName !== 'param') return false
		const name = node.getAttribute('name')?.trim().toLowerCase()
		if (!name) return false
		return name === wanted || name.endsWith(`/${wanted}`) || name.includes(wanted)
	})
}

function decodeXmlEntities(raw: string): string {
	return raw
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, '&')
}

function getParamStringValue(param: Element): string | undefined {
	const attrValue =
		param.getAttribute('value') ??
		param.getAttribute('val') ??
		param.getAttribute('string') ??
		param.getAttribute('filename')
	if (attrValue?.trim()) return attrValue.trim()

	const text = param.textContent?.trim()
	if (text) return text

	return undefined
}

function parseFloatParam(document: Document, paramNames: string[]): number | undefined {
	for (const name of paramNames) {
		const params = findParamElements(document, name)
		for (const param of params) {
			const value = parseNumber(getParamStringValue(param))
			if (value !== undefined) return value
		}
	}
	return undefined
}

function parseCurvePointsFromString(raw: string): Array<{ x: number; y: number }> {
	const points: Array<{ x: number; y: number }> = []
	const pairs = raw
		.split(';')
		.map((part) => part.trim())
		.filter(Boolean)

	for (const pair of pairs) {
		const [xRaw, yRaw] = pair.split(',').map((part) => part.trim())
		const x = Number.parseFloat(xRaw ?? '')
		const y = Number.parseFloat(yRaw ?? '')
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue
		points.push({ x, y })
	}

	return points
}

function parseCurvePointsFromParam(document: Document, paramName: string): Array<{ x: number; y: number }> {
	const params = findParamElements(document, paramName)
	for (const param of params) {
		const candidates: string[] = []

		const direct = getParamStringValue(param)
		if (direct) candidates.push(direct)

		for (const node of Array.from(param.getElementsByTagName('*'))) {
			for (const attrName of node.getAttributeNames()) {
				const value = node.getAttribute(attrName)
				if (value) candidates.push(value)
			}
			if (node.textContent?.trim()) candidates.push(node.textContent.trim())
		}

		for (const candidate of candidates) {
			if (!candidate.includes(',')) continue
			const points = parseCurvePointsFromString(candidate)
			if (points.length >= 2) return points
		}
	}

	return []
}

function collectParamNames(document: Document): string[] {
	const names = new Set<string>()
	for (const node of Array.from(document.getElementsByTagName('*'))) {
		const localName = (node.localName || node.tagName || '').toLowerCase()
		if (localName !== 'param') continue
		const name = node.getAttribute('name')?.trim()
		if (name) names.add(name)
	}
	return Array.from(names)
}

function extractEmbeddedBrushResourceFilename(document: Document): string | undefined {
	for (const node of Array.from(document.getElementsByTagName('*'))) {
		const localName = (node.localName || node.tagName || '').toLowerCase()
		if (localName !== 'resource') continue
		const type = node.getAttribute('type')?.trim().toLowerCase()
		if (type !== 'brushes' && type !== 'brush') continue
		const filename = node.getAttribute('filename')?.trim()
		if (filename) return filename
	}
	return undefined
}

function sampleCurveY(points: Array<{ x: number; y: number }>, targetX: number): number | undefined {
	if (points.length === 0) return undefined
	const sorted = [...points].sort((a, b) => a.x - b.x)
	if (targetX <= sorted[0].x) return sorted[0].y
	if (targetX >= sorted[sorted.length - 1].x) return sorted[sorted.length - 1].y

	for (let i = 0; i < sorted.length - 1; i++) {
		const a = sorted[i]
		const b = sorted[i + 1]
		if (targetX < a.x || targetX > b.x) continue
		const dx = b.x - a.x
		if (Math.abs(dx) < 1e-6) return a.y
		const t = (targetX - a.x) / dx
		return a.y + (b.y - a.y) * t
	}

	return undefined
}

function fitCurveExponent(points: Array<{ x: number; y: number }>, fallback: number): number {
	if (points.length < 2) return fallback
	const x1 = 1 / 3
	const x2 = 2 / 3
	const y1 = sampleCurveY(points, x1)
	const y2 = sampleCurveY(points, x2)
	if (y1 === undefined || y2 === undefined || y1 <= 0 || y2 <= 0) return fallback
	const exponent = Math.log(y2 / y1) / Math.log(x2 / x1)
	if (!Number.isFinite(exponent)) return fallback
	return clamp(exponent, 0.05, 4)
}

function extractBrushTipFilename(document: Document, kppXml: string): string | undefined {
	const embeddedResourceFilename = extractEmbeddedBrushResourceFilename(document)
	if (embeddedResourceFilename) return embeddedResourceFilename

	for (const paramName of ['filename', 'brushfilename', 'brush_file', 'file']) {
		for (const param of findParamElements(document, paramName)) {
			const value = getParamStringValue(param)
			if (value) return value
		}
	}

	for (const param of Array.from(document.getElementsByTagName('*')).filter((node) => {
		const localName = (node.localName || node.tagName || '').toLowerCase()
		if (localName !== 'param') return false
		const name = node.getAttribute('name')?.toLowerCase() ?? ''
		return name.includes('filename') || name.includes('brush')
	})) {
		const value = getParamStringValue(param)
		if (value) return value
	}

	for (const param of findParamElements(document, 'brush_definition')) {
		for (const node of Array.from(param.getElementsByTagName('*'))) {
			const localName = (node.localName || node.tagName || '').toLowerCase()
			if (localName !== 'brush') continue
			const filename = node.getAttribute('filename')?.trim()
			if (filename) return filename
		}

		const text = param.textContent ?? ''
		const decodedText = decodeXmlEntities(text)
		const match = decodedText.match(/<brush[^>]*filename\s*=\s*['"]([^'"]+)['"]/i)
		if (match?.[1]) return match[1].trim()
	}

	const fallbackDecodedXml = decodeXmlEntities(kppXml)
	const fallbackMatch = fallbackDecodedXml.match(/<brush[^>]*filename\s*=\s*['"]([^'"]+)['"]/i)
	if (fallbackMatch?.[1]) return fallbackMatch[1].trim()

	return undefined
}

async function extractBrushTipData(
	zip: JSZip,
	filename: string | undefined
): Promise<Uint8Array | null> {
	if (!filename) return null
	const normalizedFilename = normalizeBundlePath(filename)
	const basename = normalizedFilename.split('/').at(-1) ?? normalizedFilename
	const candidates = [
		normalizedFilename,
		`kis_brushes/${basename}`,
		`brushes/${basename}`,
	]

	for (const candidate of candidates) {
		const bytes = await getZipEntryBytesByBundlePath(zip, candidate)
		if (bytes) return bytes
	}

	const normalizedLookup = normalizeBundlePath(basename).toLowerCase()
	for (const key of Object.keys(zip.files)) {
		const normalizedKey = normalizeBundlePath(key).toLowerCase()
		if (normalizedKey === normalizedLookup || normalizedKey.endsWith(`/${normalizedLookup}`)) {
			const bytes = await getZipEntryBytes(zip, key)
			if (bytes) return bytes
		}
	}

	return null
}

function collectNumericSignals(xmlText: string): Map<string, number[]> {
	const document = parseXml(xmlText)
	const signals = new Map<string, number[]>()
	const addSignal = (name: string, value: number | undefined) => {
		if (!Number.isFinite(value)) return
		const key = name.toLowerCase()
		const current = signals.get(key) ?? []
		current.push(value as number)
		signals.set(key, current)
	}

	const allNodes = Array.from(document.getElementsByTagName('*'))
	for (const node of allNodes) {
		const localName = (node.localName || node.tagName || '').toLowerCase()
		const textValue = parseNumber(node.textContent?.trim())
		addSignal(localName, textValue)

		for (const attrName of node.getAttributeNames()) {
			const raw = node.getAttribute(attrName)
			const value = parseNumber(raw)
			if (value === undefined) continue
			addSignal(attrName, value)
			addSignal(`${localName}.${attrName.toLowerCase()}`, value)
		}
	}

	return signals
}

function pickSignalAverage(signals: Map<string, number[]>, keywords: string[]) {
	const matches: number[] = []
	for (const [key, values] of signals) {
		if (keywords.some((keyword) => key.includes(keyword))) {
			matches.push(...values)
		}
	}
	if (!matches.length) return undefined
	return matches.reduce((sum, value) => sum + value, 0) / matches.length
}

async function derivePresetStyleFromKppText(
	zip: JSZip,
	presetName: string,
	presetPath: string,
	kppXml: string
): Promise<KritaDerivedPresetStyle> {
	const kppDocument = parseXml(kppXml)
	const embeddedBrushResourceFilename = extractEmbeddedBrushResourceFilename(kppDocument)
	const signals = collectNumericSignals(kppXml)
	const identity = `${presetName}:${presetPath}`.toLowerCase()

	const sizeSignal =
		pickSignalAverage(signals, ['paintopsize', 'brushsize', 'size', 'radius', 'diameter', 'width']) ??
		24
	const opacitySignal =
		pickSignalAverage(signals, ['opacity', 'flow', 'alpha', 'strength', 'transparency']) ??
		0.85
	const roughnessSignal =
		pickSignalAverage(signals, ['texture', 'grain', 'rough', 'scatter', 'fuzzy', 'noise']) ??
		0.35
	const ratioSignal =
		pickSignalAverage(signals, ['ratio', 'roundness', 'sharp', 'ellipse', 'angle']) ??
		1

	let pencilBrushSizePx = sizeSignal
	if (pencilBrushSizePx <= 1.5) pencilBrushSizePx *= 100
	else if (pencilBrushSizePx <= 10) pencilBrushSizePx *= 5

	let pencilOpacitySensitivity = opacitySignal
	if (pencilOpacitySensitivity <= 1) pencilOpacitySensitivity = 0.5 + pencilOpacitySensitivity * 2.8

	let pencilTextureIntensity = roughnessSignal
	if (pencilTextureIntensity > 1) pencilTextureIntensity /= 100

	let pencilCrossSectionAspectRatio = ratioSignal
	if (pencilCrossSectionAspectRatio <= 0.2) pencilCrossSectionAspectRatio = 1 + pencilCrossSectionAspectRatio * 25
	if (pencilCrossSectionAspectRatio > 12) pencilCrossSectionAspectRatio = 1 + (pencilCrossSectionAspectRatio % 11)

	if (/(charcoal|graphite|pencil|chalk|conte|pastel)/i.test(identity)) {
		pencilTextureIntensity = Math.max(pencilTextureIntensity, 0.5)
		pencilCrossSectionAspectRatio = Math.max(pencilCrossSectionAspectRatio, 3)
	}
	if (/(ink|pen|liner|fineliner|calligraphy)/i.test(identity)) {
		pencilTextureIntensity = Math.min(pencilTextureIntensity, 0.25)
		pencilCrossSectionAspectRatio = Math.min(pencilCrossSectionAspectRatio, 2.2)
	}

	const spacingFactor = parseFloatParam(kppDocument, ['Spacing/isotropic', 'spacing']) ?? 0.2
	const sizeCurvePoints = parseCurvePointsFromParam(kppDocument, 'PressureSize')
	const sizeCurveExponent = fitCurveExponent(sizeCurvePoints, 0.7)
	const opacityCurvePoints = parseCurvePointsFromParam(kppDocument, 'PressureOpacity')
	const opacityCurveExponent = fitCurveExponent(opacityCurvePoints, 1.2)
	const rotationJitterRaw = parseFloatParam(kppDocument, ['rotation', 'jitter']) ?? 0
	const brushTipFilename = extractBrushTipFilename(kppDocument, kppXml) ?? embeddedBrushResourceFilename
	const brushTipData = await extractBrushTipData(zip, brushTipFilename)

	return {
		pencilBrushSizePx: Math.round(clamp(pencilBrushSizePx, 1, 600)),
		pencilOpacitySensitivity: +clamp(pencilOpacitySensitivity, 0, 5).toFixed(2),
		pencilTextureIntensity: +clamp(pencilTextureIntensity, 0, 1).toFixed(2),
		pencilCrossSectionAspectRatio: +clamp(pencilCrossSectionAspectRatio, 1, 12).toFixed(2),
		pencilTextureEnabled: true,
		brushTipData,
		spacingFactor: +Math.max(0.01, spacingFactor).toFixed(3),
		sizeCurveExponent: +sizeCurveExponent.toFixed(3),
		opacityCurveExponent: +opacityCurveExponent.toFixed(3),
		rotationJitter: +clamp(rotationJitterRaw, 0, 1).toFixed(3),
	}
}

export async function parseKritaBundle(file: File): Promise<KritaBundleImportSummary> {
	const zip = await JSZip.loadAsync(await file.arrayBuffer())
	const zipKeys = Object.keys(zip.files)
	const brushLikeZipEntries = zipKeys.filter((key) => {
		const normalized = normalizeBundlePath(key).toLowerCase()
		return (
			normalized.includes('brush') ||
			normalized.endsWith('.png') ||
			normalized.endsWith('.gbr') ||
			normalized.endsWith('.abr') ||
			normalized.endsWith('.svg') ||
			normalized.endsWith('.pat')
		)
	})
	console.log('[KritaBundle] zip entry diagnostics', {
		entryCount: zipKeys.length,
		brushLikeCount: brushLikeZipEntries.length,
		brushLikeSample: brushLikeZipEntries.slice(0, 20),
	})
	const manifestXml = await getZipEntryText(zip, 'META-INF/manifest.xml')
	if (!manifestXml) {
		throw new Error('This file is missing META-INF/manifest.xml and is not a valid Krita bundle.')
	}

	const manifestEntries = parseManifestXml(manifestXml)
	const metaXml = await getZipEntryText(zip, 'meta.xml')
	const meta = metaXml ? parseMetaXml(metaXml) : {}
	const previewEntryPath = zip.file('preview.png') ? 'preview.png' : undefined
	const presetEntries = manifestEntries.filter((entry) => entry.resourceType === 'brush-preset')
	const resourceEntries = manifestEntries.filter((entry) => entry.resourceType !== 'brush-preset')
	const warnings: string[] = []
	const derivedPresetStyles: Record<string, KritaDerivedPresetStyle> = {}
	let didLogParamDiagnostics = false

	for (const preset of presetEntries) {
		const presetBytes = await getZipEntryBytesByBundlePath(zip, preset.fullPath)
		const presetXml = presetBytes ? await extractPresetXmlFromKppBytes(presetBytes) : await getZipEntryTextByBundlePath(zip, preset.fullPath)
		if (!presetXml) continue
		try {
			const presetDocument = parseXml(presetXml)
			const debugTipFilename = extractBrushTipFilename(presetDocument, presetXml)
			const embeddedBrushResourceFilename = extractEmbeddedBrushResourceFilename(presetDocument)
			if (!didLogParamDiagnostics) {
				didLogParamDiagnostics = true
				const allParamNames = collectParamNames(presetDocument)
				const interestingParamNames = allParamNames.filter((name) =>
					/(pressure|opacity|size|spacing|rotation|jitter|brush|tip|curve)/i.test(name)
				)
				console.log('[KritaBundle] first preset param diagnostics', {
					presetPath: preset.fullPath,
					paramCount: allParamNames.length,
					interestingParamSample: interestingParamNames.slice(0, 80),
					brushTipFilename: debugTipFilename ?? null,
					embeddedBrushResourceFilename: embeddedBrushResourceFilename ?? null,
				})
			}

			derivedPresetStyles[preset.fullPath] = await derivePresetStyleFromKppText(
				zip,
				preset.name,
				preset.fullPath,
				presetXml
			)
			console.log('[KritaBundle] parsed preset', preset.fullPath, {
				brushTipFilename: debugTipFilename ?? null,
				embeddedBrushResourceFilename: embeddedBrushResourceFilename ?? null,
				hasBrushTipData: !!derivedPresetStyles[preset.fullPath]?.brushTipData,
				brushTipLen: derivedPresetStyles[preset.fullPath]?.brushTipData?.length ?? 0,
				spacingFactor: derivedPresetStyles[preset.fullPath]?.spacingFactor,
				sizeCurveExponent: derivedPresetStyles[preset.fullPath]?.sizeCurveExponent,
				opacityCurveExponent: derivedPresetStyles[preset.fullPath]?.opacityCurveExponent,
				rotationJitter: derivedPresetStyles[preset.fullPath]?.rotationJitter,
			})
		} catch (error) {
			warnings.push(`Could not parse preset parameters for ${preset.name}.`)
			console.warn('[KritaBundle] preset parse failed', { presetPath: preset.fullPath, error })
		}
	}

	if (!presetEntries.length) {
		warnings.push('No brush preset entries were found under kis_paintoppresets/.')
	}

	if (!zip.file('preview.png')) {
		warnings.push('No preview.png found in the bundle root.')
	}

	return {
		fileName: file.name,
		bundleName: meta.title?.trim() || file.name.replace(/\.(bundle|zip)$/i, ''),
		meta,
		manifestEntries,
		presetEntries,
		derivedPresetStyles,
		resourceEntries,
		previewEntryPath,
		warnings,
	}
}

export async function saveKritaBundleToVault(
	plugin: TldrawPlugin,
	file: File,
	options?: { folder?: string }
) {
	const configuredFolder = options?.folder ?? plugin.settings.kritaBrushBundleFolder
	const safeFolder = typeof configuredFolder === 'string' ? configuredFolder.trim() : ''
	const folder = normalizePath(safeFolder || 'tldraw/krita-bundles')
	await checkAndCreateFolder(folder, plugin.app.vault)
	const rawFilename = typeof file.name === 'string' ? file.name.trim() : ''
	const safeBaseName = rawFilename || `krita-bundle-${Date.now()}.bundle`
	const filename = safeBaseName.endsWith('.bundle') ? safeBaseName : `${safeBaseName}.bundle`
	const vaultPath = getNewUniqueFilepath(plugin.app.vault, filename, folder)
	const tFile = await plugin.app.vault.createBinary(vaultPath, await file.arrayBuffer())
	return tFile
}

export async function importKritaBundleFile(plugin: TldrawPlugin, file: File) {
	const summary = await parseKritaBundle(file)
	const bundleFile = await saveKritaBundleToVault(plugin, file)
	const record: KritaImportedBrushBundleRecord = {
		id: window.crypto.randomUUID(),
		name: summary.bundleName,
		originalFileName: file.name,
		vaultPath: bundleFile.path,
		importedAt: new Date().toISOString(),
		summary,
	}

	const current = plugin.settings.kritaBrushBundles ?? []
	plugin.settings.kritaBrushBundles = [...current, record]
	await plugin.settingsManager.updateSettings(plugin.settings)

	return record
}
