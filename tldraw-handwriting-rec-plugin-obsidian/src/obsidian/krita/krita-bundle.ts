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
		.map((entry) => {
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
				mediaType,
				md5,
				tags,
				resourceType: inferResourceType(fullPath, mediaType),
				name: fullPath.split('/').at(-1) ?? fullPath,
			}
		})
		.filter((entry): entry is KritaBundleManifestEntry => !!entry)
}

function parseMetaXml(metaXml: string): KritaBundleMetadata {
	const document = parseXml(metaXml)
	const meta = Array.from(document.getElementsByTagName('*')).find((node) => node.tagName.endsWith(':meta'))
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

function clamp(value: number, min: number, max: number) {
	return Math.max(min, Math.min(max, value))
}

function parseNumber(value: string | null | undefined) {
	if (!value) return undefined
	const parsed = Number.parseFloat(value)
	if (!Number.isFinite(parsed)) return undefined
	return parsed
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

function derivePresetStyleFromKppText(presetName: string, presetPath: string, kppXml: string): KritaDerivedPresetStyle {
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

	return {
		pencilBrushSizePx: Math.round(clamp(pencilBrushSizePx, 1, 600)),
		pencilOpacitySensitivity: +clamp(pencilOpacitySensitivity, 0, 5).toFixed(2),
		pencilTextureIntensity: +clamp(pencilTextureIntensity, 0, 1).toFixed(2),
		pencilCrossSectionAspectRatio: +clamp(pencilCrossSectionAspectRatio, 1, 12).toFixed(2),
		pencilTextureEnabled: true,
	}
}

export async function parseKritaBundle(file: File): Promise<KritaBundleImportSummary> {
	const zip = await JSZip.loadAsync(await file.arrayBuffer())
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

	for (const preset of presetEntries) {
		const presetXml = await getZipEntryTextByBundlePath(zip, preset.fullPath)
		if (!presetXml) continue
		try {
			derivedPresetStyles[preset.fullPath] = derivePresetStyleFromKppText(preset.name, preset.fullPath, presetXml)
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
