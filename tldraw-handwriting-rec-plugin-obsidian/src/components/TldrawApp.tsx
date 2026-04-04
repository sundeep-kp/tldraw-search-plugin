import Fuse from 'fuse.js'
import { Menu, Notice, Platform, TAbstractFile, TFile } from 'obsidian'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { lockZoomIcon } from 'src/assets/data-icons'
import { TldrawInObsidianPluginProvider } from 'src/contexts/plugin'
import { useTldrawPlugin } from 'src/contexts/plugin'
import { useClickAwayListener } from 'src/hooks/useClickAwayListener'
import useUserPluginSettings from 'src/hooks/useUserPluginSettings'
import { isOnlineHtrModelConfigReady, resolveOnlineHtrModelConfig } from 'src/handwriting/modelConfig'
import { buildBatchedStrokeCandidates, DEFAULT_BATCH_POLICY } from 'src/handwriting/batching'
import { extractStroke } from 'src/handwriting/strokeExtractor'
import { processExtractedStroke } from 'src/handwriting/pipeline'
import { preprocessGroupForOnlineHtr } from 'src/handwriting/preprocessors/onlineHtrCarbune2020'
import { pressureStore } from 'src/handwriting/pressureStore'
import { createHandwritingRecognizer } from 'src/handwriting/recognizer'
import {
	acquireDocumentRecognitionScope,
	getDocumentRecognitionResults,
	getRecognitionResult,
	getRecognitionResultByFingerprint,
	removeRecognitionResult,
	releaseDocumentRecognitionScope,
	upsertRecognitionResult,
} from 'src/handwriting/recognitionResultsStore'
import {
	groupNormalizedStrokePayloads,
	groupNormalizedStrokePayloadsBySpatialProximity,
} from 'src/handwriting/strokeGrouping'
import {
	acquireDocumentStrokePayloadScope,
	getAllNormalizedStrokePayloads,
	getNormalizedStrokePayload,
	removeNormalizedStrokePayload,
	releaseDocumentStrokePayloadScope,
	upsertNormalizedStrokePayload,
} from 'src/handwriting/strokePayloadStore'
import {
	acquireDocumentWordCandidateScope,
	getDocumentWordCandidates,
	releaseDocumentWordCandidateScope,
	setDocumentWordCandidates,
} from 'src/handwriting/wordCandidateStore'
import { StrokeGroupCandidate } from 'src/handwriting/strokeGrouping'
import { CompletedDrawShape, StrokeExtractionResult } from 'src/handwriting/types'
import { useStrokeListener } from 'src/hooks/useStrokeListener'
import { useTldrawAppEffects } from 'src/hooks/useTldrawAppHook'
import TldrawPlugin from 'src/main'
import { FileSearchModal } from 'src/obsidian/modal/FileSearchModal'
import {
	acquireDocumentAnchorStickerScope,
	getAnchorSticker,
	getDocumentAnchorStickers,
	removeAnchorSticker,
	upsertAnchorSticker,
	releaseDocumentAnchorStickerScope,
} from 'src/tldraw/anchorStickerStore'
import {
	PLUGIN_ACTION_TOGGLE_ZOOM_LOCK,
	PLUGIN_ACTION_HANDWRITING_SEARCH,
	uiOverrides,
} from 'src/tldraw/ui-overrides'
import { TLDataDocumentStore } from 'src/utils/document'
import { PTLEditorBlockBlur } from 'src/utils/dom-attributes'
import {
	OPEN_FILE_ACTION,
	SAVE_FILE_COPY_ACTION,
	SAVE_FILE_COPY_IN_VAULT_ACTION,
} from 'src/utils/file'
import { isObsidianThemeDark } from 'src/utils/utils'
import {
	DefaultSizeStyle,
	DefaultStylePanel,
	DefaultStylePanelContent,
	DefaultToolbar,
	DefaultToolbarContent,
	DefaultMainMenu,
	DefaultMainMenuContent,
	Editor,
	TLAnyShapeUtilConstructor,
	type TLDefaultSizeStyle,
	TLComponents,
	Tldraw,
	DEFAULT_EMBED_DEFINITIONS,
	type TLEmbedDefinition,
	TldrawEditorStoreProps,
	TldrawUiMenuItem,
	TldrawUiMenuSubmenu,
	TldrawUiSlider,
	TLStateNodeConstructor,
	TLStoreSnapshot,
	TLUiAssetUrlOverrides,
	TLUiEventHandler,
	TLUiOverrides,
	type TLUiStylePanelProps,
	type VecLike,
	useEditor,
	useIsToolSelected,
	useRelevantStyles,
	useTranslation,
	useActions,
	useTools,
} from 'tldraw'
import {
	PENCIL_SHAPE_UTILS,
	setPencilBaseStrokeEnabled,
	setPencilDefaultStrokeEnabled,
	setPencilFallbackStylingEnabled,
	setPencilCrossSectionAspectRatio,
	setPencilOpacitySensitivity,
	setPencilSampledOverlayEnabled,
} from 'src/tldraw/rendering/pencil-draw-shape-util'
import { getPressureOpacityStyle } from 'src/tldraw/rendering/pencil-texture'
import PluginKeyboardShortcutsDialog from './PluginKeyboardShortcutsDialog'
import PluginQuickActions from './PluginQuickActions'

type TldrawAppOptions = {
	iconAssetUrls?: TLUiAssetUrlOverrides['icons']
	isReadonly?: boolean
	autoFocus?: boolean
	focusOnMount?: boolean
	/**
	 * Takes precedence over the user's plugin preference
	 */
	initialTool?: string
	hideUi?: boolean
	shapeUtils?: readonly TLAnyShapeUtilConstructor[]
	/**
	 * Whether to call `.selectNone` on the Tldraw editor instance when it is mounted.
	 */
	selectNone?: boolean
	tools?: readonly TLStateNodeConstructor[]
	uiOverrides?: TLUiOverrides
	components?: TLComponents
	onEditorMount?: (editor: Editor) => void
	/**
	 *
	 * @param snapshot The snapshot that is initially loaded into the editor.
	 * @returns
	 */
	onInitialSnapshot?: (snapshot: TLStoreSnapshot) => void
	/**
	 *
	 * @param event
	 * @returns `true` if the editor should be blurred.
	 */
	onClickAwayBlur?: (event: PointerEvent) => boolean
	onUiEvent?: (editor: Editor | undefined, ...rest: Parameters<TLUiEventHandler>) => void
}

/**
 * Whether to use native tldraw store props or the plugin based store props.
 */
export type TldrawAppStoreProps =
	| {
			plugin?: undefined
			/**
			 * Use the native tldraw store props.
			 */
			tldraw: TldrawEditorStoreProps
	  }
	| {
			/**
			 * Use the plugin based store props.
			 */
			plugin: TLDataDocumentStore
			tldraw?: undefined
	  }

export type TldrawAppProps = {
	plugin: TldrawPlugin
	/**
	 * If this value is undefined, then the tldraw document will not be persisted.
	 */
	store?: TldrawAppStoreProps
	options: TldrawAppOptions
	targetDocument: Document
}

// https://github.com/tldraw/tldraw/blob/58890dcfce698802f745253ca42584731d126cc3/apps/examples/src/examples/custom-main-menu/CustomMainMenuExample.tsx
const components = (plugin: TldrawPlugin): TLComponents => ({
	MainMenu: () => (
		<DefaultMainMenu>
			<LocalFileMenu plugin={plugin} />
			<DefaultMainMenuContent />
		</DefaultMainMenu>
	),
	StylePanel: PluginStylePanel,
	Toolbar: PluginToolbar,
	KeyboardShortcutsDialog: PluginKeyboardShortcutsDialog,
	QuickActions: PluginQuickActions,
})

const BRUSH_SIZE_STEPS: TLDefaultSizeStyle[] = ['s', 'm', 'l', 'xl']
const PENCIL_BRUSH_MIN_PX = 1
const PENCIL_BRUSH_MAX_PX = 600
const DEFAULT_PENCIL_BRUSH_PX = 24
const PENCIL_SCRUB_PX_PER_SCREEN_PIXEL = 0.25
const PENCIL_POST_SCRUB_RESUME_DISTANCE_PX = 3

const ANY_WEBSITE_EMBED_DEFINITION: TLEmbedDefinition = {
	type: 'website',
	title: 'Website',
	hostnames: ['*'],
	minWidth: 280,
	minHeight: 200,
	width: 960,
	height: 600,
	doesResize: true,
	overridePermissions: {
		'allow-popups-to-escape-sandbox': true,
	},
	toEmbedUrl: (url) => {
		try {
			const parsed = new URL(url)
			if (!['http:', 'https:'].includes(parsed.protocol)) return
			return parsed.toString()
		} catch {
			return
		}
	},
	fromEmbedUrl: (url) => {
		try {
			const parsed = new URL(url)
			if (!['http:', 'https:'].includes(parsed.protocol)) return
			return parsed.toString()
		} catch {
			return
		}
	},
}

const EMBED_DEFINITIONS: TLEmbedDefinition[] = [
	...DEFAULT_EMBED_DEFINITIONS,
	ANY_WEBSITE_EMBED_DEFINITION,
]

function getStrokeWidthForSize(size: TLDefaultSizeStyle): number {
	switch (size) {
		case 's':
			return 2
		case 'm':
			return 3.5
		case 'l':
			return 5
		case 'xl':
		default:
			return 10
	}
}

function clampBrushPx(value: number): number {
	if (!Number.isFinite(value)) return DEFAULT_PENCIL_BRUSH_PX
	return Math.max(PENCIL_BRUSH_MIN_PX, Math.min(PENCIL_BRUSH_MAX_PX, Math.round(value)))
}

function hashStringToUnit(value: string): number {
	let hash = 0
	for (let i = 0; i < value.length; i++) {
		hash = (hash * 31 + value.charCodeAt(i)) | 0
	}
	return Math.abs(hash % 1000) / 1000
}

function deriveKritaPresetStyle(presetName: string, presetPath: string) {
	const identity = `${presetName}::${presetPath}`.toLowerCase()
	const seed = hashStringToUnit(identity)

	let pencilBrushSizePx = Math.round(8 + seed * 38)
	let pencilOpacitySensitivity = +(0.65 + seed * 2.2).toFixed(2)
	let pencilTextureIntensity = +(0.08 + seed * 0.72).toFixed(2)
	let pencilCrossSectionAspectRatio = +(1 + seed * 5.5).toFixed(2)

	if (/(charcoal|graphite|pencil|chalk|conte|pastel)/i.test(identity)) {
		pencilBrushSizePx = 20 + Math.round(seed * 20)
		pencilOpacitySensitivity = +(0.9 + seed * 1.2).toFixed(2)
		pencilTextureIntensity = +(0.45 + seed * 0.45).toFixed(2)
		pencilCrossSectionAspectRatio = +(3.5 + seed * 3.5).toFixed(2)
	} else if (/(ink|pen|liner|fineliner|calligraphy)/i.test(identity)) {
		pencilBrushSizePx = 4 + Math.round(seed * 8)
		pencilOpacitySensitivity = +(1.8 + seed * 2.1).toFixed(2)
		pencilTextureIntensity = +(0.03 + seed * 0.2).toFixed(2)
		pencilCrossSectionAspectRatio = +(1 + seed * 1.5).toFixed(2)
	} else if (/(marker|felt|highlighter)/i.test(identity)) {
		pencilBrushSizePx = 16 + Math.round(seed * 26)
		pencilOpacitySensitivity = +(1.4 + seed * 1.1).toFixed(2)
		pencilTextureIntensity = +(0.05 + seed * 0.2).toFixed(2)
		pencilCrossSectionAspectRatio = +(2 + seed * 2.5).toFixed(2)
	} else if (/(brush|paint|watercolor|gouache|acrylic|oil)/i.test(identity)) {
		pencilBrushSizePx = 14 + Math.round(seed * 34)
		pencilOpacitySensitivity = +(0.85 + seed * 1.7).toFixed(2)
		pencilTextureIntensity = +(0.2 + seed * 0.55).toFixed(2)
		pencilCrossSectionAspectRatio = +(1.4 + seed * 2.4).toFixed(2)
	}

	return {
		pencilBrushSizePx: clampBrushPx(pencilBrushSizePx),
		pencilOpacitySensitivity: Math.max(0, pencilOpacitySensitivity),
		pencilTextureIntensity: Math.max(0, Math.min(1, pencilTextureIntensity)),
		pencilCrossSectionAspectRatio: Math.max(1, Math.min(12, pencilCrossSectionAspectRatio)),
	}
}

function getPencilBrushScale(editor: Editor, brushPx: number): number {
	const size = editor.getStyleForNextShape(DefaultSizeStyle)
	const baseWidth = getStrokeWidthForSize(size)
	const scale = clampBrushPx(brushPx) / baseWidth
	return Math.max(0.1, Math.min(120, scale))
}

function PencilBrushSizeSlider() {
	const editor = useEditor()
	const plugin = useTldrawPlugin()
	const userSettings = useUserPluginSettings(plugin.settingsManager)
	const msg = useTranslation()
	const tools = useTools()
	const isPencilSelected = useIsToolSelected(tools.pencil)
	const styles = useRelevantStyles()

	if (!isPencilSelected || !styles) return null

	const size = styles.get(DefaultSizeStyle)
	if (!size) return null

	const currentIndex =
		size.type === 'mixed'
			? BRUSH_SIZE_STEPS.length - 1
			: Math.max(0, BRUSH_SIZE_STEPS.indexOf(size.value))
	const configuredBrushPx = clampBrushPx(
		userSettings.handwritingRecognition?.pencilBrushSizePx ?? DEFAULT_PENCIL_BRUSH_PX
	)

	return (
		<div>
			<TldrawUiSlider
				data-testid="style.pencil-size"
				value={configuredBrushPx - PENCIL_BRUSH_MIN_PX}
				label={'style-panel.size'}
				onValueChange={(value) => {
					const nextBrushPx = clampBrushPx(PENCIL_BRUSH_MIN_PX + value)
					const nextScale = getPencilBrushScale(editor, nextBrushPx)

					editor.run(() => {
						const selectedDrawShapes = editor
							.getSelectedShapes()
							.filter((shape): shape is { id: string; type: 'draw'; props: { scale?: number } } => shape.type === 'draw')

						if (selectedDrawShapes.length > 0) {
							editor.updateShapes(
								selectedDrawShapes.map((shape) => ({
									id: shape.id,
									type: 'draw',
									props: {
										...shape.props,
										scale: nextScale,
									},
								}))
							)
						}

						editor.updateInstanceState({ isChangingStyle: true })
					})

					plugin.settingsManager.settings.handwritingRecognition = {
						...(plugin.settingsManager.settings.handwritingRecognition ?? {}),
						pencilBrushSizePx: nextBrushPx,
					}
					void plugin.settingsManager.updateSettings(plugin.settingsManager.settings)
				}}
				steps={PENCIL_BRUSH_MAX_PX - PENCIL_BRUSH_MIN_PX}
				title={msg('style-panel.size')}
				onHistoryMark={(id) => editor.markHistoryStoppingPoint(id)}
			/>
			<div className="tlui-button" style={{ pointerEvents: 'none', justifyContent: 'center' }}>
				Pencil: {configuredBrushPx}px
			</div>
		</div>
	)
}

type KritaPresetOption = {
	id: string
	label: string
	bundleName: string
	path: string
	derivedStyle?: {
		pencilBrushSizePx: number
		pencilOpacitySensitivity: number
		pencilTextureIntensity: number
		pencilCrossSectionAspectRatio: number
		pencilTextureEnabled: boolean
	}
}

function KritaBrushPresetPanel() {
	const plugin = useTldrawPlugin()
	const tools = useTools()
	const isPencilSelected = useIsToolSelected(tools.pencil)
	const userSettings = useUserPluginSettings(plugin.settingsManager)

	const presets = React.useMemo<KritaPresetOption[]>(() => {
		const bundles = userSettings.kritaBrushBundles ?? []
		const options: KritaPresetOption[] = []

		for (const bundle of bundles) {
			const bundleName = bundle.name || bundle.summary?.bundleName || bundle.originalFileName || 'Krita bundle'
			const entries = bundle.summary?.presetEntries ?? []
			for (const entry of entries) {
				const fileName = entry.name || entry.fullPath?.split('/').at(-1) || 'preset'
				const label = fileName.replace(/\.kpp$/i, '')
				options.push({
					id: `${bundle.id}:${entry.fullPath}`,
					label,
					bundleName,
					path: entry.fullPath,
					derivedStyle: bundle.summary?.derivedPresetStyles?.[entry.fullPath],
				})
			}
		}

		return options
	}, [userSettings.kritaBrushBundles])

	const selectedPresetId = userSettings.handwritingRecognition?.kritaSelectedPresetId

	const onSelectPreset = React.useCallback(
		(preset: KritaPresetOption) => {
			const derivedStyle = preset.derivedStyle ?? deriveKritaPresetStyle(preset.label, preset.path)
			plugin.settingsManager.settings.handwritingRecognition = {
				...(plugin.settingsManager.settings.handwritingRecognition ?? {}),
				kritaSelectedPresetId: preset.id,
				pencilBrushSizePx: derivedStyle.pencilBrushSizePx,
				pencilOpacitySensitivity: derivedStyle.pencilOpacitySensitivity,
				pencilTextureEnabled: derivedStyle.pencilTextureEnabled,
				pencilTextureIntensity: derivedStyle.pencilTextureIntensity,
				pencilCrossSectionAspectRatio: derivedStyle.pencilCrossSectionAspectRatio,
			}
			void plugin.settingsManager.updateSettings(plugin.settingsManager.settings)
		},
		[plugin.settingsManager]
	)

	if (!isPencilSelected) return null

	return (
		<div className="ptl-krita-brush-panel">
			<div className="ptl-krita-brush-panel-header">Krita brushes ({presets.length})</div>
			<div className="ptl-krita-brush-list" role="listbox" aria-label="Krita brush presets">
				{presets.length === 0 ? (
					<div className="ptl-krita-brush-empty">Import a Krita bundle to see presets here.</div>
				) : (
					presets.map((preset) => {
						const isSelected = selectedPresetId === preset.id
						return (
							<button
								key={preset.id}
								type="button"
								className="ptl-krita-brush-item"
								data-selected={isSelected}
								onClick={() => onSelectPreset(preset)}
							>
								<span className="ptl-krita-brush-item-name">{preset.label}</span>
								<span className="ptl-krita-brush-item-bundle">{preset.bundleName}</span>
							</button>
						)
					})
				)}
			</div>
		</div>
	)
}

function PluginStylePanel(props: TLUiStylePanelProps) {
	const styles = useRelevantStyles()

	if (!styles) {
		return <DefaultStylePanel isMobile={props.isMobile} />
	}

	return (
		<DefaultStylePanel isMobile={props.isMobile}>
			<>
				<PencilBrushSizeSlider />
				<KritaBrushPresetPanel />
				<DefaultStylePanelContent styles={styles} />
			</>
		</DefaultStylePanel>
	)
}

function PluginToolbar() {
	const tools = useTools()
	const pencilTool = tools.pencil
	const isPencilSelected = useIsToolSelected(pencilTool)

	return (
		<DefaultToolbar>
			{pencilTool ? <TldrawUiMenuItem isSelected={isPencilSelected} {...pencilTool} /> : null}
			<DefaultToolbarContent />
		</DefaultToolbar>
	)
}

function LocalFileMenu(props: { plugin: TldrawPlugin }) {
	const actions = useActions()

	return (
		<TldrawUiMenuSubmenu id="file" label="menu.file">
			{Platform.isMobile ? <></> : <TldrawUiMenuItem {...actions[SAVE_FILE_COPY_ACTION]} />}
			<TldrawUiMenuItem {...actions[SAVE_FILE_COPY_IN_VAULT_ACTION]} />
			<TldrawUiMenuItem {...actions[OPEN_FILE_ACTION]} />
		</TldrawUiMenuSubmenu>
	)
}

function getEditorStoreProps(storeProps: TldrawAppStoreProps) {
	return storeProps.tldraw
		? storeProps.tldraw
		: {
				store: storeProps.plugin.store,
			}
}

type SearchPanelResult = {
	groupId: string
	text: string
	confidence: number
	boundingBox: {
		minX: number
		minY: number
		maxX: number
		maxY: number
		width: number
		height: number
	}
}

type AnchorStickerOverlay = {
	shapeId: string
	targetPath: string
	targetDisplay: string
	targetWikilink: string
	left: number
	top: number
}

type PencilScrubHudState = {
	active: boolean
	left: number
	top: number
	brushPx: number
}

type UrlPasteDialogState = {
	url: string
	point?: VecLike
}

type YoutubeEmbedSelection = {
	shapeId: string
	url: string
	playlistId?: string
	videoId?: string
}

const DEFAULT_SEARCH_FOCUS_MIN_SIZE = 64
const SEARCH_FOCUS_PADDING = 20
const ANCHOR_MENTIONS_FRONTMATTER_KEY = 'tldraw-canvas-mentions'
const ANCHOR_MENTION_TOKENS_FRONTMATTER_KEY = 'tldraw-canvas-mention-shapes'

function createAnchorShapeId() {
	return `shape:anchor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function resolveAnchorPlacementPoint(editor: Editor): { x: number; y: number } {
	const pointer = editor.inputs.currentPagePoint as { x?: number; y?: number } | undefined
	if (pointer && Number.isFinite(pointer.x) && Number.isFinite(pointer.y)) {
		return { x: pointer.x as number, y: pointer.y as number }
	}

	const viewportBounds = editor.getViewportPageBounds()
	return {
		x: viewportBounds.x + viewportBounds.w / 2,
		y: viewportBounds.y + viewportBounds.h / 2,
	}
}

function buildAnchorMention(canvasPath: string) {
	return `[[${canvasPath}]]`
}

function buildAnchorMentionToken(canvasPath: string, shapeId: string) {
	return `${canvasPath}#${shapeId}`
}

function parseCanvasPathFromMentionToken(value: string): string | undefined {
	if (value.startsWith('[[') && value.includes(']]#')) {
		const end = value.indexOf(']]#')
		if (end > 2) return value.slice(2, end)
	}

	const hashIndex = value.lastIndexOf('#')
	if (hashIndex > 0) {
		return value.slice(0, hashIndex)
	}

	return undefined
}

function parseYoutubeIds(url: string): { videoId?: string; playlistId?: string } {
	try {
		const parsed = new URL(url)
		const host = parsed.hostname.replace(/^www\./, '').toLowerCase()
		if (!host.includes('youtube.com') && host !== 'youtu.be' && host !== 'music.youtube.com') {
			return {}
		}

		let videoId = parsed.searchParams.get('v') ?? undefined
		const playlistId = parsed.searchParams.get('list') ?? undefined

		if (!videoId && host === 'youtu.be') {
			const pathPart = parsed.pathname.split('/').filter(Boolean)[0]
			if (pathPart) videoId = pathPart
		}

		if (!videoId && parsed.pathname.startsWith('/embed/')) {
			const pathPart = parsed.pathname.split('/').filter(Boolean)[1]
			if (pathPart) videoId = pathPart
		}

		return { videoId, playlistId }
	} catch {
		return {}
	}
}

function buildYoutubeWatchUrl(videoId: string, playlistId?: string): string {
	const url = new URL('https://www.youtube.com/watch')
	url.searchParams.set('v', videoId)
	if (playlistId) {
		url.searchParams.set('list', playlistId)
	}
	return url.toString()
}

function normalizeYoutubeVideoEntry(raw: string): string | undefined {
	const trimmed = raw.trim()
	if (!trimmed) return

	if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
		return buildYoutubeWatchUrl(trimmed)
	}

	const ids = parseYoutubeIds(trimmed)
	if (!ids.videoId) return
	return buildYoutubeWatchUrl(ids.videoId, ids.playlistId)
}

function buildPlaylistStorageKey(documentId: string, shapeId: string): string {
	return `ptl.youtube-playlist.v1:${documentId}:${shapeId}`
}

function clampUnit(value: number): number {
	if (!Number.isFinite(value)) return 0.5
	return Math.max(0, Math.min(1, value))
}

function applyPressureSensitivity(value: number, sensitivity: number): number {
	const normalized = clampUnit(value)
	const centered = normalized - 0.5
	const amplified = clampUnit(0.5 + centered * sensitivity)

	// Keep non-zero pen contact above a floor to avoid accidental stroke dropouts
	// on hardware that emits very low pressure during light strokes.
	const MIN_CONTACT_PRESSURE = 0.08
	if (normalized > 0 && amplified < MIN_CONTACT_PRESSURE) {
		return MIN_CONTACT_PRESSURE
	}

	return amplified
}

function pseudoNoise2d(x: number, y: number): number {
	const sx = Number.isFinite(x) ? x : 0
	const sy = Number.isFinite(y) ? y : 0
	const t = Math.sin(sx * 12.9898 + sy * 78.233) * 43758.5453
	return t - Math.floor(t)
}

function applyPencilTexturePressure(
	value: number,
	sensitivity: number,
	textureEnabled: boolean,
	textureIntensity: number,
	x: number,
	y: number
): number {
	const base = applyPressureSensitivity(value, sensitivity)
	if (!textureEnabled) return base

	const amount = Math.max(0, Math.min(1, textureIntensity))
	if (amount <= 0) return base

	const noiseCentered = pseudoNoise2d(x, y) - 0.5
	const jitter = noiseCentered * 0.45 * amount
	const textured = clampUnit(base + jitter)

	const MIN_CONTACT_PRESSURE = 0.08
	if (base > 0 && textured < MIN_CONTACT_PRESSURE) {
		return MIN_CONTACT_PRESSURE
	}

	return textured
}

function getPencilTextureOffset(
	textureEnabled: boolean,
	textureIntensity: number,
	x: number,
	y: number
): { dx: number; dy: number } {
	if (!textureEnabled) return { dx: 0, dy: 0 }
	const amount = Math.max(0, Math.min(1, textureIntensity))
	if (amount <= 0) return { dx: 0, dy: 0 }

	const coarse = pseudoNoise2d(x * 0.7, y * 0.7) - 0.5
	const fine = pseudoNoise2d(x * 2.3 + 17, y * 2.3 + 29) - 0.5
	const mix = coarse * 0.65 + fine * 0.35

	// Keep jitter sub-pixel to low-pixel so lines feel textured, not shaky.
	const amplitudePx = 0.1 + amount * 0.9
	const angle = pseudoNoise2d(x * 1.1 + 101, y * 1.1 + 211) * Math.PI * 2
	return {
		dx: Math.cos(angle) * mix * amplitudePx,
		dy: Math.sin(angle) * mix * amplitudePx,
	}
}

const TldrawApp = ({
	plugin,
	store,
	options: {
		components: otherComponents,
		focusOnMount = true,
		hideUi = false,
		shapeUtils = PENCIL_SHAPE_UTILS,
		iconAssetUrls,
		initialTool,
		isReadonly = false,
		onEditorMount,
		onClickAwayBlur,
		onInitialSnapshot,
		onUiEvent: _onUiEvent,
		selectNone = false,
		tools,
		uiOverrides: otherUiOverrides,
	},
	targetDocument: ownerDocument,
}: TldrawAppProps) => {
	const userSettings = useUserPluginSettings(plugin.settingsManager)

	const assetUrls = React.useRef({
		fonts: plugin.getFontOverrides(),
		icons: {
			...plugin.getIconOverrides(),
			...iconAssetUrls,
			[PLUGIN_ACTION_TOGGLE_ZOOM_LOCK]: lockZoomIcon,
		},
	})
	const overridesUi = React.useRef({
		...uiOverrides(plugin),
		...otherUiOverrides,
	})
	const overridesUiComponents = React.useRef({
		...components(plugin),
		...otherComponents,
	})

	const storeProps = React.useMemo(() => (!store ? undefined : getEditorStoreProps(store)), [store])

	const [editor, setEditor] = React.useState<Editor>()

	const [_onInitialSnapshot, setOnInitialSnapshot] = React.useState<typeof onInitialSnapshot>(
		() => onInitialSnapshot
	)
	const setAppState = React.useCallback(
		(editor: Editor) => {
			setEditor(editor)
			if (_onInitialSnapshot) {
				_onInitialSnapshot(editor.store.getStoreSnapshot())
				setOnInitialSnapshot(undefined)
			}
		},
		[_onInitialSnapshot]
	)

	const onUiEvent = React.useCallback<TLUiEventHandler>(
		(...args) => {
			_onUiEvent?.(editor, ...args)
		},
		[_onUiEvent, editor]
	)

	const [isFocused, setIsFocused] = React.useState(false)
	const [overlayRenderTick, setOverlayRenderTick] = React.useState(0)
	const [isSearchPanelOpen, setIsSearchPanelOpen] = React.useState(false)
	const [isPlaylistPanelOpen, setIsPlaylistPanelOpen] = React.useState(false)
	const [searchQuery, setSearchQuery] = React.useState('')
	const [playlistInput, setPlaylistInput] = React.useState('')
	const [selectedSearchResultIndex, setSelectedSearchResultIndex] = React.useState(-1)
	const [activeSearchGroupId, setActiveSearchGroupId] = React.useState<string | undefined>(undefined)
	const [selectedYoutubeEmbed, setSelectedYoutubeEmbed] = React.useState<YoutubeEmbedSelection | null>(null)
	const [playlistEntriesByShapeId, setPlaylistEntriesByShapeId] = React.useState<Record<string, string[]>>({})
	const [pencilScrubHud, setPencilScrubHud] = React.useState<PencilScrubHudState>({
		active: false,
		left: 0,
		top: 0,
		brushPx: DEFAULT_PENCIL_BRUSH_PX,
	})
	const [urlPasteDialog, setUrlPasteDialog] = React.useState<UrlPasteDialogState | null>(null)
	const searchInputRef = React.useRef<HTMLInputElement>(null)
	const searchPanelRef = React.useRef<HTMLDivElement>(null)
	const searchResultsRef = React.useRef<HTMLDivElement>(null)
	const previousNormalizedSearchQueryRef = React.useRef('')
	const recognizerRef = React.useRef(createHandwritingRecognizer({ engine: 'stub' }))
	const recognitionDebounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const recognitionRunVersionRef = React.useRef(0)
	const suppressScrubArtifactUntilRef = React.useRef(0)
	const scrubCanceledShapeIdsRef = React.useRef(new Set<string>())
	const bootstrappedRecognitionByDocumentRef = React.useRef(new Set<string>())
	const urlPasteDialogResolverRef = React.useRef<
		((choice: 'iframe' | 'text' | 'cancel') => void) | null
	>(null)
	const handwritingDocumentId = React.useMemo(() => {
		if (store && 'plugin' in store && store.plugin) {
			return store.plugin.meta.uuid
		}
		return 'volatile-document'
	}, [store])
	const showRecognizedBatchTextOverlay =
		!!userSettings.handwritingRecognition?.showRecognizedBatchTextOverlay
	const enableAnchorBacklinks = !!userSettings.handwritingRecognition?.anchorBacklinksEnabled
	const searchZoomMinSize = React.useMemo(() => {
		const configured = userSettings.handwritingRecognition?.searchZoomMinSizePx
		if (typeof configured !== 'number' || !Number.isFinite(configured)) {
			return DEFAULT_SEARCH_FOCUS_MIN_SIZE
		}
		return Math.max(32, Math.min(512, configured))
	}, [userSettings.handwritingRecognition?.searchZoomMinSizePx])

	const setFocusedEditor = (isMounting: boolean, editor?: Editor) => {
		const { currTldrawEditor } = plugin
		if (currTldrawEditor !== editor) {
			if (currTldrawEditor) {
				currTldrawEditor.blur()
			}
			if (isMounting && !focusOnMount) {
				plugin.currTldrawEditor = undefined
				return
			}
			if (editor && editor.getContainer().win === editor.getContainer().win.activeWindow) {
				editor.focus()
				setIsFocused(true)
				plugin.currTldrawEditor = editor
			}
		}
	}

	useTldrawAppEffects({
		editor,
		initialTool,
		isReadonly,
		selectNone,
		settingsManager: plugin.settingsManager,
		onEditorMount,
		setFocusedEditor: (editor) => setFocusedEditor(true, editor),
	})

	const requestUrlPasteChoice = React.useCallback(
		(url: string, point?: VecLike): Promise<'iframe' | 'text' | 'cancel'> => {
			if (urlPasteDialogResolverRef.current) {
				urlPasteDialogResolverRef.current('cancel')
				urlPasteDialogResolverRef.current = null
			}

			setUrlPasteDialog({ url, point })

			return new Promise((resolve) => {
				urlPasteDialogResolverRef.current = resolve
			})
		},
		[]
	)

	const resolveUrlPasteChoice = React.useCallback((choice: 'iframe' | 'text' | 'cancel') => {
		const resolve = urlPasteDialogResolverRef.current
		urlPasteDialogResolverRef.current = null
		setUrlPasteDialog(null)
		resolve?.(choice)
	}, [])

	React.useEffect(() => {
		if (!editor) return

		editor.registerExternalContentHandler('url', async (externalContent) => {
			const { point, url } = externalContent as { point?: VecLike; url: string }
			const trimmedUrl = url.trim()
			let parsed: URL

			try {
				parsed = new URL(trimmedUrl)
			} catch {
				return editor.putExternalContent({ type: 'text', text: url, point })
			}

			if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
				return editor.putExternalContent({ type: 'text', text: parsed.toString(), point })
			}

			const choice = await requestUrlPasteChoice(parsed.toString(), point)
			if (choice === 'cancel') return

			if (choice === 'text') {
				return editor.putExternalContent({ type: 'text', text: parsed.toString(), point })
			}

			const embedUtil = editor.getShapeUtil('embed') as
				| { getEmbedDefinition: (url: string) => { url: string; definition: unknown } | undefined }
				| undefined
			const embedInfo = embedUtil?.getEmbedDefinition(parsed.toString())

			if (!embedInfo) {
				return editor.putExternalContent({ type: 'text', text: parsed.toString(), point })
			}

			await editor.putExternalContent({
				type: 'embed',
				url: embedInfo.url,
				point,
				embed: embedInfo.definition,
			})

			const activateEmbed = () => {
				let shape = editor.getOnlySelectedShape()
				if (!shape || shape.type !== 'embed') {
					const matches = editor
						.getCurrentPageShapes()
						.filter(
							(candidate): candidate is { id: string; type: 'embed'; props: { url: string } } =>
								candidate.type === 'embed' && candidate.props?.url === embedInfo.url
						)
					shape = matches.at(-1)
				}

				if (shape?.type === 'embed') {
					editor.setSelectedShapes([shape.id])
					editor.setEditingShape(shape.id)
				}
			}

			requestAnimationFrame(activateEmbed)
			setTimeout(activateEmbed, 80)
		})

		return () => {
			if (urlPasteDialogResolverRef.current) {
				urlPasteDialogResolverRef.current('cancel')
				urlPasteDialogResolverRef.current = null
			}
		}
	}, [editor, requestUrlPasteChoice])

	React.useEffect(() => {
		if (!editor) return

		const syncSelectedYoutubeEmbed = () => {
			const selected = editor.getOnlySelectedShape()
			if (!selected || selected.type !== 'embed') {
				setSelectedYoutubeEmbed(null)
				return
			}

			const url = typeof selected.props?.url === 'string' ? selected.props.url : ''
			const ids = parseYoutubeIds(url)
			if (!ids.videoId && !ids.playlistId) {
				setSelectedYoutubeEmbed(null)
				return
			}

			setSelectedYoutubeEmbed((current) => {
				if (
					current?.shapeId === selected.id &&
					current.url === url &&
					current.videoId === ids.videoId &&
					current.playlistId === ids.playlistId
				) {
					return current
				}
				return {
					shapeId: selected.id,
					url,
					videoId: ids.videoId,
					playlistId: ids.playlistId,
				}
			})
		}

		syncSelectedYoutubeEmbed()
		const intervalId = window.setInterval(syncSelectedYoutubeEmbed, 250)
		return () => window.clearInterval(intervalId)
	}, [editor])

	React.useEffect(() => {
		if (!selectedYoutubeEmbed) return
		if (playlistEntriesByShapeId[selectedYoutubeEmbed.shapeId]) return

		const storageKey = buildPlaylistStorageKey(handwritingDocumentId, selectedYoutubeEmbed.shapeId)
		let nextEntries: string[] = []
		try {
			const raw = window.localStorage.getItem(storageKey)
			if (raw) {
				const parsed = JSON.parse(raw)
				if (Array.isArray(parsed)) {
					nextEntries = parsed.filter((entry): entry is string => typeof entry === 'string')
				}
			}
		} catch {
			nextEntries = []
		}

		if (nextEntries.length === 0 && selectedYoutubeEmbed.videoId) {
			nextEntries = [buildYoutubeWatchUrl(selectedYoutubeEmbed.videoId, selectedYoutubeEmbed.playlistId)]
		}

		setPlaylistEntriesByShapeId((current) => ({
			...current,
			[selectedYoutubeEmbed.shapeId]: nextEntries,
		}))
	}, [handwritingDocumentId, playlistEntriesByShapeId, selectedYoutubeEmbed])

	const updateYoutubeEmbedVideo = React.useCallback(
		(videoUrl: string) => {
			if (!editor || !selectedYoutubeEmbed) return
			const nextIds = parseYoutubeIds(videoUrl)
			if (!nextIds.videoId) return

			const playlistId = nextIds.playlistId ?? selectedYoutubeEmbed.playlistId
			const nextUrl = buildYoutubeWatchUrl(nextIds.videoId, playlistId)

			editor.updateShapes([
				{
					id: selectedYoutubeEmbed.shapeId,
					type: 'embed',
					props: {
						url: nextUrl,
					},
				},
			])

			editor.setSelectedShapes([selectedYoutubeEmbed.shapeId])
			editor.setEditingShape(selectedYoutubeEmbed.shapeId)
		},
		[editor, selectedYoutubeEmbed]
	)

	const loadPlaylistFromInput = React.useCallback(() => {
		if (!selectedYoutubeEmbed) return

		const lines = playlistInput
			.split(/\r?\n/)
			.map((line) => normalizeYoutubeVideoEntry(line))
			.filter((entry): entry is string => !!entry)

		if (lines.length === 0) return

		const unique = Array.from(new Set(lines))
		const storageKey = buildPlaylistStorageKey(handwritingDocumentId, selectedYoutubeEmbed.shapeId)
		window.localStorage.setItem(storageKey, JSON.stringify(unique))

		setPlaylistEntriesByShapeId((current) => ({
			...current,
			[selectedYoutubeEmbed.shapeId]: unique,
		}))

		if (unique[0]) {
			updateYoutubeEmbedVideo(unique[0])
		}
	}, [handwritingDocumentId, playlistInput, selectedYoutubeEmbed, updateYoutubeEmbedVideo])

	const onnxModelConfig = React.useMemo(() => {
		return resolveOnlineHtrModelConfig(userSettings.handwritingRecognition)
	}, [userSettings.handwritingRecognition])

	const googleImeConfig = React.useMemo(() => {
		const source = userSettings.handwritingRecognition
		const language =
			typeof source?.googleImeLanguage === 'string' && source.googleImeLanguage.trim().length > 0
				? source.googleImeLanguage.trim()
				: 'en'
		const numOfWords =
			typeof source?.googleImeNumOfWords === 'number' && Number.isFinite(source.googleImeNumOfWords)
				? Math.max(0, Math.floor(source.googleImeNumOfWords))
				: 0
		const numOfReturn =
			typeof source?.googleImeNumOfReturn === 'number' && Number.isFinite(source.googleImeNumOfReturn)
				? Math.max(0, Math.floor(source.googleImeNumOfReturn))
				: 5

		return { language, numOfWords, numOfReturn }
	}, [userSettings.handwritingRecognition])

	const recognitionDebounceMs = React.useMemo(() => {
		const configured = userSettings.handwritingRecognition?.recognitionDebounceMs
		if (typeof configured !== 'number' || !Number.isFinite(configured)) return 500
		return Math.max(100, Math.floor(configured))
	}, [userSettings.handwritingRecognition?.recognitionDebounceMs])

	const strokeGroupingMaxTimeDeltaMs = React.useMemo(() => {
		const configured = userSettings.handwritingRecognition?.strokeGroupingMaxTimeDeltaMs
		if (typeof configured !== 'number' || !Number.isFinite(configured)) return 1200
		return Math.max(0, Math.floor(configured))
	}, [userSettings.handwritingRecognition?.strokeGroupingMaxTimeDeltaMs])

	const strokeGroupingAdaptiveGapMultiplier = React.useMemo(() => {
		const configured = userSettings.handwritingRecognition?.strokeGroupingAdaptiveGapMultiplier
		if (typeof configured !== 'number' || !Number.isFinite(configured)) return 1
		return Math.min(2, Math.max(0.5, configured))
	}, [userSettings.handwritingRecognition?.strokeGroupingAdaptiveGapMultiplier])

	const autoRecognitionHoldoffMs = React.useMemo(() => {
		// Keep auto mode from firing immediately after each pen-up by waiting until groups stabilize.
		return strokeGroupingMaxTimeDeltaMs
	}, [strokeGroupingMaxTimeDeltaMs])

	const pressureSensitivity = React.useMemo(() => {
		const configured = userSettings.handwritingRecognition?.pressureSensitivity
		if (typeof configured !== 'number' || !Number.isFinite(configured)) return 2.5
		return Math.max(0.5, Math.min(5, configured))
	}, [userSettings.handwritingRecognition?.pressureSensitivity])

	const pencilOpacitySensitivity = React.useMemo(() => {
		const configured = userSettings.handwritingRecognition?.pencilOpacitySensitivity
		if (typeof configured !== 'number' || !Number.isFinite(configured)) return 1
		return Math.max(0, configured)
	}, [userSettings.handwritingRecognition?.pencilOpacitySensitivity])

	const pencilCrossSectionAspectRatio = React.useMemo(() => {
		const configured = userSettings.handwritingRecognition?.pencilCrossSectionAspectRatio
		if (typeof configured !== 'number' || !Number.isFinite(configured)) return 5
		return Math.max(1, Math.min(12, configured))
	}, [userSettings.handwritingRecognition?.pencilCrossSectionAspectRatio])

	React.useEffect(() => {
		setPencilOpacitySensitivity(pencilOpacitySensitivity)
	}, [pencilOpacitySensitivity])

	React.useEffect(() => {
		setPencilCrossSectionAspectRatio(pencilCrossSectionAspectRatio)
	}, [pencilCrossSectionAspectRatio])

	const pencilDefaultStrokeEnabled = userSettings.debugLogs?.pencilDefaultStroke ?? true
	const pencilBaseStrokeEnabled = userSettings.debugLogs?.pencilBaseStroke ?? true
	const pencilSampledOverlayEnabled = userSettings.debugLogs?.pencilSampledOverlay ?? true
	const pencilFallbackStylingEnabled = userSettings.debugLogs?.pencilFallbackStyling ?? true

	// Force tldraw to invalidate render cache when renderer settings change
	const invalidateDrawShapeCache = React.useCallback(() => {
		if (!editor) return
		try {
			if (typeof editor.getCurrentPageShapes !== 'function') return
			const allShapes = editor.getCurrentPageShapes().filter((s) => s.type === 'draw')
			if (allShapes.length === 0) return

			// Dummy update: set x to itself to trigger cache invalidation.
			editor.updateShapes(
				allShapes.map((shape) => ({
					id: shape.id,
					type: shape.type,
					x: shape.x,
				}))
			)
		} catch (error) {
			console.warn('[TldrawApp] cache invalidation skipped', error)
		}
	}, [editor])

	React.useEffect(() => {
		setPencilDefaultStrokeEnabled(pencilDefaultStrokeEnabled)
		setPencilBaseStrokeEnabled(pencilBaseStrokeEnabled)
		setPencilSampledOverlayEnabled(pencilSampledOverlayEnabled)
		setPencilFallbackStylingEnabled(pencilFallbackStylingEnabled)
		// Apply all renderer toggles first, then invalidate once.
		console.log('[TldrawApp] Pencil renderer toggles updated', {
			pencilDefaultStrokeEnabled,
			pencilBaseStrokeEnabled,
			pencilSampledOverlayEnabled,
			pencilFallbackStylingEnabled,
		})
		console.log('[TldrawApp] Pencil fallback styling toggled:', pencilFallbackStylingEnabled)
		invalidateDrawShapeCache()
	}, [
		pencilBaseStrokeEnabled,
		pencilDefaultStrokeEnabled,
		pencilFallbackStylingEnabled,
		pencilSampledOverlayEnabled,
		invalidateDrawShapeCache,
	])

	const googleBatchPolicy = React.useMemo(() => {
		const source = userSettings.handwritingRecognition
		const toNumber = (value: unknown, fallback: number) =>
			typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback

		return {
			maxBatchWidthPx: toNumber(source?.googleImeBatchMaxWidthPx, DEFAULT_BATCH_POLICY.maxBatchWidthPx),
			maxBatchHeightPx: toNumber(
				source?.googleImeBatchMaxHeightPx,
				DEFAULT_BATCH_POLICY.maxBatchHeightPx
			),
			maxGroupsPerBatch: toNumber(
				source?.googleImeBatchMaxGroups,
				DEFAULT_BATCH_POLICY.maxGroupsPerBatch
			),
			maxStrokesPerBatch: toNumber(
				source?.googleImeBatchMaxStrokes,
				DEFAULT_BATCH_POLICY.maxStrokesPerBatch
			),
			maxPointsPerBatch: toNumber(
				source?.googleImeBatchMaxPoints,
				DEFAULT_BATCH_POLICY.maxPointsPerBatch
			),
			boundaryTimeGapMs: toNumber(
				source?.googleImeBatchBoundaryTimeGapMs,
				DEFAULT_BATCH_POLICY.boundaryTimeGapMs
			),
			idleFlushMs: toNumber(source?.googleImeBatchIdleFlushMs, DEFAULT_BATCH_POLICY.idleFlushMs),
			hardMaxBatchAgeMs: toNumber(
				source?.googleImeBatchHardMaxAgeMs,
				DEFAULT_BATCH_POLICY.hardMaxBatchAgeMs
			),
		}
	}, [userSettings.handwritingRecognition])

	const recognizerEngine = React.useMemo(() => {
		const preferred = userSettings.handwritingRecognition?.backend ?? 'auto'
		if (preferred === 'google-ime-js') return 'google-ime-js'
		if (preferred === 'onnx-web') return 'onnx-web'
		return isOnlineHtrModelConfigReady(onnxModelConfig) ? 'onnx-web' : 'stub'
	}, [onnxModelConfig, userSettings.handwritingRecognition?.backend])

	const loadModelBytes = React.useCallback(
		async (modelUrl: string) => {
			const adapter = plugin.app.vault.adapter as {
				readBinary?: (path: string) => Promise<ArrayBuffer>
				getBasePath?: () => string
			}

			if (!adapter.readBinary) return undefined

			const normalized = modelUrl.replace(/^file:\/\//, '')
			if (/^https?:\/\//.test(normalized)) return undefined

			const decodedPath = decodeURI(normalized)
			const basePath = adapter.getBasePath?.()
			if (basePath && decodedPath.startsWith('/') && !decodedPath.startsWith(basePath)) {
				throw new Error(
					`Model path is outside the active vault. Move the ONNX model under the vault root (${basePath}) and configure modelUrl as a vault-relative path, or use an https URL.`
				)
			}
			const candidatePaths = new Set<string>()

			candidatePaths.add(decodedPath)
			candidatePaths.add(decodedPath.replace(/^\//, ''))

			if (basePath && decodedPath.startsWith(basePath)) {
				candidatePaths.add(decodedPath.slice(basePath.length).replace(/^\//, ''))
			}

			const failures: string[] = []
			for (const candidatePath of candidatePaths) {
				if (!candidatePath) continue
				try {
					const bytes = await adapter.readBinary(candidatePath)
					return new Uint8Array(bytes)
				} catch (error) {
					failures.push(
						`${candidatePath} -> ${error instanceof Error ? error.message : String(error)}`
					)
				}
			}

			throw new Error(
				`Unable to load model via Obsidian adapter. Tried: ${failures.join(' | ')}`
			)
		},
		[plugin.app.vault.adapter]
	)

	React.useEffect(() => {
		const previousRecognizer = recognizerRef.current
		recognizerRef.current = createHandwritingRecognizer({
			engine: recognizerEngine,
			onnxModelConfig,
			googleImeConfig,
			loadModelBytes,
		})
		recognitionRunVersionRef.current += 1

		if (userSettings.debugMode && userSettings.debugLogs?.recognitionEngine) {
			console.log('[handwriting] recognizer engine selected', {
				documentId: handwritingDocumentId,
				backendPreference: userSettings.handwritingRecognition?.backend ?? 'auto',
				engine: recognizerEngine,
				hasModelUrl: onnxModelConfig.modelUrl.length > 0,
				hasAlphabet: onnxModelConfig.alphabet.length > 0,
				googleImeLanguage: googleImeConfig.language,
			})
		}

		void previousRecognizer.dispose()
	}, [
		handwritingDocumentId,
		googleImeConfig,
		loadModelBytes,
		onnxModelConfig,
		recognizerEngine,
		userSettings.debugMode,
		userSettings.handwritingRecognition?.backend,
	])

	const buildGroupFingerprint = React.useCallback((group: StrokeGroupCandidate) => {
		return `${group.startedAt}:${group.endedAt}:${group.shapeIds.join(',')}`
	}, [])

	const buildManualMergedCandidate = React.useCallback(
		(payloads: ReturnType<typeof getAllNormalizedStrokePayloads>): StrokeGroupCandidate[] => {
			if (payloads.length === 0) return []

			const sortedPayloads = [...payloads].sort((a, b) => a.timestamp - b.timestamp)
			const mergedBounds = sortedPayloads.reduce((acc, payload) => {
				const b = payload.worldBounds
				if (!acc) {
					return {
						minX: b.minX,
						minY: b.minY,
						maxX: b.maxX,
						maxY: b.maxY,
					}
				}
				return {
					minX: Math.min(acc.minX, b.minX),
					minY: Math.min(acc.minY, b.minY),
					maxX: Math.max(acc.maxX, b.maxX),
					maxY: Math.max(acc.maxY, b.maxY),
				}
			}, null as { minX: number; minY: number; maxX: number; maxY: number } | null)

			if (!mergedBounds) return []

			return [
				{
					id: `manual-group-${handwritingDocumentId}`,
					shapeIds: sortedPayloads.map((payload) => payload.shapeId),
					payloads: sortedPayloads,
					boundingBox: {
						...mergedBounds,
						width: mergedBounds.maxX - mergedBounds.minX,
						height: mergedBounds.maxY - mergedBounds.minY,
					},
					startedAt: sortedPayloads[0].timestamp,
					endedAt: sortedPayloads[sortedPayloads.length - 1].timestamp,
				},
			]
		},
		[handwritingDocumentId]
	)

	const buildRecognitionCandidates = React.useCallback(
		(payloads: ReturnType<typeof getAllNormalizedStrokePayloads>) => {
			const manualMode = !!userSettings.handwritingRecognition?.manualPredictButton
			const groupedCandidates = manualMode
				? buildManualMergedCandidate(payloads)
				: userSettings.handwritingRecognition?.singleShapeMode
					? groupNormalizedStrokePayloads(payloads, {
							maxTimeDeltaMs: 0,
							maxHorizontalGapPx: 0,
							maxVerticalCenterDistancePx: 0,
					  })
					: groupNormalizedStrokePayloads(payloads, {
							maxTimeDeltaMs: strokeGroupingMaxTimeDeltaMs,
							adaptiveGapMultiplier: strokeGroupingAdaptiveGapMultiplier,
					  })

			const autoGoogleMode = !manualMode && recognizerEngine === 'google-ime-js'
			const recognitionCandidates = autoGoogleMode
				? buildBatchedStrokeCandidates(
						groupedCandidates,
						googleBatchPolicy,
						`google-batch-${handwritingDocumentId}`
				  )
				: groupedCandidates

			return {
				manualMode,
				autoGoogleMode,
				groupedCandidates,
				recognitionCandidates,
			}
		},
		[
			buildManualMergedCandidate,
			googleBatchPolicy,
			handwritingDocumentId,
			recognizerEngine,
			strokeGroupingMaxTimeDeltaMs,
			strokeGroupingAdaptiveGapMultiplier,
			userSettings.handwritingRecognition?.manualPredictButton,
			userSettings.handwritingRecognition?.singleShapeMode,
		]
	)

	const scheduleRecognition = React.useCallback(
		(
			candidates: StrokeGroupCandidate[],
			options: {
				immediate?: boolean
			} = {}
		) => {
			if (recognitionDebounceTimerRef.current) {
				clearTimeout(recognitionDebounceTimerRef.current)
			}

			recognitionDebounceTimerRef.current = setTimeout(() => {
				const runVersion = ++recognitionRunVersionRef.current
				const runStartedAt = Date.now()
				const holdoffMs = options.immediate ? 0 : autoRecognitionHoldoffMs

				void (async () => {
					let recognizedCount = 0
					let deferredCount = 0
					let minRemainingHoldoffMs = Number.POSITIVE_INFINITY

					for (const candidate of candidates) {
						if (holdoffMs > 0) {
							const ageMs = Date.now() - candidate.endedAt
							if (ageMs < holdoffMs) {
								deferredCount += 1
								minRemainingHoldoffMs = Math.min(minRemainingHoldoffMs, holdoffMs - ageMs)
								continue
							}
						}

						const debugPreparedSample = userSettings.debugMode
							? preprocessGroupForOnlineHtr(candidate)
							: null

						const fingerprint = buildGroupFingerprint(candidate)
						const existing = getRecognitionResult(handwritingDocumentId, candidate.id)
						const existingByFingerprint = getRecognitionResultByFingerprint(
							handwritingDocumentId,
							fingerprint
						)
						const nowMs = Date.now()
						const matchedResult =
							existing?.fingerprint === fingerprint ? existing : existingByFingerprint
						const isFreshPending =
							matchedResult?.status === 'pending' && nowMs - matchedResult.updatedAt < 15_000
						if (
							matchedResult?.status === 'success' ||
							matchedResult?.status === 'error' ||
							isFreshPending
						) {
							continue
						}

						upsertRecognitionResult(handwritingDocumentId, {
							groupId: candidate.id,
							shapeIds: candidate.shapeIds,
							boundingBox: candidate.boundingBox,
							fingerprint,
							status: 'pending',
							updatedAt: Date.now(),
							candidates: [],
						})
						setOverlayRenderTick((tick) => tick + 1)

						try {
							const recognitionCandidates = await recognizerRef.current.recognize(candidate)
							if (runVersion !== recognitionRunVersionRef.current) {
								if (userSettings.debugMode && userSettings.debugLogs?.recognitionEvents) {
									console.log('[handwriting] stale recognition result skipped', {
										documentId: handwritingDocumentId,
										groupId: candidate.id,
									})
								}
								return
							}

							upsertRecognitionResult(handwritingDocumentId, {
								groupId: candidate.id,
								shapeIds: candidate.shapeIds,
								boundingBox: candidate.boundingBox,
								fingerprint,
								status: 'success',
								updatedAt: Date.now(),
								candidates: recognitionCandidates,
							})
							setOverlayRenderTick((tick) => tick + 1)

							if (userSettings.debugMode && userSettings.debugLogs?.recognitionEvents) {
								console.log('[handwriting] recognition success', {
									documentId: handwritingDocumentId,
									groupId: candidate.id,
									bestText: recognitionCandidates[0]?.text ?? '',
									bestConfidence: recognitionCandidates[0]?.confidence ?? 0,
									candidateCount: recognitionCandidates.length,
								})

								if (debugPreparedSample) {
									console.log('[handwriting] recognition parity sample', {
										documentId: handwritingDocumentId,
										groupId: candidate.id,
										shapeIds: candidate.shapeIds,
										prediction: recognitionCandidates[0]?.text ?? '',
										confidence: recognitionCandidates[0]?.confidence ?? 0,
										timeSteps: debugPreparedSample.timeSteps,
										channels: debugPreparedSample.channels,
										ink: Array.from(debugPreparedSample.ink),
									})
								}
							}
							recognizedCount += 1
						} catch (error) {
							if (userSettings.debugMode && userSettings.debugLogs?.recognitionEvents) {
								console.error('[handwriting] recognition failed', {
									documentId: handwritingDocumentId,
									groupId: candidate.id,
									error: error instanceof Error ? error.message : String(error),
								})
							}

							upsertRecognitionResult(handwritingDocumentId, {
								groupId: candidate.id,
								shapeIds: candidate.shapeIds,
								boundingBox: candidate.boundingBox,
								fingerprint,
								status: 'error',
								updatedAt: Date.now(),
								candidates: [],
								error: error instanceof Error ? error.message : String(error),
							})
							setOverlayRenderTick((tick) => tick + 1)
						}
					}

					if (userSettings.debugMode && userSettings.debugLogs?.recognitionEvents) {
						const recognizedPreview = getDocumentRecognitionResults(handwritingDocumentId)
							.filter((result) => result.status === 'success')
							.map((result) => ({
								groupId: result.groupId,
								text: result.candidates[0]?.text ?? '',
								confidence: result.candidates[0]?.confidence ?? 0,
							}))

						console.log('[handwriting] recognition run complete', {
							documentId: handwritingDocumentId,
							queuedCandidates: candidates.length,
							recognizedCandidates: recognizedCount,
							deferredCandidates: deferredCount,
							totalStoredResults: getDocumentRecognitionResults(handwritingDocumentId).length,
							latencyMs: Date.now() - runStartedAt,
							recognizedPreview,
						})
					}

					if (
						deferredCount > 0 &&
						runVersion === recognitionRunVersionRef.current &&
						Number.isFinite(minRemainingHoldoffMs)
					) {
						const retryDelayMs = Math.max(100, Math.floor(minRemainingHoldoffMs))
						recognitionDebounceTimerRef.current = setTimeout(() => {
							scheduleRecognition(candidates, options)
						}, retryDelayMs)

						if (userSettings.debugMode && userSettings.debugLogs?.recognitionEvents) {
							console.log('[handwriting] recognition deferred for fresh groups', {
								documentId: handwritingDocumentId,
								deferredCandidates: deferredCount,
								retryDelayMs,
								holdoffMs,
							})
						}
					}
				})()
			}, recognitionDebounceMs)
		},
		[
			autoRecognitionHoldoffMs,
			buildGroupFingerprint,
			handwritingDocumentId,
			recognitionDebounceMs,
			userSettings.debugMode,
		]
	)

	React.useEffect(() => {
		if (!editor) return
		if (bootstrappedRecognitionByDocumentRef.current.has(handwritingDocumentId)) return

		const currentDrawShapes = editor
			.getCurrentPageShapes()
			.filter(
				(shape): shape is CompletedDrawShape =>
					shape.type === 'draw' &&
					(shape as { props?: { isComplete?: boolean } }).props?.isComplete === true
			)

		const drawShapeIds = new Set(currentDrawShapes.map((shape) => shape.id))
		const existingPayloads = getAllNormalizedStrokePayloads(handwritingDocumentId)
		for (const payload of existingPayloads) {
			if (!drawShapeIds.has(payload.shapeId)) {
				removeNormalizedStrokePayload(handwritingDocumentId, payload.shapeId)
			}
		}

		for (const result of getDocumentRecognitionResults(handwritingDocumentId)) {
			const hasMissingShape = result.shapeIds.some((shapeId) => !drawShapeIds.has(shapeId))
			if (hasMissingShape) {
				removeRecognitionResult(handwritingDocumentId, result.groupId)
			}
		}

		let regeneratedPayloads = 0
		for (const shape of currentDrawShapes) {
			if (getNormalizedStrokePayload(handwritingDocumentId, shape.id)) continue
			const strokes = extractStroke(shape)
			if (strokes.length === 0) continue

			const payload = processExtractedStroke({
				shapeId: shape.id,
				shape,
				strokes,
			})
			if (!payload) continue

			upsertNormalizedStrokePayload(handwritingDocumentId, payload)
			regeneratedPayloads += 1
		}

		const payloads = getAllNormalizedStrokePayloads(handwritingDocumentId)
		const attemptedShapeIds = new Set(
			getDocumentRecognitionResults(handwritingDocumentId)
				.filter((result) => result.status === 'success' || result.status === 'error' || result.status === 'pending')
				.flatMap((result) => result.shapeIds)
		)
		const unattemptedPayloads = payloads.filter((payload) => !attemptedShapeIds.has(payload.shapeId))
		const spatialGroups = groupNormalizedStrokePayloadsBySpatialProximity(unattemptedPayloads)
		const autoGoogleMode =
			!userSettings.handwritingRecognition?.manualPredictButton && recognizerEngine === 'google-ime-js'
		const backfillCandidates = autoGoogleMode
			? buildBatchedStrokeCandidates(
					spatialGroups,
					googleBatchPolicy,
					`google-backfill-${handwritingDocumentId}`
			  )
			: spatialGroups

		setDocumentWordCandidates(handwritingDocumentId, backfillCandidates)
		scheduleRecognition(backfillCandidates, { immediate: true })
		setOverlayRenderTick((tick) => tick + 1)
		bootstrappedRecognitionByDocumentRef.current.add(handwritingDocumentId)

		if (userSettings.debugMode) {
			console.log('[handwriting] reload backfill complete', {
				documentId: handwritingDocumentId,
				drawShapes: currentDrawShapes.length,
				payloadsHydrated: payloads.length,
				unattemptedPayloads: unattemptedPayloads.length,
				payloadsRegenerated: regeneratedPayloads,
				spatialGroups: spatialGroups.length,
				backfillCandidates: backfillCandidates.length,
				autoGoogleMode,
			})
		}
	}, [
		editor,
		googleBatchPolicy,
		handwritingDocumentId,
		recognizerEngine,
		scheduleRecognition,
		userSettings.debugMode,
		userSettings.handwritingRecognition?.manualPredictButton,
	])

	React.useEffect(() => {
		if (!editor) return
		if (!showRecognizedBatchTextOverlay && !isSearchPanelOpen && !activeSearchGroupId) return

		const intervalId = setInterval(() => {
			setOverlayRenderTick((tick) => tick + 1)
		}, 250)

		return () => clearInterval(intervalId)
	}, [activeSearchGroupId, editor, isSearchPanelOpen, showRecognizedBatchTextOverlay])

	React.useEffect(() => {
		if (!editor) return

		type PointerPointLike = {
			x?: number
			y?: number
			z?: number
		}

		type PointerInfoLike = {
			point?: PointerPointLike
		}

		type PencilDrawingStateLike = {
			onEnter?: (info: PointerInfoLike) => void
			updateDrawingShape?: () => void
			onPointerUp?: () => void
			onExit?: () => void
			initialShape?: {
				id: string
				type: 'draw'
				props?: {
					scale?: number
				}
			}
		}

		const drawingState = editor.getStateDescendant<PencilDrawingStateLike>('pencil.drawing')
		if (!drawingState || typeof drawingState.updateDrawingShape !== 'function') return

		const textureEnabled = userSettings.handwritingRecognition?.pencilTextureEnabled ?? true
		const textureIntensity = userSettings.handwritingRecognition?.pencilTextureIntensity ?? 0.35

		const originalOnEnter = drawingState.onEnter?.bind(drawingState)
		const originalUpdateDrawingShape = drawingState.updateDrawingShape.bind(drawingState)
		const originalOnPointerUp = drawingState.onPointerUp?.bind(drawingState)
		const originalOnExit = drawingState.onExit?.bind(drawingState)

		const scrubState = {
			active: false,
			suppressDrawingStart: false,
			cancelCurrentStrokeOnExit: false,
			anchorX: 0,
			startBrushPx: clampBrushPx(
				userSettings.handwritingRecognition?.pencilBrushSizePx ?? DEFAULT_PENCIL_BRUSH_PX
			),
			brushPx: clampBrushPx(
				userSettings.handwritingRecognition?.pencilBrushSizePx ?? DEFAULT_PENCIL_BRUSH_PX
			),
		}

		const persistBrushPx = (brushPx: number) => {
			const clamped = clampBrushPx(brushPx)
			plugin.settingsManager.settings.handwritingRecognition = {
				...(plugin.settingsManager.settings.handwritingRecognition ?? {}),
				pencilBrushSizePx: clamped,
			}
			void plugin.settingsManager.updateSettings(plugin.settingsManager.settings)
		}

		const maybeFinishScrub = () => {
			if (!scrubState.active) return
			scrubState.active = false
			scrubState.suppressDrawingStart = false
			suppressScrubArtifactUntilRef.current = Date.now() + 300
			setPencilScrubHud((prev) => ({ ...prev, active: false }))
			persistBrushPx(scrubState.brushPx)
		}

		const applyActiveBrushScale = () => {
			const brushPx = scrubState.active
				? scrubState.brushPx
				: clampBrushPx(userSettings.handwritingRecognition?.pencilBrushSizePx ?? DEFAULT_PENCIL_BRUSH_PX)
			const scale = getPencilBrushScale(editor, brushPx)
			const activeShape = drawingState.initialShape
			if (activeShape?.id && activeShape.type === 'draw') {
				editor.updateShapes([
					{
						id: activeShape.id,
						type: 'draw',
						props: {
							...activeShape.props,
							scale,
						},
					},
				])
			}
		}

		drawingState.onEnter = (info: PointerInfoLike) => {
			if (!originalOnEnter) return
			const point = info?.point
			if (!point || typeof point.z !== 'number') {
				originalOnEnter(info)
				const activeShapeId = drawingState.initialShape?.id
				if (activeShapeId && drawingState.initialShape?.type === 'draw') {
					const rawPressure = clampUnit(typeof point?.z === 'number' ? point.z : 0)
					pressureStore.createPendingSession(activeShapeId, {
						x: typeof point?.x === 'number' ? point.x : 0,
						y: typeof point?.y === 'number' ? point.y : 0,
						pressure: rawPressure,
						velocityMagnitude: 0,
					})
					editor.updateShapes([
						{
							id: activeShapeId,
							type: 'draw',
							props: {
								...drawingState.initialShape.props,
								isPen: false,
							},
						},
					])
				}
				applyActiveBrushScale()
				return
			}

			const isStylusContact = point.z > 0
			if (editor.inputs.altKey && isStylusContact) {
				scrubState.active = true
				scrubState.suppressDrawingStart = true
				scrubState.anchorX = typeof point.x === 'number' ? point.x : 0
				scrubState.startBrushPx = scrubState.brushPx
				if (userSettings.debugMode) {
					console.log('[pencil-scrub] onEnter alt+stylus', {
						documentId: handwritingDocumentId,
						x: point.x,
						y: point.y,
						pressure: point.z,
					})
				}
				return
			}

			const adjustedInfo: PointerInfoLike = {
				...info,
				point: {
					...point,
					z: applyPencilTexturePressure(
						point.z,
						pressureSensitivity,
						textureEnabled,
						textureIntensity,
						typeof point.x === 'number' ? point.x : 0,
						typeof point.y === 'number' ? point.y : 0
					),
				},
			}
			originalOnEnter(adjustedInfo)
			const activeShapeId = drawingState.initialShape?.id
			if (activeShapeId && drawingState.initialShape?.type === 'draw') {
				pressureStore.createPendingSession(activeShapeId, {
					x: typeof point.x === 'number' ? point.x : 0,
					y: typeof point.y === 'number' ? point.y : 0,
					pressure: typeof point.z === 'number' ? point.z : 0,
					velocityMagnitude: 0,
				})
				editor.updateShapes([
					{
						id: activeShapeId,
						type: 'draw',
						props: {
							...drawingState.initialShape.props,
							isPen: false,
						},
					},
				])
			}
			applyActiveBrushScale()
		}

		drawingState.updateDrawingShape = () => {
			const currentPoint = editor.inputs.currentPagePoint as { x: number; y: number; z?: number }
			const isStylusContact = typeof currentPoint?.z === 'number' && currentPoint.z > 0
			const point = editor.inputs.currentPagePoint as { x?: number; y?: number; z?: number }

			const wasActive = scrubState.active
			if (editor.inputs.altKey && isStylusContact) {
				if (!scrubState.active) {
					scrubState.active = true
					scrubState.suppressDrawingStart = !drawingState.initialShape?.id
					scrubState.anchorX = currentPoint.x
					scrubState.startBrushPx = scrubState.brushPx
					if (userSettings.debugMode) {
						console.log('[pencil-scrub] begin scrub', {
							documentId: handwritingDocumentId,
							shapeId: drawingState.initialShape?.id,
							x: currentPoint.x,
							y: currentPoint.y,
							brushPx: scrubState.brushPx,
						})
					}
				}

				const activeShapeId = drawingState.initialShape?.id
				if (activeShapeId && drawingState.initialShape?.type === 'draw') {
					const rawPressure = clampUnit(typeof currentPoint.z === 'number' ? currentPoint.z : 0)
					pressureStore.createPendingSession(activeShapeId, {
						x: currentPoint.x,
						y: currentPoint.y,
						pressure: rawPressure,
						velocityMagnitude: 0,
					})
					editor.updateShapes([
						{
							id: activeShapeId,
							type: 'draw',
							props: {
								...drawingState.initialShape.props,
								isPen: false,
							},
						},
					])
				}

				const dx = currentPoint.x - scrubState.anchorX
				scrubState.brushPx = clampBrushPx(
					scrubState.startBrushPx + dx * PENCIL_SCRUB_PX_PER_SCREEN_PIXEL
				)
				const scrubHudPoint = editor.pageToViewport({ x: currentPoint.x, y: currentPoint.y })
				setPencilScrubHud({
					active: true,
					left: scrubHudPoint.x,
					top: scrubHudPoint.y,
					brushPx: scrubState.brushPx,
				})
				applyActiveBrushScale()

				if (scrubState.suppressDrawingStart) {
					return
				}

				if (point && typeof point.z === 'number') {
					const originalZDuringScrub = point.z
					point.z = 0
					try {
						originalUpdateDrawingShape()
					} finally {
						point.z = originalZDuringScrub
					}
					return
				}

				return
			}

			if (wasActive) {
				scrubState.cancelCurrentStrokeOnExit = true
				if (userSettings.debugMode) {
					console.log('[pencil-scrub] leaving scrub state', {
						documentId: handwritingDocumentId,
						shapeId: drawingState.initialShape?.id,
						isStylusContact,
						altKey: editor.inputs.altKey,
					})
				}
			}

			maybeFinishScrub()

			if (wasActive) {
				const activeShapeId = drawingState.initialShape?.id
				if (activeShapeId) {
					scrubCanceledShapeIdsRef.current.add(activeShapeId)
				}
			}

			if (scrubState.cancelCurrentStrokeOnExit) {
				return
			}

			if (scrubState.active || wasActive !== scrubState.active) {
				applyActiveBrushScale()
			}

			if (!point || typeof point.z !== 'number') {
					const activeShapeId = drawingState.initialShape?.id
					if (activeShapeId && drawingState.initialShape?.type === 'draw') {
						pressureStore.appendPendingSessionPoint(activeShapeId, {
							x: typeof currentPoint.x === 'number' ? currentPoint.x : 0,
							y: typeof currentPoint.y === 'number' ? currentPoint.y : 0,
							pressure: 0.5,
							velocityMagnitude: 0,
						})
					}
				setPencilScrubHud((prev) => ({ ...prev, active: false }))
				originalUpdateDrawingShape()
				return
			}

			const originalX = point.x
			const originalY = point.y
			const originalZ = point.z
			const rawPressure = clampUnit(typeof point.z === 'number' ? point.z : 0)
			const adjustedPressure = applyPressureSensitivity(rawPressure, pressureSensitivity)
			const baseX = typeof point.x === 'number' ? point.x : currentPoint.x
			const baseY = typeof point.y === 'number' ? point.y : currentPoint.y
			const { dx, dy } = getPencilTextureOffset(textureEnabled, textureIntensity, baseX, baseY)
			point.x = baseX + dx
			point.y = baseY + dy
			point.z = adjustedPressure
			try {
				originalUpdateDrawingShape()
				const activeShapeId = drawingState.initialShape?.id
				if (activeShapeId && !scrubState.active) {
					pressureStore.appendPendingSessionPoint(activeShapeId, {
						x: baseX,
						y: baseY,
						pressure: rawPressure,
						velocityMagnitude: Math.hypot(baseX - originalX, baseY - originalY),
					})
				}
			} finally {
				point.x = originalX
				point.y = originalY
				point.z = originalZ
			}
		}

		drawingState.onPointerUp = () => {
			if (scrubState.active || scrubState.cancelCurrentStrokeOnExit) {
				const activeShapeId = drawingState.initialShape?.id
				if (userSettings.debugMode) {
					console.log('[pencil-scrub] onPointerUp cancel', {
						documentId: handwritingDocumentId,
						active: scrubState.active,
						cancelCurrentStrokeOnExit: scrubState.cancelCurrentStrokeOnExit,
						activeShapeId,
					})
				}
				if (activeShapeId) {
					scrubCanceledShapeIdsRef.current.add(activeShapeId)
					suppressScrubArtifactUntilRef.current = Date.now() + 500
					pressureStore.cancelPendingSession(activeShapeId)
					if (editor.getShape(activeShapeId)) {
						editor.deleteShapes([activeShapeId])
					}
				}
				scrubState.cancelCurrentStrokeOnExit = false
				maybeFinishScrub()
				setPencilScrubHud((prev) => ({ ...prev, active: false }))
				drawingState.parent.transition('idle')
				return
			}

			originalOnPointerUp?.()
		}

		drawingState.onExit = () => {
			const activeShapeId = drawingState.initialShape?.id
			if (userSettings.debugMode) {
				console.log('[pencil-scrub] onExit', {
					documentId: handwritingDocumentId,
					cancelCurrentStrokeOnExit: scrubState.cancelCurrentStrokeOnExit,
					activeShapeId,
				})
			}
			if (scrubState.cancelCurrentStrokeOnExit && activeShapeId) {
				scrubCanceledShapeIdsRef.current.add(activeShapeId)
				suppressScrubArtifactUntilRef.current = Date.now() + 500
				pressureStore.cancelPendingSession(activeShapeId)
				if (editor.getShape(activeShapeId)) {
					editor.deleteShapes([activeShapeId])
				}
			}
			scrubState.cancelCurrentStrokeOnExit = false
			maybeFinishScrub()
			if (activeShapeId) {
				pressureStore.endPendingSession(activeShapeId)
			}
			setPencilScrubHud((prev) => ({ ...prev, active: false }))
			originalOnExit?.()
		}

		return () => {
			maybeFinishScrub()
			setPencilScrubHud((prev) => ({ ...prev, active: false }))
			if (originalOnEnter) {
				drawingState.onEnter = originalOnEnter
			}
			drawingState.updateDrawingShape = originalUpdateDrawingShape
			drawingState.onPointerUp = originalOnPointerUp
			drawingState.onExit = originalOnExit
				shapeUtils={shapeUtils}
		}
	}, [
		editor,
		plugin.settingsManager,
		pressureSensitivity,
		userSettings.handwritingRecognition?.pencilBrushSizePx,
		userSettings.handwritingRecognition?.pencilTextureEnabled,
		userSettings.handwritingRecognition?.pencilTextureIntensity,
	])

	const searchableRecognitionResults = React.useMemo<SearchPanelResult[]>(() => {
		const results = getDocumentRecognitionResults(handwritingDocumentId)
			.filter((result) => result.status === 'success')
			.map((result) => {
				const text = result.candidates[0]?.text?.trim() ?? ''
				if (!text) return null

				return {
					groupId: result.groupId,
					text,
					confidence: result.candidates[0]?.confidence ?? 0,
					boundingBox: result.boundingBox,
				}
			})
			.filter((result): result is NonNullable<typeof result> => result !== null)

		// Keep navigation order deterministic for repeated terms: top-to-bottom, left-to-right.
		results.sort((a, b) => {
			if (a.boundingBox.minY !== b.boundingBox.minY) {
				return a.boundingBox.minY - b.boundingBox.minY
			}
			if (a.boundingBox.minX !== b.boundingBox.minX) {
				return a.boundingBox.minX - b.boundingBox.minX
			}
			return a.groupId.localeCompare(b.groupId)
		})

		return results
	}, [handwritingDocumentId, overlayRenderTick])

	const searchIndex = React.useMemo(() => {
		return new Fuse(searchableRecognitionResults, {
			keys: ['text'],
			threshold: 0.35,
			ignoreLocation: true,
			minMatchCharLength: 1,
		})
	}, [searchableRecognitionResults])

	const filteredSearchResults = React.useMemo(() => {
		const query = searchQuery.trim()
		if (!query) return searchableRecognitionResults
		return searchIndex.search(query).map((match) => match.item)
	}, [searchIndex, searchQuery, searchableRecognitionResults])

	const filteredSearchResultItems = React.useMemo(() => {
		const countsByText = new Map<string, number>()
		for (const result of filteredSearchResults) {
			const key = result.text.trim().toLocaleLowerCase()
			countsByText.set(key, (countsByText.get(key) ?? 0) + 1)
		}

		const seenByText = new Map<string, number>()
		return filteredSearchResults.map((result) => {
			const key = result.text.trim().toLocaleLowerCase()
			const duplicateCount = countsByText.get(key) ?? 1
			const duplicateOrdinal = (seenByText.get(key) ?? 0) + 1
			seenByText.set(key, duplicateOrdinal)

			return {
				result,
				duplicateCount,
				duplicateOrdinal,
			}
		})
	}, [filteredSearchResults])

	const activeSearchResult = React.useMemo(() => {
		if (!activeSearchGroupId) return undefined
		return searchableRecognitionResults.find((result) => result.groupId === activeSearchGroupId)
	}, [activeSearchGroupId, searchableRecognitionResults])

	const activeSearchHighlightBox = React.useMemo(() => {
		if (!editor || !activeSearchResult) return null
		const { minX, minY, maxX, maxY } = activeSearchResult.boundingBox
		const topLeft = editor.pageToViewport({ x: minX, y: minY })
		const bottomRight = editor.pageToViewport({ x: maxX, y: maxY })
		const left = Math.min(topLeft.x, bottomRight.x)
		const top = Math.min(topLeft.y, bottomRight.y)
		const width = Math.abs(bottomRight.x - topLeft.x)
		const height = Math.abs(bottomRight.y - topLeft.y)

		return {
			left,
			top,
			width,
			height,
		}
	}, [activeSearchResult, editor, overlayRenderTick])

	const selectSearchResult = React.useCallback(
		(
			result: SearchPanelResult | undefined,
			options?: {
				forceRefocus?: boolean
			}
		) => {
			if (!result) return
			const forceRefocus = options?.forceRefocus === true
			if (activeSearchGroupId === result.groupId && !forceRefocus) {
				if (userSettings.debugMode) {
					console.log('[handwriting-search] skipping refocus for already active result', {
						documentId: handwritingDocumentId,
						groupId: result.groupId,
					})
				}
				return
			}
			if (activeSearchGroupId !== result.groupId) {
				setActiveSearchGroupId(result.groupId)
			}
			setOverlayRenderTick((tick) => tick + 1)

			if (!editor) return

			const { minX, minY, maxX, maxY, width, height } = result.boundingBox
			if (
				![minX, minY, maxX, maxY, width, height].every((value) => Number.isFinite(value))
			) {
				if (userSettings.debugMode) {
					console.log('[handwriting-search] zoom skipped due to invalid bounds', {
						documentId: handwritingDocumentId,
						groupId: result.groupId,
						boundingBox: result.boundingBox,
					})
				}
				return
			}

			const centerX = (minX + maxX) / 2
			const centerY = (minY + maxY) / 2
			const targetWidth = Math.max(width, searchZoomMinSize)
			const targetHeight = Math.max(height, searchZoomMinSize)

			const focusBounds = {
				x: centerX - targetWidth / 2 - SEARCH_FOCUS_PADDING,
				y: centerY - targetHeight / 2 - SEARCH_FOCUS_PADDING,
				w: targetWidth + SEARCH_FOCUS_PADDING * 2,
				h: targetHeight + SEARCH_FOCUS_PADDING * 2,
			}

			if (userSettings.debugMode) {
				console.log('[handwriting-search] zooming to selected result', {
					documentId: handwritingDocumentId,
					groupId: result.groupId,
					forceRefocus,
					focusBounds,
				})
			}

			editor.zoomToBounds(focusBounds)
		},
		[
			activeSearchGroupId,
			editor,
			handwritingDocumentId,
			searchZoomMinSize,
			userSettings.debugMode,
		]
	)

	const moveSearchSelection = React.useCallback(
		(direction: 1 | -1) => {
			if (filteredSearchResults.length === 0) return

			setSelectedSearchResultIndex((current) => {
				if (current < 0) return direction > 0 ? 0 : filteredSearchResults.length - 1
				return (current + direction + filteredSearchResults.length) % filteredSearchResults.length
			})
		},
		[filteredSearchResults.length]
	)

	React.useEffect(() => {
		const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase()
		const hasQueryChanged = previousNormalizedSearchQueryRef.current !== normalizedSearchQuery
		previousNormalizedSearchQueryRef.current = normalizedSearchQuery

		if (filteredSearchResults.length === 0) {
			setSelectedSearchResultIndex(-1)
			return
		}

		if (hasQueryChanged) {
			setSelectedSearchResultIndex(0)
			return
		}

		setSelectedSearchResultIndex((current) => {
			if (current < 0) return 0
			return Math.min(current, filteredSearchResults.length - 1)
		})
	}, [filteredSearchResults.length, searchQuery])

	React.useEffect(() => {
		if (!activeSearchGroupId) return
		const stillExists = searchableRecognitionResults.some(
			(result) => result.groupId === activeSearchGroupId
		)
		if (!stillExists) {
			setActiveSearchGroupId(undefined)
		}
	}, [activeSearchGroupId, searchableRecognitionResults])

	React.useEffect(() => {
		if (!isSearchPanelOpen) return
		searchInputRef.current?.focus()
		searchInputRef.current?.select()

		if (userSettings.debugMode) {
			console.log('[handwriting-search] panel opened', {
				documentId: handwritingDocumentId,
			})
		}
	}, [isSearchPanelOpen])

	React.useEffect(() => {
		if (!isSearchPanelOpen) return
		if (selectedSearchResultIndex < 0) return

		const selectedResult = filteredSearchResults[selectedSearchResultIndex]
		if (!selectedResult) return

		selectSearchResult(selectedResult)

		const selectedResultButton = searchResultsRef.current?.querySelector<HTMLElement>(
			`[data-search-result-index="${selectedSearchResultIndex}"]`
		)
		selectedResultButton?.scrollIntoView({ block: 'nearest' })
	}, [
		filteredSearchResults,
		isSearchPanelOpen,
		selectSearchResult,
		selectedSearchResultIndex,
	])

	const recognizedBatchTextOverlays = React.useMemo(() => {
		if (!showRecognizedBatchTextOverlay || !editor) return []

		const zoomLevel = editor.getZoomLevel()
		const results = getDocumentRecognitionResults(handwritingDocumentId)

		return results
			.filter((result) => result.status === 'success')
			.map((result) => {
				const text = result.candidates[0]?.text?.trim()
				if (!text) return null

				const viewportPoint = editor.pageToViewport({
					x: result.boundingBox.minX,
					y: result.boundingBox.minY,
				})

				return {
					id: result.groupId,
					text,
					left: viewportPoint.x,
					top: viewportPoint.y,
					maxWidth: Math.max(120, result.boundingBox.width * zoomLevel),
				}
			})
			.filter((overlay): overlay is NonNullable<typeof overlay> => overlay !== null)
	}, [editor, handwritingDocumentId, overlayRenderTick, showRecognizedBatchTextOverlay])

	const triggerManualRecognition = React.useCallback(() => {
		const groupedCandidates = getDocumentWordCandidates(handwritingDocumentId)
		if (groupedCandidates.length === 0) {
			if (userSettings.debugMode) {
				console.log('[handwriting] manual recognition skipped: no grouped candidates', {
					documentId: handwritingDocumentId,
				})
			}
			return
		}

		scheduleRecognition(groupedCandidates, { immediate: true })
	}, [handwritingDocumentId, scheduleRecognition, userSettings.debugMode])

	const setSelectedShapesOpacityToHalf = React.useCallback(() => {
		if (!editor) return

		const selectedShapeIds = Array.from(editor.getSelectedShapeIds())
		if (selectedShapeIds.length === 0) {
			new Notice('Select at least one shape to set opacity to 50%.')
			return
		}

		const updates = selectedShapeIds
			.map((shapeId) => {
				const shape = editor.getShape(shapeId)
				if (!shape) return null
				return {
					id: shape.id,
					type: shape.type,
					opacity: 0.5,
				}
			})
			.filter((update): update is NonNullable<typeof update> => update !== null)

		if (updates.length === 0) {
			new Notice('Could not resolve selected shapes for opacity update.')
			return
		}

		editor.updateShapes(updates as never)
		new Notice(`Set opacity to 50% for ${updates.length} shape(s).`)

		if (userSettings.debugMode) {
			console.log('[debug-opacity] applied 50% opacity', {
				documentId: handwritingDocumentId,
				shapeIds: updates.map((update) => update.id),
				updatedCount: updates.length,
			})
		}
	}, [editor, handwritingDocumentId, userSettings.debugMode])

	const onStrokeExtracted = React.useCallback(
		(result: StrokeExtractionResult) => {
			if (scrubCanceledShapeIdsRef.current.has(result.shapeId)) {
				scrubCanceledShapeIdsRef.current.delete(result.shapeId)
				pressureStore.removePressureData(result.shapeId)
				if (userSettings.debugMode) {
					console.log('[pencil] ignored stroke after Alt-release scrub cancel', {
						documentId: handwritingDocumentId,
						shapeId: result.shapeId,
						totalPoints: result.strokes.reduce((count, segment) => count + segment.length, 0),
					})
				}
				return
			}

			const totalPoints = result.strokes.reduce((count, segment) => count + segment.length, 0)
			let minX = Number.POSITIVE_INFINITY
			let minY = Number.POSITIVE_INFINITY
			let maxX = Number.NEGATIVE_INFINITY
			let maxY = Number.NEGATIVE_INFINITY
			let polylineLength = 0

			for (const segment of result.strokes) {
				for (let i = 0; i < segment.length; i++) {
					const point = segment[i]
					minX = Math.min(minX, point.x)
					minY = Math.min(minY, point.y)
					maxX = Math.max(maxX, point.x)
					maxY = Math.max(maxY, point.y)
					if (i > 0) {
						const prev = segment[i - 1]
						const dx = point.x - prev.x
						const dy = point.y - prev.y
						polylineLength += Math.sqrt(dx * dx + dy * dy)
					}
				}
			}

			const width = Number.isFinite(minX) && Number.isFinite(maxX) ? maxX - minX : 0
			const height = Number.isFinite(minY) && Number.isFinite(maxY) ? maxY - minY : 0
			const tinyStroke = totalPoints <= 3 || (width < 3 && height < 3) || polylineLength < 4

			if (Date.now() <= suppressScrubArtifactUntilRef.current && tinyStroke) {
				editor?.deleteShapes([result.shapeId])
				if (userSettings.debugMode) {
					console.log('[pencil] dropped post-scrub artifact stroke', {
						documentId: handwritingDocumentId,
						shapeId: result.shapeId,
						totalPoints,
						width,
						height,
						polylineLength,
					})
				}
				return
			}

			const rawPointsCount = result.strokes.reduce((count, segment) => count + segment.length, 0)
			let pressureData = pressureStore.consumePendingSessionForStroke(result.shapeId, rawPointsCount)
			if (!pressureData && rawPointsCount > 0) {
				const syntheticPoints = result.strokes.flatMap((segment) =>
					segment.map((point) => ({
						x: point.x,
						y: point.y,
						pressure: 0.5,
						velocityMagnitude: 0.25,
					}))
				)
				pressureData = {
					points: syntheticPoints,
					timestamp: Date.now(),
				}
				pressureStore.setPressureData(result.shapeId, pressureData)
			}

			if (userSettings.debugMode && pressureData) {
				const pressures = pressureData.points.map((point) => point.pressure)
				const mappedOpacities = pressures.map((pressure) => getPressureOpacityStyle(pressure))
				const minPressure = pressures.length ? Math.min(...pressures) : 0
				const maxPressure = pressures.length ? Math.max(...pressures) : 0
				const meanPressure = pressures.length
					? pressures.reduce((sum, pressure) => sum + pressure, 0) / pressures.length
					: 0
				const minOpacity = mappedOpacities.length ? Math.min(...mappedOpacities) : 0
				const maxOpacity = mappedOpacities.length ? Math.max(...mappedOpacities) : 0
				const meanOpacity = mappedOpacities.length
					? mappedOpacities.reduce((sum, opacity) => sum + opacity, 0) / mappedOpacities.length
					: 0
				const opacityBuckets = [0, 0, 0, 0, 0]
				for (const opacity of mappedOpacities) {
					const bucketIndex = Math.max(0, Math.min(opacityBuckets.length - 1, Math.floor(opacity * opacityBuckets.length)))
					opacityBuckets[bucketIndex] += 1
				}

				console.log('[pencil] mapped pressure session to shape', {
					documentId: handwritingDocumentId,
					shapeId: result.shapeId,
					rawPointsCount,
					pressurePointsCount: pressureData.points.length,
					pressureMin: Number(minPressure.toFixed(3)),
					pressureMax: Number(maxPressure.toFixed(3)),
					pressureMean: Number(meanPressure.toFixed(3)),
					opacityMin: Number(minOpacity.toFixed(3)),
					opacityMax: Number(maxOpacity.toFixed(3)),
					opacityMean: Number(meanOpacity.toFixed(3)),
					opacityBuckets,
					opacityBucketsCsv: opacityBuckets.join(','),
				})
			}

			if (editor && userSettings.debugMode) {
				const shape = editor.getShape(result.shapeId)
				console.log('[pencil] pressure shape ready for gradient render', {
					documentId: handwritingDocumentId,
					shapeId: result.shapeId,
					topLevelOpacity: shape?.opacity,
					pointCount: pressureData?.points.length ?? 0,
					pencilOpacitySensitivity,
				})
			}

			if (userSettings.debugMode) {
				const shape = editor.getShape(result.shapeId)
				if (shape?.type === 'draw') {
					const segmentPoints = shape.props.segments.flatMap((segment) => segment.points)
					const zValues = segmentPoints
						.map((point) => (typeof point.z === 'number' ? point.z : null))
						.filter((value): value is number => value !== null)
					const minZ = zValues.length ? Math.min(...zValues) : 0
					const maxZ = zValues.length ? Math.max(...zValues) : 0
					const meanZ = zValues.length
						? zValues.reduce((sum, value) => sum + value, 0) / zValues.length
						: 0
					const zBuckets = [0, 0, 0, 0, 0]
					for (const value of zValues) {
						const bucketIndex = Math.max(
							0,
							Math.min(zBuckets.length - 1, Math.floor(value * zBuckets.length))
						)
						zBuckets[bucketIndex] += 1
					}

					console.log('[pencil] persisted draw shape pressure stats', {
						documentId: handwritingDocumentId,
						shapeId: result.shapeId,
						topLevelOpacity: shape.opacity,
						segmentCount: shape.props.segments.length,
						pointCount: segmentPoints.length,
						zMin: Number(minZ.toFixed(3)),
						zMax: Number(maxZ.toFixed(3)),
						zMean: Number(meanZ.toFixed(3)),
						zBuckets,
						zBucketsCsv: zBuckets.join(','),
					})
				}
			}

			const payload = processExtractedStroke(result)
			if (!payload) return

			upsertNormalizedStrokePayload(handwritingDocumentId, payload)
			const payloads = getAllNormalizedStrokePayloads(handwritingDocumentId)
			const { manualMode, autoGoogleMode, groupedCandidates, recognitionCandidates } =
				buildRecognitionCandidates(payloads)

			setDocumentWordCandidates(handwritingDocumentId, recognitionCandidates)
			if (!manualMode) {
				scheduleRecognition(recognitionCandidates)
			}

			if (userSettings.debugMode) {
				console.log('[handwriting] normalized stroke payload', {
					documentId: handwritingDocumentId,
					shapeId: payload.shapeId,
					segments: payload.normalizedStrokes.length,
					totalPoints: payload.normalizedStrokes.reduce(
						(total, segment) => total + segment.length,
						0
					),
					storedPayloads: payloads.length,
					groupedCandidates: groupedCandidates.length,
					recognitionCandidates: recognitionCandidates.length,
					storedWordCandidates: getDocumentWordCandidates(handwritingDocumentId).length,
					bounds: payload.bounds,
					worldBounds: payload.worldBounds,
					scale: payload.scale,
					timestamp: payload.timestamp,
				})

				if (recognitionCandidates.length > 0) {
					const latestGroup = recognitionCandidates[recognitionCandidates.length - 1]
					console.log('[handwriting] recognition candidate', {
						documentId: handwritingDocumentId,
						groupId: latestGroup.id,
						shapeIds: latestGroup.shapeIds,
						boundingBox: latestGroup.boundingBox,
						startedAt: latestGroup.startedAt,
						endedAt: latestGroup.endedAt,
						autoGoogleMode,
					})
				}
			}
		},
		[
			editor,
			buildRecognitionCandidates,
			handwritingDocumentId,
			scheduleRecognition,
			userSettings.debugMode,
		]
	)

	const onShapesRemoved = React.useCallback(
		(shapeIds: string[]) => {
			if (!Array.isArray(shapeIds) || shapeIds.length === 0) return

			for (const shapeId of shapeIds) {
				pressureStore.removePressureData(shapeId)
				removeNormalizedStrokePayload(handwritingDocumentId, shapeId)
			}

			const payloads = getAllNormalizedStrokePayloads(handwritingDocumentId)
			const { manualMode, recognitionCandidates } = buildRecognitionCandidates(payloads)
			setDocumentWordCandidates(handwritingDocumentId, recognitionCandidates)

			const nextCandidateIds = new Set(recognitionCandidates.map((candidate) => candidate.id))
			for (const result of getDocumentRecognitionResults(handwritingDocumentId)) {
				const referencesRemovedShape = result.shapeIds.some((shapeId) => shapeIds.includes(shapeId))
				if (referencesRemovedShape || !nextCandidateIds.has(result.groupId)) {
					removeRecognitionResult(handwritingDocumentId, result.groupId)
				}
			}

			setOverlayRenderTick((tick) => tick + 1)

			if (!manualMode) {
				scheduleRecognition(recognitionCandidates)
			}

			if (userSettings.debugMode) {
				console.log('[handwriting] shapes removed cleanup complete', {
					documentId: handwritingDocumentId,
					removedShapeIds: shapeIds,
					remainingPayloads: payloads.length,
					remainingCandidates: recognitionCandidates.length,
				})
			}
		},
		[
			buildRecognitionCandidates,
			handwritingDocumentId,
			scheduleRecognition,
			userSettings.debugMode,
		]
	)

	const chooseAnchorTarget = React.useCallback(() => {
		return new Promise<TAbstractFile | string | undefined>((resolve) => {
			let settled = false
			const settle = (value: TAbstractFile | string | undefined) => {
				if (settled) return
				settled = true
				resolve(value)
			}

			new FileSearchModal(plugin, {
				allowAnyPath: true,
				selectDir: false,
				onEmptyStateText: (searchPath) => `No vault files found in ${searchPath}`,
				setSelection: (selection) => settle(selection),
				onClose: () => settle(undefined),
			}).open()
		})
	}, [plugin])

	const maybeWriteReverseBacklink = React.useCallback(
		async (targetFile: TFile, canvasPath: string, shapeId: string) => {
			if (!enableAnchorBacklinks) return
			const graphMention = buildAnchorMention(canvasPath)
			const token = buildAnchorMentionToken(canvasPath, shapeId)

			await plugin.app.fileManager.processFrontMatter(targetFile, (frontMatter) => {
				const existingMentions = Array.isArray(frontMatter[ANCHOR_MENTIONS_FRONTMATTER_KEY])
					? frontMatter[ANCHOR_MENTIONS_FRONTMATTER_KEY]
					: []
				const mentionSet = new Set<string>(
					existingMentions.filter((value: unknown): value is string => typeof value === 'string')
				)
				mentionSet.add(graphMention)
				frontMatter[ANCHOR_MENTIONS_FRONTMATTER_KEY] = Array.from(mentionSet.values()).sort()

				const existingTokens = Array.isArray(frontMatter[ANCHOR_MENTION_TOKENS_FRONTMATTER_KEY])
					? frontMatter[ANCHOR_MENTION_TOKENS_FRONTMATTER_KEY]
					: []
				const tokenSet = new Set<string>(
					existingTokens.filter((value: unknown): value is string => typeof value === 'string')
				)
				tokenSet.add(token)
				frontMatter[ANCHOR_MENTION_TOKENS_FRONTMATTER_KEY] = Array.from(tokenSet.values()).sort()
			})
		},
		[enableAnchorBacklinks, plugin]
	)

	const maybeRemoveReverseBacklink = React.useCallback(
		async (targetPath: string, canvasPath: string, shapeId: string) => {
			if (!enableAnchorBacklinks) return
			const target = plugin.app.vault.getAbstractFileByPath(targetPath)
			if (!(target instanceof TFile)) return

			const graphMention = buildAnchorMention(canvasPath)
			const token = buildAnchorMentionToken(canvasPath, shapeId)
			const legacyToken = `[[${canvasPath}]]#${shapeId}`

			await plugin.app.fileManager.processFrontMatter(target, (frontMatter) => {
				const existingMentions = Array.isArray(frontMatter[ANCHOR_MENTIONS_FRONTMATTER_KEY])
					? frontMatter[ANCHOR_MENTIONS_FRONTMATTER_KEY]
					: []
				const mentionSet = new Set<string>(
					existingMentions.filter((value: unknown): value is string => typeof value === 'string')
				)

				const existingTokens = Array.isArray(frontMatter[ANCHOR_MENTION_TOKENS_FRONTMATTER_KEY])
					? frontMatter[ANCHOR_MENTION_TOKENS_FRONTMATTER_KEY]
					: []
				const nextTokens = existingTokens
					.filter((value: unknown): value is string => typeof value === 'string')
					.filter((value) => value !== token && value !== legacyToken)

				if (nextTokens.length === 0) {
					delete frontMatter[ANCHOR_MENTION_TOKENS_FRONTMATTER_KEY]
				} else {
					frontMatter[ANCHOR_MENTION_TOKENS_FRONTMATTER_KEY] = Array.from(new Set(nextTokens)).sort()
				}

				mentionSet.delete(graphMention)
				for (const nextToken of nextTokens) {
					const nextPath = parseCanvasPathFromMentionToken(nextToken)
					if (!nextPath) continue
					mentionSet.add(buildAnchorMention(nextPath))
				}

				if (mentionSet.size === 0) {
					delete frontMatter[ANCHOR_MENTIONS_FRONTMATTER_KEY]
					return
				}

				frontMatter[ANCHOR_MENTIONS_FRONTMATTER_KEY] = Array.from(mentionSet.values()).sort()
			})
		},
		[enableAnchorBacklinks, plugin]
	)

	const onAnyShapesRemoved = React.useCallback(
		(shapeIds: string[]) => {
			if (!Array.isArray(shapeIds) || shapeIds.length === 0) return
			const canvasPath = plugin.app.workspace.getActiveFile()?.path
			let removedCount = 0
			for (const shapeId of shapeIds) {
				const existing = getAnchorSticker(handwritingDocumentId, shapeId)
				if (!existing) continue
				if (canvasPath) {
					void maybeRemoveReverseBacklink(existing.targetPath, canvasPath, shapeId)
				}
				removeAnchorSticker(handwritingDocumentId, shapeId)
				removedCount += 1
			}
			if (removedCount > 0) {
				setOverlayRenderTick((tick) => tick + 1)
			}
		},
		[handwritingDocumentId, maybeRemoveReverseBacklink, plugin]
	)

	const triggerAnchorStickerAssign = React.useCallback(async () => {
		if (!editor) return
		const canvasFile = plugin.app.workspace.getActiveFile()
		if (!canvasFile) {
			new Notice('Open a canvas file before assigning anchor stickers.')
			return
		}

		const selectedShapeIds = Array.from(editor.getSelectedShapeIds())
		let shapeId = selectedShapeIds[0]
		let createdShapeId: string | undefined

		if (!shapeId) {
			const placementPoint = resolveAnchorPlacementPoint(editor)
			createdShapeId = createAnchorShapeId()
			shapeId = createdShapeId

			try {
				editor.createShape({
					id: createdShapeId,
					type: 'text',
					x: placementPoint.x,
					y: placementPoint.y,
				} as never)
				editor.select(shapeId)
			} catch (error) {
				new Notice(`Unable to place anchor sticker: ${String(error)}`)
				return
			}
		}

		const selection = await chooseAnchorTarget()
		if (!selection) {
			if (createdShapeId) {
				editor.deleteShape(createdShapeId)
			}
			return
		}

		const sourcePath = plugin.app.workspace.getActiveFile()?.path ?? ''
		const targetPath = typeof selection === 'string' ? selection : selection.path
		const resolvedTarget = plugin.app.vault.getAbstractFileByPath(targetPath)
		const previousSticker = getAnchorSticker(handwritingDocumentId, shapeId)

		const targetFile = selection instanceof TFile ? selection : resolvedTarget instanceof TFile ? resolvedTarget : undefined
		const targetDisplay = targetFile
			? plugin.app.metadataCache.fileToLinktext(targetFile, sourcePath)
			: targetPath
		const targetWikilink = targetFile
			? plugin.app.fileManager.generateMarkdownLink(targetFile, sourcePath)
			: `[[${targetPath}]]`

		const now = Date.now()
		upsertAnchorSticker(handwritingDocumentId, {
			shapeId,
			targetPath,
			targetDisplay,
			targetWikilink,
			createdAt: now,
			updatedAt: now,
		})
		setOverlayRenderTick((tick) => tick + 1)

		if (targetFile) {
			try {
				if (previousSticker && previousSticker.targetPath !== targetPath) {
					await maybeRemoveReverseBacklink(previousSticker.targetPath, canvasFile.path, shapeId)
				}
				await maybeWriteReverseBacklink(targetFile, canvasFile.path, shapeId)
			} catch (error) {
				new Notice(`Anchor assigned, but backlink update failed: ${String(error)}`)
			}
		}
	}, [
		chooseAnchorTarget,
		editor,
		handwritingDocumentId,
		maybeRemoveReverseBacklink,
		maybeWriteReverseBacklink,
		plugin,
	])

	const onShapesMoved = React.useCallback(
		(shapeIds: string[]) => {
			if (!Array.isArray(shapeIds) || shapeIds.length === 0) return
			if (!editor) return

			for (const shapeId of shapeIds) {
				removeNormalizedStrokePayload(handwritingDocumentId, shapeId)

				const shape = editor.getShape(shapeId)
				const isCompletedDraw =
					!!shape && shape.type === 'draw' && (shape as { props?: { isComplete?: boolean } }).props?.isComplete
				if (!isCompletedDraw) continue

				const completedShape = shape as CompletedDrawShape
				const strokes = extractStroke(completedShape)
				if (strokes.length === 0) continue

				const payload = processExtractedStroke({
					shapeId,
					shape: completedShape,
					strokes,
				})
				if (!payload) continue

				upsertNormalizedStrokePayload(handwritingDocumentId, payload)
			}

			const payloads = getAllNormalizedStrokePayloads(handwritingDocumentId)
			const { manualMode, recognitionCandidates } = buildRecognitionCandidates(payloads)
			setDocumentWordCandidates(handwritingDocumentId, recognitionCandidates)

			const nextCandidateIds = new Set(recognitionCandidates.map((candidate) => candidate.id))
			for (const result of getDocumentRecognitionResults(handwritingDocumentId)) {
				const referencesMovedShape = result.shapeIds.some((shapeId) => shapeIds.includes(shapeId))
				if (referencesMovedShape || !nextCandidateIds.has(result.groupId)) {
					removeRecognitionResult(handwritingDocumentId, result.groupId)
				}
			}

			setOverlayRenderTick((tick) => tick + 1)

			if (!manualMode) {
				scheduleRecognition(recognitionCandidates)
			}

			if (userSettings.debugMode) {
				console.log('[handwriting] shapes moved cleanup complete', {
					documentId: handwritingDocumentId,
					movedShapeIds: shapeIds,
					remainingPayloads: payloads.length,
					remainingCandidates: recognitionCandidates.length,
				})
			}
		},
		[
			buildRecognitionCandidates,
			editor,
			handwritingDocumentId,
			scheduleRecognition,
			userSettings.debugMode,
		]
	)

	React.useEffect(() => {
		acquireDocumentStrokePayloadScope(handwritingDocumentId)
		acquireDocumentWordCandidateScope(handwritingDocumentId)
		acquireDocumentRecognitionScope(handwritingDocumentId)
		acquireDocumentAnchorStickerScope(handwritingDocumentId)

		return () => {
			if (recognitionDebounceTimerRef.current) {
				clearTimeout(recognitionDebounceTimerRef.current)
				recognitionDebounceTimerRef.current = undefined
			}
			recognitionRunVersionRef.current += 1

			releaseDocumentStrokePayloadScope(handwritingDocumentId)
			releaseDocumentWordCandidateScope(handwritingDocumentId)
			releaseDocumentRecognitionScope(handwritingDocumentId)
			releaseDocumentAnchorStickerScope(handwritingDocumentId)
		}
	}, [handwritingDocumentId])

	React.useEffect(() => {
		return () => {
			void recognizerRef.current.dispose()
		}
	}, [])

	React.useEffect(() => {
		// Register callback for Ctrl+F command from plugin
		plugin.onTriggerHandwritingSearch = () => {
			setIsSearchPanelOpen((current) => !current)
		}
		plugin.onTriggerAnchorStickerAssign = () => {
			void triggerAnchorStickerAssign()
		}
		return () => {
			plugin.onTriggerHandwritingSearch = undefined
			plugin.onTriggerAnchorStickerAssign = undefined
		}
	}, [plugin, triggerAnchorStickerAssign])

	const anchorStickerOverlays = React.useMemo<AnchorStickerOverlay[]>(() => {
		if (!editor) return []
		return getDocumentAnchorStickers(handwritingDocumentId)
			.map((sticker) => {
				const shape = editor.getShape(sticker.shapeId)
				if (!shape) return null
				const viewportPoint = editor.pageToViewport({ x: shape.x, y: shape.y })
				return {
					shapeId: sticker.shapeId,
					targetPath: sticker.targetPath,
					targetDisplay: sticker.targetDisplay,
					targetWikilink: sticker.targetWikilink,
					left: viewportPoint.x,
					top: viewportPoint.y,
				}
			})
			.filter((overlay): overlay is AnchorStickerOverlay => overlay !== null)
	}, [editor, handwritingDocumentId, overlayRenderTick])

	const openAnchorTarget = React.useCallback(
		(targetPath: string) => {
			const target = plugin.app.vault.getAbstractFileByPath(targetPath)
			if (!(target instanceof TFile)) {
				new Notice(`Linked file not found: ${targetPath}`)
				return
			}
			void plugin.app.workspace.getLeaf(false).openFile(target)
		},
		[plugin]
	)

	const deleteAnchorSticker = React.useCallback(
		(shapeId: string) => {
			if (!editor) return
			editor.deleteShape(shapeId)
			setOverlayRenderTick((tick) => tick + 1)
		},
		[editor]
	)

	const onAnchorStickerContextMenu = React.useCallback(
		(event: React.MouseEvent<HTMLButtonElement>, shapeId: string) => {
			event.preventDefault()
			event.stopPropagation()

			const menu = new Menu(plugin.app)
			menu.addItem((item) => {
				item
					.setTitle('Delete anchor sticker')
					.setIcon('trash')
					.onClick(() => deleteAnchorSticker(shapeId))
			})
			menu.showAtMouseEvent(event.nativeEvent)
		},
		[deleteAnchorSticker, plugin.app]
	)

	React.useEffect(() => {
		if (!editor) return
		if (anchorStickerOverlays.length === 0) return

		let animationFrameId = 0
		let disposed = false
		const tick = () => {
			if (disposed) return
			setOverlayRenderTick((value) => value + 1)
			animationFrameId = requestAnimationFrame(tick)
		}

		animationFrameId = requestAnimationFrame(tick)

		return () => {
			disposed = true
			cancelAnimationFrame(animationFrameId)
		}
	}, [anchorStickerOverlays.length, editor])

	useStrokeListener(editor, {
		debug: userSettings.debugMode,
		onStrokeExtracted,
		onShapesRemoved,
		onAnyShapesRemoved,
		onShapesMoved,
	})

	const editorContainerRef = useClickAwayListener<HTMLDivElement>({
		enableClickAwayListener: isFocused,
		handler(ev) {
			// We allow event targets to specify if they should block the editor from being blurred.
			if (PTLEditorBlockBlur.shouldEventBlockBlur(ev)) return

			const blurEditor = onClickAwayBlur?.(ev)
			if (blurEditor !== undefined && !blurEditor) return

			editor?.blur()
			setIsFocused(false)
			const { currTldrawEditor } = plugin
			if (currTldrawEditor) {
				if (currTldrawEditor === editor) {
					plugin.currTldrawEditor = undefined
				}
			}
		},
	})

	// Handle Ctrl+F to open search panel
	React.useEffect(() => {
		const container = editorContainerRef.current
		if (!container) return
		const ownerDocument = container.ownerDocument
		const keydownTarget: Window | Document = ownerDocument.defaultView ?? ownerDocument
		if (userSettings.debugMode) {
			console.log('[handwriting-search] Ctrl+F listener attached', {
				documentId: handwritingDocumentId,
				hasEditor: !!editor,
				target: keydownTarget === ownerDocument ? 'document' : 'window',
			})
		}

		const onKeyDown = (event: KeyboardEvent) => {
			const eventTarget = event.target as HTMLElement | null
			const activeElement = ownerDocument.activeElement as HTMLElement | null
			const inCurrentEditor =
				!!eventTarget && !!editor && editor.getContainer().contains(eventTarget)
			const activeInCurrentEditor =
				!!activeElement && !!editor && editor.getContainer().contains(activeElement)
			const isThisEditorActive =
				inCurrentEditor || activeInCurrentEditor || plugin.currTldrawEditor === editor

			const isSearchHotkey = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f'
			if (userSettings.debugMode && isSearchHotkey) {
				console.log('[handwriting-search] Ctrl+F keydown observed', {
					documentId: handwritingDocumentId,
					key: event.key,
					inCurrentEditor,
					activeInCurrentEditor,
					isThisEditorActive,
					hasCurrEditorRef: plugin.currTldrawEditor === editor,
					targetTag: eventTarget?.tagName,
					activeTag: activeElement?.tagName,
				})
			}

			if (!isThisEditorActive) {
				if (userSettings.debugMode && isSearchHotkey) {
					console.log('[handwriting-search] Ctrl+F ignored (editor not active)', {
						documentId: handwritingDocumentId,
					})
				}
				return
			}

			// Check for Ctrl/Cmd + F to open search.

			if (isSearchHotkey) {
				event.preventDefault()
				event.stopPropagation()
				const willOpen = !isSearchPanelOpen
				if (userSettings.debugMode) {
					console.log('[handwriting-search] Ctrl+F pressed, toggling search panel', {
						documentId: handwritingDocumentId,
						willOpen,
					})
				}
				setIsSearchPanelOpen((current) => !current)
				return
			}
		}

		keydownTarget.addEventListener('keydown', onKeyDown, true)
		return () => {
			keydownTarget.removeEventListener('keydown', onKeyDown, true)
			if (userSettings.debugMode) {
				console.log('[handwriting-search] Ctrl+F listener removed', {
					documentId: handwritingDocumentId,
					target: keydownTarget === ownerDocument ? 'document' : 'window',
				})
			}
		}
	}, [editor, plugin, handwritingDocumentId, isSearchPanelOpen, userSettings.debugMode])

	// Handle search panel keyboard navigation and closing
	React.useEffect(() => {
		const container = editorContainerRef.current
		if (!container) return

		const onKeyDown = (event: KeyboardEvent) => {
			if (!isSearchPanelOpen) return
			const eventTarget = event.target as HTMLElement | null
			const inSearchPanel = !!(eventTarget && searchPanelRef.current?.contains(eventTarget))
			const inCurrentEditor =
				!!eventTarget && !!editor && editor.getContainer().contains(eventTarget)
			const isThisEditorActive = inCurrentEditor || plugin.currTldrawEditor === editor

			if (!isThisEditorActive && !inSearchPanel) return

			if (event.key === 'Escape') {
				if (userSettings.debugMode) {
					console.log('[handwriting-search] panel closed via Escape', {
						documentId: handwritingDocumentId,
					})
				}
				event.preventDefault()
				setIsSearchPanelOpen(false)
				return
			}

			if (event.key === 'ArrowDown') {
				if (filteredSearchResults.length === 0) return
				event.preventDefault()
				moveSearchSelection(1)
				return
			}

			if (event.key === 'ArrowUp') {
				if (filteredSearchResults.length === 0) return
				event.preventDefault()
				moveSearchSelection(-1)
				return
			}

			if (event.key === 'F3') {
				if (filteredSearchResults.length === 0) return
				event.preventDefault()
				moveSearchSelection(event.shiftKey ? -1 : 1)
				return
			}

			if (event.key === 'Enter' && event.shiftKey) {
				if (filteredSearchResults.length === 0) return
				event.preventDefault()
				moveSearchSelection(-1)
				return
			}

			if (event.key === 'Enter') {
				if (selectedSearchResultIndex < 0) return
				const selected = filteredSearchResults[selectedSearchResultIndex]
				if (!selected) return
				event.preventDefault()
				selectSearchResult(selected, { forceRefocus: true })
			}
		}

		container.addEventListener('keydown', onKeyDown, true)
		return () => container.removeEventListener('keydown', onKeyDown, true)
	}, [
		editor,
		filteredSearchResults,
		isSearchPanelOpen,
		handwritingDocumentId,
		plugin,
		selectSearchResult,
		selectedSearchResultIndex,
		moveSearchSelection,
		userSettings.debugMode,
	])

	/**
	 * "Flashbang" workaround
	 *
	 * The editor shows a loading screen which doesn't reflect the user's preference until the editor is loaded.
	 * This works around it by checking the user's preference ahead of time and passing the dark theme className.
	 */
	const fbWorkAroundClassname = React.useMemo(() => {
		const themeMode = plugin.settings.themeMode
		if (themeMode === 'dark') return 'tl-theme__dark'
		else if (themeMode === 'light') return
		else return !isObsidianThemeDark() ? undefined : 'tl-theme__dark'
	}, [plugin])

	return (
		<div
			className={`tldraw-view-root${userSettings.darkModeInvert ? ' ptl-dark-mode-invert' : ''}${
				pencilScrubHud.active ? ' ptl-pencil-scrubbing' : ''
			}`}
			style={pencilScrubHud.active ? { cursor: 'col-resize' } : undefined}
			// e.stopPropagation(); this line should solve the mobile swipe menus bug
			// The bug only happens on the mobile version of Obsidian.
			// When a user tries to interact with the tldraw canvas,
			// Obsidian thinks they're swiping down, left, or right so it opens various menus.
			// By preventing the event from propagating, we can prevent those actions menus from opening.
			onTouchStart={(e) => e.stopPropagation()}
			ref={editorContainerRef}
			onFocus={(e) => {
				setFocusedEditor(false, editor)
			}}
		>
			{anchorStickerOverlays.map((overlay) => (
				<button
					type="button"
					key={overlay.shapeId}
					className="ptl-anchor-sticker-overlay"
					style={{
						transform: `translate(${overlay.left}px, ${overlay.top}px)`,
					}}
					onClick={() => openAnchorTarget(overlay.targetPath)}
					onContextMenu={(event) => onAnchorStickerContextMenu(event, overlay.shapeId)}
					title={overlay.targetWikilink}
				>
					{overlay.targetDisplay}
				</button>
			))}
			{activeSearchHighlightBox ? (
				<div
					className="ptl-handwriting-search-hit-box"
					style={{
						transform: `translate(${activeSearchHighlightBox.left}px, ${activeSearchHighlightBox.top}px)`,
						width: `${activeSearchHighlightBox.width}px`,
						height: `${activeSearchHighlightBox.height}px`,
					}}
				/>
			) : null}
			{isSearchPanelOpen ? (
				<div className="ptl-handwriting-search-panel" ref={searchPanelRef}>
					<div className="ptl-handwriting-search-toolbar">
						<div className="ptl-handwriting-search-count" aria-live="polite">
							{filteredSearchResults.length === 0
								? '0 results'
								: `${Math.max(selectedSearchResultIndex + 1, 1)}/${filteredSearchResults.length}`}
						</div>
						<div className="ptl-handwriting-search-nav">
							<button
								type="button"
								className="ptl-handwriting-search-nav-button"
								onClick={() => moveSearchSelection(-1)}
								disabled={filteredSearchResults.length === 0}
								aria-label="Previous search result"
							>
								Prev
							</button>
							<button
								type="button"
								className="ptl-handwriting-search-nav-button"
								onClick={() => moveSearchSelection(1)}
								disabled={filteredSearchResults.length === 0}
								aria-label="Next search result"
							>
								Next
							</button>
						</div>
					</div>
					<input
						ref={searchInputRef}
						type="text"
						className="ptl-handwriting-search-input"
						placeholder="Search recognized handwriting..."
						value={searchQuery}
						onChange={(event) => setSearchQuery(event.target.value)}
					/>
					<div className="ptl-handwriting-search-results" ref={searchResultsRef}>
						{filteredSearchResultItems.length > 0 ? (
							filteredSearchResultItems.map(({ result, duplicateCount, duplicateOrdinal }, index) => (
								<button
									type="button"
									key={result.groupId}
									className="ptl-handwriting-search-result"
									data-search-result-index={index}
									data-selected={index === selectedSearchResultIndex}
									onClick={() => {
										setSelectedSearchResultIndex(index)
										selectSearchResult(result, { forceRefocus: true })
									}}
								>
									<span className="ptl-handwriting-search-result-text">
										{result.text}
										{duplicateCount > 1 ? ` · #${duplicateOrdinal}` : ''}
									</span>
									<span>{Math.round(result.confidence * 100)}%</span>
								</button>
							))
						) : (
							<div className="ptl-handwriting-search-empty">No matching handwriting found</div>
						)}
					</div>
				</div>
			) : null}
			{showRecognizedBatchTextOverlay
				? recognizedBatchTextOverlays.map((overlay) => (
						<div
							key={overlay.id}
							className="ptl-handwriting-batch-text-overlay"
							style={{
								transform: `translate(${overlay.left}px, ${overlay.top}px)`,
								maxWidth: `${overlay.maxWidth}px`,
							}}
						>
							{overlay.text}
						</div>
				  ))
				: null}
			{userSettings.handwritingRecognition?.manualPredictButton ? (
				<button className="ptl-handwriting-predict-button" onClick={triggerManualRecognition}>
					Predict now
				</button>
			) : null}
			{selectedYoutubeEmbed ? (
				<button
					type="button"
					className="ptl-handwriting-predict-button"
					style={{ top: userSettings.handwritingRecognition?.manualPredictButton ? '48px' : '12px' }}
					onClick={() => setIsPlaylistPanelOpen((current) => !current)}
				>
					Playlist
				</button>
			) : null}
			{userSettings.debugMode ? (
				<button
					type="button"
					className="ptl-handwriting-predict-button"
					style={{ bottom: userSettings.handwritingRecognition?.manualPredictButton ? '58px' : '18px' }}
					onClick={setSelectedShapesOpacityToHalf}
				>
					Set Opacity 50%
				</button>
			) : null}
			{pencilScrubHud.active ? (
				<div
					className="ptl-pencil-scrub-hud"
					style={{
						left: `${pencilScrubHud.left}px`,
						top: `${pencilScrubHud.top}px`,
					}}
				>
					<div className="ptl-pencil-scrub-hud-ring" aria-hidden="true">
						<div className="ptl-pencil-scrub-hud-ring-inner" />
					</div>
					<div className="ptl-pencil-scrub-hud-track">
						<div
							className="ptl-pencil-scrub-hud-fill"
							style={{
								width: `${Math.round(
									((pencilScrubHud.brushPx - PENCIL_BRUSH_MIN_PX) /
										(PENCIL_BRUSH_MAX_PX - PENCIL_BRUSH_MIN_PX)) *
										100
								)}%`,
							}}
						/>
					</div>
					<div className="ptl-pencil-scrub-hud-arrow" aria-hidden="true">⇔</div>
					<div className="ptl-pencil-scrub-hud-label">Size {pencilScrubHud.brushPx}px</div>
				</div>
			) : null}
			{urlPasteDialog ? (
				<div
					style={{
						position: 'absolute',
						inset: 0,
						zIndex: 120,
						display: 'flex',
						alignItems: 'center',
						justifyContent: 'center',
						background: 'rgb(0 0 0 / 40%)',
					}}
				>
					<div
						style={{
							width: 'min(520px, calc(100% - 24px))',
							background: 'var(--background-primary)',
							border: '1px solid var(--background-modifier-border)',
							borderRadius: '12px',
							padding: '14px',
							boxShadow: '0 12px 40px rgb(0 0 0 / 35%)',
						}}
					>
						<div style={{ fontWeight: 700, marginBottom: '8px' }}>Paste Link</div>
						<div
							style={{
								fontSize: '12px',
								opacity: 0.8,
								wordBreak: 'break-all',
								marginBottom: '12px',
							}}
						>
							{urlPasteDialog.url}
						</div>
						<div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
							<button type="button" onClick={() => resolveUrlPasteChoice('cancel')}>
								Cancel
							</button>
							<button type="button" onClick={() => resolveUrlPasteChoice('text')}>
								Paste as Text
							</button>
							<button
								type="button"
								className="mod-cta"
								onClick={() => resolveUrlPasteChoice('iframe')}
							>
								Paste as Iframe
							</button>
						</div>
					</div>
				</div>
			) : null}
			{isPlaylistPanelOpen && selectedYoutubeEmbed ? (
				<div className="ptl-youtube-playlist-panel">
					<div className="ptl-youtube-playlist-header">
						<div>
							<div className="ptl-youtube-playlist-title">YouTube Playlist</div>
							<div className="ptl-youtube-playlist-subtitle">
								Shape: {selectedYoutubeEmbed.shapeId.slice(-8)}
							</div>
						</div>
						<button type="button" onClick={() => setIsPlaylistPanelOpen(false)}>
							Close
						</button>
					</div>
					<textarea
						className="ptl-youtube-playlist-input"
						placeholder="Paste YouTube URLs or video IDs, one per line"
						value={playlistInput}
						onChange={(event) => setPlaylistInput(event.currentTarget.value)}
					/>
					<div className="ptl-youtube-playlist-actions">
						<button type="button" className="ptl-handwriting-search-nav-button" onClick={loadPlaylistFromInput}>
							Load Videos
						</button>
					</div>
					<div className="ptl-youtube-playlist-videos">
						{(playlistEntriesByShapeId[selectedYoutubeEmbed.shapeId] ?? []).map((entry, index) => {
							const ids = parseYoutubeIds(entry)
							const label = ids.videoId ? `${index + 1}. ${ids.videoId}` : `${index + 1}. Video`
							return (
								<button
									type="button"
									key={`${entry}-${index}`}
									className="ptl-youtube-playlist-video"
									onClick={() => updateYoutubeEmbedVideo(entry)}
								>
									<span className="ptl-youtube-playlist-video-label">{label}</span>
								</button>
							)
						})}
					</div>
				</div>
			) : null}
			<Tldraw // This component is responsible for rendering the canvas.
				{...storeProps}
				assetUrls={assetUrls.current}
				embeds={EMBED_DEFINITIONS}
				hideUi={hideUi}
				onUiEvent={onUiEvent}
				overrides={overridesUi.current}
				components={overridesUiComponents.current}
				// Set this flag to false when a tldraw document is embed into markdown to prevent it from gaining focus when it is loaded.
				autoFocus={false}
				onMount={(editor) => {
					setAppState(editor) //setAppState is the function that stores the editor instance inside the plugin's internal state.
				}}
				tools={tools}
				className={fbWorkAroundClassname}
			/>
		</div>
	)
}

export const createRootAndRenderTldrawApp = (
	node: Element,
	plugin: TldrawPlugin,
	options: {
		app?: TldrawAppOptions
		store?: TldrawAppStoreProps
	} = {}
) => {
	const root = createRoot(node)
	root.render(
		<TldrawInObsidianPluginProvider plugin={plugin}>
			<TldrawApp
				plugin={plugin}
				store={options.store}
				options={options.app ?? {}}
				targetDocument={node.ownerDocument}
			/>
		</TldrawInObsidianPluginProvider>
	)

	return root
}

export default TldrawApp
