import Fuse from 'fuse.js'
import { Menu, Notice, Platform, TAbstractFile, TFile } from 'obsidian'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { createPortal } from 'react-dom'
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
	PLUGIN_ACTION_CAPTURE_SELECTION_STAMP,
	PLUGIN_ACTION_TOGGLE_ZOOM_LOCK,
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
	DefaultContextMenu,
	DefaultContextMenuContent,
	Editor,
	TLAnyShapeUtilConstructor,
	TLComponents,
	Tldraw,
	DEFAULT_EMBED_DEFINITIONS,
	type TLEmbedDefinition,
	TldrawEditorStoreProps,
	TldrawUiMenuItem,
	TldrawUiMenuActionItem,
	TldrawUiMenuGroup,
	TldrawUiMenuSubmenu,
	TldrawUiSlider,
	TLStateNodeConstructor,
	TLStoreSnapshot,
	type TLDrawShape,
	type TLEmbedShape,
	type TLShapeId,
	TLUiAssetUrlOverrides,
	TLUiEventHandler,
	TLUiOverrides,
	type TLUiStylePanelProps,
	type VecLike,
	useEditor,
	useIsToolSelected,
	useRelevantStyles,
	useTranslation,
	useValue,
	useActions,
	useTools,
} from 'tldraw'
import {
	setPencilBaseStrokeEnabled,
	setPencilDefaultStrokeEnabled,
	setPencilFallbackStylingEnabled,
	setPencilCrossSectionAspectRatio,
	setPencilOpacitySensitivity,
	setPencilSampledOverlayEnabled,
	activeBrushTipRef,
} from 'src/tldraw/rendering/pencil-draw-shape-util'
import { applyGrainToDab, getPressureOpacityStyle } from 'src/tldraw/rendering/pencil-texture'
import PluginKeyboardShortcutsDialog from './PluginKeyboardShortcutsDialog'
import PluginQuickActions from './PluginQuickActions'
import {
	extractYoutubePlaylistVideoIds,
	getYoutubePlaylistIdFromUrl,
} from 'src/obsidian/youtube/playlist-extractor'
import { generateFallbackTip } from 'src/obsidian/krita/fallback-tips'

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

type BrushProfile = {
	baseSize: number
	spacingFactor: number
	sizeCurveExponent: number
	opacityCurveExponent: number
	rotationJitter: number
	baseOpacity: number
	pencilCrossSectionAspectRatio: number
	pencilTextureIntensity: number
}

type KritaPresetDerivedStyle = {
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

type KritaBrushRuntimeContextValue = {
	brushTipCache: React.RefObject<Map<string, ImageBitmap>>
	activeBrushTip: React.RefObject<ImageBitmap | null>
	activeBrushProfile: React.RefObject<BrushProfile | null>
	activeStampShapeMode: React.RefObject<'auto' | 'circle' | 'rectangle'>
	selectedPresetId: string | null
	customStampPreset: { id: string; label: string } | null
	committedCanvasRef: React.RefObject<HTMLCanvasElement | null>
	activeCanvasRef: React.RefObject<HTMLCanvasElement | null>
	applyPresetSelection: (
		presetId: string,
		presetName: string,
		derivedStyle: KritaPresetDerivedStyle
	) => void
	activateCustomStamp: () => void
	setStampShapeMode: (mode: 'auto' | 'circle' | 'rectangle') => void
	captureSelectedShapeAsStamp: () => void
}

const KritaBrushRuntimeContext = React.createContext<KritaBrushRuntimeContextValue | null>(null)

// https://github.com/tldraw/tldraw/blob/58890dcfce698802f745253ca42584731d126cc3/apps/examples/src/examples/custom-main-menu/CustomMainMenuExample.tsx
const components = (_plugin: TldrawPlugin): TLComponents => ({
	MainMenu: () => (
		<DefaultMainMenu>
			<LocalFileMenu />
			<DefaultMainMenuContent />
		</DefaultMainMenu>
	),
	ContextMenu: PluginContextMenu,
	StylePanel: PluginStylePanel,
	Toolbar: PluginToolbar,
	KeyboardShortcutsDialog: PluginKeyboardShortcutsDialog,
	QuickActions: PluginQuickActions,
})

const PENCIL_BRUSH_MIN_PX = 1
const PENCIL_BRUSH_MAX_PX = 600
const DEFAULT_PENCIL_BRUSH_PX = 24
const PENCIL_SCRUB_PX_PER_SCREEN_PIXEL = 0.25

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
			pencilTextureEnabled: true,
			brushTipData: null,
			spacingFactor: 0.2,
			sizeCurveExponent: 0.7,
			opacityCurveExponent: 1.2,
			rotationJitter: 0,
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
							.filter((shape): shape is TLDrawShape => shape.type === 'draw')

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
	derivedStyle?: KritaPresetDerivedStyle
}

type KritaStampShapeMode = 'auto' | 'circle' | 'rectangle'

function KritaBrushPresetPanel() {
	const plugin = useTldrawPlugin()
	const runtime = React.useContext(KritaBrushRuntimeContext)
	const tools = useTools()
	const isPencilSelected = useIsToolSelected(tools.pencil)
	const userSettings = useUserPluginSettings(plugin.settingsManager)
	const listRef = React.useRef<HTMLDivElement | null>(null)

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

	const selectedPresetId = runtime?.selectedPresetId ?? userSettings.handwritingRecognition?.kritaSelectedPresetId ?? null
	const selectedStampShapeMode: KritaStampShapeMode =
		(userSettings.handwritingRecognition?.kritaStampShape as KritaStampShapeMode | undefined) ?? 'auto'

	const onBrushListWheel = React.useCallback((event: React.WheelEvent<HTMLDivElement>) => {
		const list = listRef.current
		if (!list) return
		event.stopPropagation()
		if (Math.abs(event.deltaY) < 0.01) return
		list.scrollBy({ top: event.deltaY })
		event.preventDefault()
	}, [])

	const onSelectPreset = React.useCallback(
		(preset: KritaPresetOption) => {
			const derivedStyle = preset.derivedStyle ?? deriveKritaPresetStyle(preset.label, preset.path)
			runtime?.applyPresetSelection(preset.id, preset.label, derivedStyle)
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
		[plugin.settingsManager, runtime]
	)

	const onSelectCustomStamp = React.useCallback(() => {
		runtime?.activateCustomStamp()
	}, [runtime])

	const onSelectStampShapeMode = React.useCallback(
		(mode: KritaStampShapeMode) => {
			runtime?.setStampShapeMode(mode)
			plugin.settingsManager.settings.handwritingRecognition = {
				...(plugin.settingsManager.settings.handwritingRecognition ?? {}),
				kritaStampShape: mode,
			}
			void plugin.settingsManager.updateSettings(plugin.settingsManager.settings)
		},
		[plugin.settingsManager, runtime]
	)

	if (!isPencilSelected) return null

	return (
		<div className="ptl-krita-brush-panel">
			<div className="ptl-krita-brush-panel-header">
				Krita brushes ({presets.length + (runtime?.customStampPreset ? 1 : 0)})
			</div>
			<div className="ptl-krita-stamp-mode" role="group" aria-label="Stamp shape mode">
				{([
					['auto', 'Auto'],
					['circle', 'Circle'],
					['rectangle', 'Rectangle'],
				] as const).map(([mode, label]) => (
					<button
						key={mode}
						type="button"
						className="ptl-krita-stamp-mode-button"
						data-selected={selectedStampShapeMode === mode}
						onClick={() => onSelectStampShapeMode(mode)}
					>
						{label}
					</button>
				))}
			</div>
			<div
				ref={listRef}
				className="ptl-krita-brush-list"
				role="listbox"
				aria-label="Krita brush presets"
				onWheel={onBrushListWheel}
			>
				{runtime?.customStampPreset ? (
					<button
						type="button"
						className="ptl-krita-brush-item"
						data-selected={selectedPresetId === runtime.customStampPreset.id}
						onClick={onSelectCustomStamp}
					>
						<span className="ptl-krita-brush-item-name">{runtime.customStampPreset.label}</span>
						<span className="ptl-krita-brush-item-bundle">Captured from selection</span>
					</button>
				) : null}
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

function CustomContextMenuContent() {
	return (
		<>
			<DefaultContextMenuContent />
			<TldrawUiMenuGroup id="capture-stamp">
				<TldrawUiMenuActionItem actionId={PLUGIN_ACTION_CAPTURE_SELECTION_STAMP} />
			</TldrawUiMenuGroup>
		</>
	)
}

function PluginContextMenu() {
	return (
		<DefaultContextMenu>
			<CustomContextMenuContent />
		</DefaultContextMenu>
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

function LocalFileMenu() {
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
	shapeId: TLShapeId
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
	shapeId: TLShapeId
	url: string
	playlistId?: string
	videoId?: string
}

type YoutubePlaylistEntry = {
	url: string
	title?: string
}

type PlaylistHoverPreview = {
	title: string
	thumbnailUrl: string
	left: number
	top: number
}

type EmbedPinToCameraState = {
	shapeId: TLShapeId
	viewportX: number
	viewportY: number
	screenW: number
	screenH: number
	originalW: number
	originalH: number
}

type YoutubePlayerHudState = {
	currentTime: number
	duration: number
	playerState: number
	title: string
	muted: boolean
	playbackRate: number
	availablePlaybackRates: number[]
}

type YoutubeControlsOverlayPosition = {
	left: number
	top: number
	width: number
	scale: number
}

const DEFAULT_SEARCH_FOCUS_MIN_SIZE = 64
const SEARCH_FOCUS_PADDING = 20
const ANCHOR_MENTIONS_FRONTMATTER_KEY = 'tldraw-canvas-mentions'
const ANCHOR_MENTION_TOKENS_FRONTMATTER_KEY = 'tldraw-canvas-mention-shapes'

function createAnchorShapeId(): TLShapeId {
	return `shape:anchor-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}` as TLShapeId
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

function isYoutubePlaylistUrl(url: string): boolean {
	const ids = parseYoutubeIds(url)
	return typeof ids.playlistId === 'string' && ids.playlistId.length > 0
}

function buildYoutubeWatchUrl(videoId: string, playlistId?: string): string {
	const url = new URL('https://www.youtube.com/watch')
	url.searchParams.set('v', videoId)
	if (playlistId) {
		url.searchParams.set('list', playlistId)
	}
	return url.toString()
}

function buildYoutubeThumbnailUrl(videoId?: string): string | undefined {
	if (!videoId) return
	return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`
}

function buildYoutubeScrubPreviewUrl(videoId: string, fraction: number): string {
	const frameIndex = Math.max(0, Math.min(3, Math.floor(clampUnit(fraction) * 4)))
	return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/${frameIndex}.jpg`
}

function buildYoutubeApiEmbedUrl(url: string): string {
	try {
		const ids = parseYoutubeIds(url)
		if (!ids.videoId) return url

		// Keep playlist context while forcing iframe API support for custom controls.
		const embed = new URL(`https://www.youtube.com/embed/${encodeURIComponent(ids.videoId)}`)
		if (ids.playlistId) embed.searchParams.set('list', ids.playlistId)
		embed.searchParams.set('enablejsapi', '1')
		embed.searchParams.set('playsinline', '1')
		embed.searchParams.set('controls', '0')
		embed.searchParams.set('rel', '0')
		embed.searchParams.set('modestbranding', '1')
		embed.searchParams.set('origin', globalThis.location?.origin ?? 'https://obsidian.md')
		return embed.toString()
	} catch {
		return url
	}
}

function formatYoutubeTime(seconds: number): string {
	const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
	const h = Math.floor(safe / 3600)
	const m = Math.floor((safe % 3600) / 60)
	const s = safe % 60
	if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
	return `${m}:${String(s).padStart(2, '0')}`
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

function buildPlaylistLastOpenedStorageKey(documentId: string, shapeId: string): string {
	return `ptl.youtube-playlist.last-opened.v1:${documentId}:${shapeId}`
}

function getEmbedPageSize(shape: unknown): { w: number; h: number } {
	const candidate = shape as { props?: { w?: number; h?: number } } | undefined
	const w =
		typeof candidate?.props?.w === 'number' && Number.isFinite(candidate.props.w)
			? candidate.props.w
			: 320
	const h =
		typeof candidate?.props?.h === 'number' && Number.isFinite(candidate.props.h)
			? candidate.props.h
			: 180
	return { w, h }
}

function getEditorViewportScale(editor: Editor): number {
	const origin = editor.pageToViewport({ x: 0, y: 0 })
	const oneX = editor.pageToViewport({ x: 1, y: 0 })
	const scale = Math.abs(oneX.x - origin.x)
	if (!Number.isFinite(scale) || scale <= 0) return 1
	return scale
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
	const [playlistUrlInput, setPlaylistUrlInput] = React.useState('')
	const [playlistSearchQuery, setPlaylistSearchQuery] = React.useState('')
	const [playlistInput, setPlaylistInput] = React.useState('')
	const [playlistLoading, setPlaylistLoading] = React.useState(false)
	const [playlistStatus, setPlaylistStatus] = React.useState<string | undefined>(undefined)
	const [selectedSearchResultIndex, setSelectedSearchResultIndex] = React.useState(-1)
	const [activeSearchGroupId, setActiveSearchGroupId] = React.useState<string | undefined>(undefined)
	const [selectedYoutubeEmbed, setSelectedYoutubeEmbed] = React.useState<YoutubeEmbedSelection | null>(null)
	const [playlistEntriesByShapeId, setPlaylistEntriesByShapeId] = React.useState<
		Record<string, YoutubePlaylistEntry[]>
	>({})
	const [playlistHoverPreview, setPlaylistHoverPreview] = React.useState<PlaylistHoverPreview | null>(null)
	const [embedPinToCamera, setEmbedPinToCamera] = React.useState<EmbedPinToCameraState | null>(null)
	const [youtubePlayerHud, setYoutubePlayerHud] = React.useState<YoutubePlayerHudState>({
		currentTime: 0,
		duration: 0,
		playerState: -1,
		title: '',
		muted: false,
		playbackRate: 1,
		availablePlaybackRates: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2],
	})
	const [youtubeScrubPreview, setYoutubeScrubPreview] = React.useState<{
		left: number
		fraction: number
		active: boolean
	} | null>(null)
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
	const committedCanvasRef = React.useRef<HTMLCanvasElement | null>(null)
	const activeCanvasRef = React.useRef<HTMLCanvasElement | null>(null)
	const previousNormalizedSearchQueryRef = React.useRef('')
	const recognizerRef = React.useRef(createHandwritingRecognizer({ engine: 'stub' }))
	const recognitionDebounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const recognitionRunVersionRef = React.useRef(0)
	const brushTipCache = React.useRef<Map<string, ImageBitmap>>(new Map())
	const activeBrushTip = React.useRef<ImageBitmap | null>(null)
	const activeBrushProfile = React.useRef<BrushProfile | null>(null)
	const activeStampShapeMode = React.useRef<'auto' | 'circle' | 'rectangle'>('auto')
	const customStampBitmapRef = React.useRef<ImageBitmap | null>(null)
	const [activeStampShapeModeState, setActiveStampShapeModeState] = React.useState<
		'auto' | 'circle' | 'rectangle'
	>('auto')
	const activePresetIdRef = React.useRef<string | null>(null)
	const [runtimeSelectedPresetId, setRuntimeSelectedPresetId] = React.useState<string | null>(null)
	const [runtimeCustomStampPreset, setRuntimeCustomStampPreset] = React.useState<{
		id: string
		label: string
	} | null>(null)
	const lastDabXRef = React.useRef(0)
	const lastDabYRef = React.useRef(0)
	const lastPressureRef = React.useRef(0.5)
	const lastTimestampRef = React.useRef(0)
	const remainderDistRef = React.useRef(0)
	const isDrawingRef = React.useRef(false)
	const activePointerIdRef = React.useRef<number | null>(null)
	const saveTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const suppressScrubArtifactUntilRef = React.useRef(0)
	const scrubCanceledShapeIdsRef = React.useRef(new Set<string>())
	const bootstrappedRecognitionByDocumentRef = React.useRef(new Set<string>())
	const urlPasteDialogResolverRef = React.useRef<
		((choice: 'iframe' | 'text' | 'cancel') => void) | null
	>(null)
	const playlistAutoImportKeyRef = React.useRef<string | null>(null)
	const youtubeIframeRef = React.useRef<HTMLIFrameElement | null>(null)
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

	const playlistHoverPreviewOverlay =
		playlistHoverPreview && ownerDocument?.body
			? createPortal(
				<div className="ptl-youtube-playlist-hover-preview-fixed">
					<img
						className="ptl-youtube-playlist-hover-preview-image"
						src={playlistHoverPreview.thumbnailUrl}
						alt={playlistHoverPreview.title}
					/>
					<div className="ptl-youtube-playlist-hover-preview-title">
						{playlistHoverPreview.title}
					</div>
				</div>,
				ownerDocument.body
			  )
			: null

	const youtubePlaybackFraction =
		youtubePlayerHud.duration > 0
			? clampUnit(youtubePlayerHud.currentTime / youtubePlayerHud.duration)
			: 0
	const youtubePreviewTime =
		youtubeScrubPreview && youtubePlayerHud.duration > 0
			? youtubePlayerHud.duration * clampUnit(youtubeScrubPreview.fraction)
			: 0
	const youtubePreviewThumbnailUrl =
		youtubeScrubPreview?.active && selectedYoutubeEmbed?.videoId
			? buildYoutubeScrubPreviewUrl(selectedYoutubeEmbed.videoId, youtubeScrubPreview.fraction)
			: undefined

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

	const toBrushTipBytes = React.useCallback((value: unknown): Uint8Array | null => {
		if (!value) return null
		if (value instanceof Uint8Array) return value
		if (Array.isArray(value)) {
			const valid = value.every((entry) => Number.isFinite(entry))
			return valid ? Uint8Array.from(value as number[]) : null
		}
		if (ArrayBuffer.isView(value)) {
			const view = value as ArrayBufferView
			return new Uint8Array(view.buffer, view.byteOffset, view.byteLength)
		}
		if (typeof value === 'object') {
			const candidate = value as { [key: string]: unknown; length?: unknown }
			if (typeof candidate.length === 'number' && Number.isFinite(candidate.length)) {
				const entries: number[] = []
				for (let i = 0; i < candidate.length; i++) {
					const point = candidate[String(i)]
					if (!Number.isFinite(point)) return null
					entries.push(Number(point))
				}
				return Uint8Array.from(entries)
			}
		}
		return null
	}, [])

	React.useEffect(() => {
		const mode = userSettings.handwritingRecognition?.kritaStampShape
		const resolvedMode = mode === 'circle' || mode === 'rectangle' ? mode : 'auto'
		activeStampShapeMode.current = resolvedMode
		setActiveStampShapeModeState(resolvedMode)
	}, [userSettings.handwritingRecognition?.kritaStampShape])

	React.useEffect(() => {
		if (activeBrushProfile.current) return
		activeBrushProfile.current = {
			baseSize: clampBrushPx(userSettings.handwritingRecognition?.pencilBrushSizePx ?? DEFAULT_PENCIL_BRUSH_PX),
			spacingFactor: 0.2,
			sizeCurveExponent: 0.7,
			opacityCurveExponent: 1.2,
			rotationJitter: 0,
			baseOpacity: Math.max(
				0.02,
				Math.min(1, (userSettings.handwritingRecognition?.pencilOpacitySensitivity ?? 1) / 2.5)
			),
			pencilCrossSectionAspectRatio: Math.max(
				1,
				userSettings.handwritingRecognition?.pencilCrossSectionAspectRatio ?? 5
			),
			pencilTextureIntensity: Math.max(0, Math.min(1, userSettings.handwritingRecognition?.pencilTextureIntensity ?? 0.35)),
		}
	}, [
		userSettings.handwritingRecognition?.pencilBrushSizePx,
		userSettings.handwritingRecognition?.pencilOpacitySensitivity,
		userSettings.handwritingRecognition?.pencilCrossSectionAspectRatio,
		userSettings.handwritingRecognition?.pencilTextureIntensity,
	])

	const isPngBytes = React.useCallback((bytes: Uint8Array) => {
		return (
			bytes.length >= 8 &&
			bytes[0] === 0x89 &&
			bytes[1] === 0x50 &&
			bytes[2] === 0x4e &&
			bytes[3] === 0x47 &&
			bytes[4] === 0x0d &&
			bytes[5] === 0x0a &&
			bytes[6] === 0x1a &&
			bytes[7] === 0x0a
		)
	}, [])

	const applyKritaPresetSelection = React.useCallback(
		(presetId: string, presetName: string, derivedStyle: KritaPresetDerivedStyle) => {
			activePresetIdRef.current = presetId
			setRuntimeSelectedPresetId(presetId)
			const profile: BrushProfile = {
				baseSize: clampBrushPx(derivedStyle.pencilBrushSizePx),
				spacingFactor: Math.max(0.01, derivedStyle.spacingFactor ?? 0.2),
				sizeCurveExponent: Math.max(0.01, derivedStyle.sizeCurveExponent ?? 0.7),
				opacityCurveExponent: Math.max(0.01, derivedStyle.opacityCurveExponent ?? 1.2),
				rotationJitter: Math.max(0, Math.min(1, derivedStyle.rotationJitter ?? 0)),
				baseOpacity: Math.max(0.02, Math.min(1, (derivedStyle.pencilOpacitySensitivity ?? 1) / 2.5)),
				pencilCrossSectionAspectRatio: Math.max(1, derivedStyle.pencilCrossSectionAspectRatio ?? 5),
				pencilTextureIntensity: Math.max(0, Math.min(1, derivedStyle.pencilTextureIntensity ?? 0.35)),
			}
			activeBrushProfile.current = profile

			const tipBytes = toBrushTipBytes(derivedStyle.brushTipData)
			if (!tipBytes) {
				const fallbackKey = `fallback-${presetId}`
				const cachedFallback = brushTipCache.current.get(fallbackKey)
				if (cachedFallback) {
					activeBrushTip.current = cachedFallback
					return
				}

				activeBrushTip.current = null
				void generateFallbackTip(presetName, profile, Math.max(48, Math.round(profile.baseSize * 2.2)))
					.then((bitmap) => {
						brushTipCache.current.set(fallbackKey, bitmap)
						if (activePresetIdRef.current === presetId) {
							activeBrushTip.current = bitmap
						}
					})
					.catch((error) => {
						console.warn('[KritaBrush] failed to generate fallback tip', {
							presetId,
							error,
						})
					})
				return
			}

			const cached = brushTipCache.current.get(presetId)
			if (cached) {
				activeBrushTip.current = cached
				return
			}

			const usePngDecode = isPngBytes(tipBytes)
			if (!usePngDecode) {
				// Many Krita bundle tips are GBR/GIH blobs and cannot be decoded by createImageBitmap.
				const fallbackKey = `fallback-${presetId}`
				const cachedFallback = brushTipCache.current.get(fallbackKey)
				if (cachedFallback) {
					activeBrushTip.current = cachedFallback
					return
				}
				activeBrushTip.current = null
				void generateFallbackTip(presetName, profile, Math.max(48, Math.round(profile.baseSize * 2.2)))
					.then((bitmap) => {
						brushTipCache.current.set(fallbackKey, bitmap)
						if (activePresetIdRef.current === presetId) {
							activeBrushTip.current = bitmap
						}
					})
					.catch((error) => {
						console.warn('[KritaBrush] failed to generate fallback tip', {
							presetId,
							error,
						})
					})
				return
			}

			const normalizedTipBytes = Uint8Array.from(tipBytes)
			const blob = new Blob([normalizedTipBytes], { type: 'image/png' })
			void createImageBitmap(blob)
				.then((bitmap) => {
					brushTipCache.current.set(presetId, bitmap)
					if (activePresetIdRef.current === presetId) {
						activeBrushTip.current = bitmap
					}
				})
				.catch((error) => {
					console.warn('[KritaBrush] failed to decode brush tip bitmap', {
						presetId,
						error,
					})
					const fallbackKey = `fallback-${presetId}`
					const cachedFallback = brushTipCache.current.get(fallbackKey)
					if (cachedFallback) {
						activeBrushTip.current = cachedFallback
						return
					}
					activeBrushTip.current = null
					void generateFallbackTip(presetName, profile, Math.max(48, Math.round(profile.baseSize * 2.2)))
						.then((bitmap) => {
							brushTipCache.current.set(fallbackKey, bitmap)
							if (activePresetIdRef.current === presetId) {
								activeBrushTip.current = bitmap
							}
						})
						.catch((fallbackError) => {
							console.warn('[KritaBrush] failed to generate fallback tip after bitmap decode failure', {
								presetId,
								error: fallbackError,
							})
						})
				})
		},
		[isPngBytes, toBrushTipBytes]
	)

	const setRuntimeStampShapeMode = React.useCallback((mode: 'auto' | 'circle' | 'rectangle') => {
		activeStampShapeMode.current = mode
		setActiveStampShapeModeState(mode)
	}, [])

	const activateCustomStamp = React.useCallback(() => {
		const customStamp = runtimeCustomStampPreset
		if (!customStamp) return
		const stampBitmap = customStampBitmapRef.current ?? brushTipCache.current.get(customStamp.id) ?? null
		if (!stampBitmap) {
			new Notice('Custom stamp is no longer available. Capture a new selection.')
			return
		}

		brushTipCache.current.set(customStamp.id, stampBitmap)
		activeBrushTip.current = stampBitmap
		activePresetIdRef.current = customStamp.id
		setRuntimeSelectedPresetId(customStamp.id)
	}, [runtimeCustomStampPreset])

	const captureSelectedShapeAsStamp = React.useCallback(() => {
		if (!editor) return

		const selectedShapeIds = Array.from(editor.getSelectedShapeIds())
		if (selectedShapeIds.length === 0) {
			new Notice('Select at least one shape to capture as a brush stamp.')
			return
		}

		if (!activeBrushProfile.current) {
			activeBrushProfile.current = {
				baseSize: clampBrushPx(userSettings.handwritingRecognition?.pencilBrushSizePx ?? DEFAULT_PENCIL_BRUSH_PX),
				spacingFactor: 0.2,
				sizeCurveExponent: 0.7,
				opacityCurveExponent: 1.2,
				rotationJitter: 0,
				baseOpacity: Math.max(
					0.02,
					Math.min(1, (userSettings.handwritingRecognition?.pencilOpacitySensitivity ?? 1) / 2.5)
				),
				pencilCrossSectionAspectRatio: Math.max(
					1,
					userSettings.handwritingRecognition?.pencilCrossSectionAspectRatio ?? 5
				),
				pencilTextureIntensity: Math.max(0, Math.min(1, userSettings.handwritingRecognition?.pencilTextureIntensity ?? 0.35)),
			}
		}

		void (async () => {
			try {
				const svgResult = await editor.getSvgString(selectedShapeIds, {
					background: false,
					preserveAspectRatio: 'xMidYMid meet',
					scale: 1,
				})
				if (!svgResult?.svg || svgResult.width <= 0 || svgResult.height <= 0) {
					new Notice('Could not capture selection as stamp.')
					return
				}

				const svgBlob = new Blob([svgResult.svg], { type: 'image/svg+xml;charset=utf-8' })
				const sourceBitmap = await (async () => {
					try {
						return await createImageBitmap(svgBlob)
					} catch (bitmapError) {
						if (typeof document === 'undefined') throw bitmapError
						return await new Promise<ImageBitmap>((resolve, reject) => {
							const objectUrl = URL.createObjectURL(svgBlob)
							const image = new Image()
							image.onload = () => {
								try {
									const fallbackCanvas = document.createElement('canvas')
									fallbackCanvas.width = svgResult.width
									fallbackCanvas.height = svgResult.height
									const fallbackCtx = fallbackCanvas.getContext('2d')
									if (!fallbackCtx) {
										URL.revokeObjectURL(objectUrl)
										reject(new Error('No drawing context for custom stamp'))
										return
									}
									fallbackCtx.clearRect(0, 0, fallbackCanvas.width, fallbackCanvas.height)
									fallbackCtx.drawImage(image, 0, 0)
									URL.revokeObjectURL(objectUrl)
									createImageBitmap(fallbackCanvas).then(resolve).catch(reject)
								} catch (error) {
									URL.revokeObjectURL(objectUrl)
									reject(error)
								}
							}
							image.onerror = () => {
								URL.revokeObjectURL(objectUrl)
								reject(new Error('Failed to decode SVG stamp image'))
							}
							image.src = objectUrl
						})
					}
				})()

				const stampSize = 256
				let stampBitmap: ImageBitmap | null = null
				if (typeof OffscreenCanvas !== 'undefined') {
					const canvas = new OffscreenCanvas(stampSize, stampSize)
					const ctx = canvas.getContext('2d')
					if (!ctx) throw new Error('No drawing context for custom stamp')
					ctx.clearRect(0, 0, stampSize, stampSize)
					const fitScale = Math.min((stampSize * 0.82) / sourceBitmap.width, (stampSize * 0.82) / sourceBitmap.height)
					const drawW = sourceBitmap.width * fitScale
					const drawH = sourceBitmap.height * fitScale
					ctx.drawImage(sourceBitmap, (stampSize - drawW) / 2, (stampSize - drawH) / 2, drawW, drawH)
					stampBitmap = await createImageBitmap(canvas)
				} else if (typeof document !== 'undefined') {
					const canvas = document.createElement('canvas')
					canvas.width = stampSize
					canvas.height = stampSize
					const ctx = canvas.getContext('2d')
					if (!ctx) throw new Error('No drawing context for custom stamp')
					ctx.clearRect(0, 0, stampSize, stampSize)
					const fitScale = Math.min((stampSize * 0.82) / sourceBitmap.width, (stampSize * 0.82) / sourceBitmap.height)
					const drawW = sourceBitmap.width * fitScale
					const drawH = sourceBitmap.height * fitScale
					ctx.drawImage(sourceBitmap, (stampSize - drawW) / 2, (stampSize - drawH) / 2, drawW, drawH)
					stampBitmap = await createImageBitmap(canvas)
				}

				sourceBitmap.close()
				if (!stampBitmap) {
					new Notice('Custom stamp capture is not supported in this environment.')
					return
				}

				const stampId = `custom-shape-stamp:${Date.now()}`
				const stampLabel = 'Custom stamp'
				brushTipCache.current.set(stampId, stampBitmap)
				customStampBitmapRef.current = stampBitmap
				activeBrushTip.current = stampBitmap
				activePresetIdRef.current = stampId
				setRuntimeSelectedPresetId(stampId)
				setRuntimeCustomStampPreset({ id: stampId, label: stampLabel })
				setRuntimeStampShapeMode('auto')
				new Notice('Captured selection as brush stamp.')
			} catch (error) {
				console.warn('[KritaBrush] failed capturing selected shape as stamp', error)
				new Notice('Failed to capture selected shape as stamp.')
			}
		})()
	}, [editor, setRuntimeStampShapeMode, userSettings.handwritingRecognition])

	const kritaBrushRuntimeContext = React.useMemo<KritaBrushRuntimeContextValue>(
		() => ({
			brushTipCache: brushTipCache as React.RefObject<Map<string, ImageBitmap>>,
			activeBrushTip: activeBrushTip as React.RefObject<ImageBitmap | null>,
			activeBrushProfile: activeBrushProfile as React.RefObject<BrushProfile | null>,
			activeStampShapeMode: activeStampShapeMode as React.RefObject<'auto' | 'circle' | 'rectangle'>,
			selectedPresetId: runtimeSelectedPresetId,
			customStampPreset: runtimeCustomStampPreset,
			committedCanvasRef: committedCanvasRef as React.RefObject<HTMLCanvasElement | null>,
			activeCanvasRef: activeCanvasRef as React.RefObject<HTMLCanvasElement | null>,
			applyPresetSelection: applyKritaPresetSelection,
			activateCustomStamp,
			setStampShapeMode: setRuntimeStampShapeMode,
			captureSelectedShapeAsStamp,
		}),
		[
			activateCustomStamp,
			applyKritaPresetSelection,
			captureSelectedShapeAsStamp,
			runtimeCustomStampPreset,
			runtimeSelectedPresetId,
			setRuntimeStampShapeMode,
		]
	)

	// Sync active brush tip to module-level ref for use by pencil renderer
	React.useEffect(() => {
		activeBrushTipRef.current = activeBrushTip.current
	}, [activeBrushTip])

	const clearCanvas = React.useCallback((canvas: HTMLCanvasElement) => {
		const ctx = canvas.getContext('2d')
		if (!ctx) return
		ctx.save()
		ctx.setTransform(1, 0, 0, 1, 0, 0)
		ctx.clearRect(0, 0, canvas.width, canvas.height)
		ctx.restore()
	}, [])

	const toWorldPoint = React.useCallback(
		(screenX: number, screenY: number) => {
			if (!editor) return { x: screenX, y: screenY }
			const cam = editor.getCamera()
			return {
				x: (screenX - cam.x) / cam.z,
				y: (screenY - cam.y) / cam.z,
			}
		},
		[editor]
	)

	const getCurrentCanvasMarkdownPath = React.useCallback((): string | undefined => {
		const current = plugin.app.workspace.getActiveFile()
		if (!current?.path?.endsWith('.md')) return undefined
		return current.path
	}, [plugin])

	const clearCommittedCanvas = React.useCallback(() => {
		const canvas = committedCanvasRef.current
		if (!canvas) return
		clearCanvas(canvas)
	}, [clearCanvas])

	const removeCurrentSidecarFiles = React.useCallback(async () => {
		const markdownPath = getCurrentCanvasMarkdownPath()
		if (!markdownPath) return
		const pngPath = markdownPath.replace(/\.md$/i, '.krita-strokes.png')
		const jpgPath = markdownPath.replace(/\.md$/i, '.krita-strokes.jpg')

		for (const path of [pngPath, jpgPath]) {
			try {
				const exists = await plugin.app.vault.adapter.exists(path)
				if (exists) await plugin.app.vault.adapter.remove(path)
			} catch (error) {
				console.warn('[KritaBrush] failed removing sidecar', { path, error })
			}
		}
	}, [getCurrentCanvasMarkdownPath, plugin])

	const scheduleCommittedCanvasSave = React.useCallback(() => {
		if (saveTimeoutRef.current) {
			clearTimeout(saveTimeoutRef.current)
		}

		saveTimeoutRef.current = setTimeout(async () => {
			const markdownPath = getCurrentCanvasMarkdownPath()
			const canvas = committedCanvasRef.current
			if (!markdownPath || !canvas) return

			const shouldUseJpeg = canvas.width > 4096 || canvas.height > 4096
			const path = markdownPath.replace(
				/\.md$/i,
				shouldUseJpeg ? '.krita-strokes.jpg' : '.krita-strokes.png'
			)
			const format = shouldUseJpeg ? 'image/jpeg' : 'image/png'
			if (shouldUseJpeg) {
				console.warn('[KritaBrush] saving sidecar as JPEG due to large canvas dimensions', {
					width: canvas.width,
					height: canvas.height,
				})
			}

			try {
				const dataUrl = shouldUseJpeg
					? canvas.toDataURL(format, 0.92)
					: canvas.toDataURL(format)
				const base64 = dataUrl.split(',')[1]
				if (!base64) return
				const binary = atob(base64)
				const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
				const binaryBuffer = bytes.buffer.slice(
					bytes.byteOffset,
					bytes.byteOffset + bytes.byteLength
				)
				await plugin.app.vault.adapter.writeBinary(path, binaryBuffer)

				const stalePath = markdownPath.replace(
					/\.md$/i,
					shouldUseJpeg ? '.krita-strokes.png' : '.krita-strokes.jpg'
				)
				try {
					const staleExists = await plugin.app.vault.adapter.exists(stalePath)
					if (staleExists) await plugin.app.vault.adapter.remove(stalePath)
				} catch {
					// Best effort only.
				}
			} catch (error) {
				console.warn('[KritaBrush] failed writing sidecar', { path, error })
			}
		}, 2000)
	}, [getCurrentCanvasMarkdownPath, plugin])

	const stampDab = React.useCallback(
		(ctx: CanvasRenderingContext2D, x: number, y: number, pressure: number) => {
			const profile = activeBrushProfile.current
			if (!profile) return
			const tip = activeBrushTip.current
			const debugRectangleStampEnabled = userSettings.debugLogs?.pencilRectangleStamp ?? false
			const stampShapeMode = activeStampShapeMode.current

			const safePressure = Math.max(pressure, 0.01)
			const size = profile.baseSize * Math.pow(safePressure, profile.sizeCurveExponent)
			const opacity = profile.baseOpacity * Math.pow(safePressure, profile.opacityCurveExponent)
			const angle = profile.rotationJitter * (Math.random() - 0.5) * 2 * Math.PI

			ctx.save()
			ctx.globalAlpha = Math.min(opacity, 1)
			ctx.translate(x, y)
			ctx.rotate(angle)

			const shouldUseRectangleStamp =
				debugRectangleStampEnabled || stampShapeMode === 'rectangle'
			const shouldUseCircleStamp = stampShapeMode === 'circle'

			if (shouldUseRectangleStamp) {
				ctx.fillStyle = 'rgba(0,0,0,1)'
				ctx.fillRect(-size / 2, -size / 2, size, size)
			} else if (tip && !shouldUseCircleStamp) {
				ctx.drawImage(tip, -size / 2, -size / 2, size, size)
			} else {
				const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size / 2)
				g.addColorStop(0, 'rgba(0,0,0,1)')
				g.addColorStop(1, 'rgba(0,0,0,0)')
				ctx.fillStyle = g
				ctx.beginPath()
				ctx.arc(0, 0, size / 2, 0, Math.PI * 2)
				ctx.fill()
			}

			if (profile.pencilTextureIntensity > 0.05) {
				applyGrainToDab(ctx, 0, 0, size, profile.pencilTextureIntensity)
			}

			ctx.restore()
		},
		[userSettings.debugLogs?.pencilRectangleStamp]
	)

	const onCanvasPointerDownCapture = React.useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (!editor) return
			if (editor.getCurrentToolId() !== 'pencil') return
			if (!activeBrushProfile.current) return
			if (e.button !== 0) return

			const target = e.target as HTMLElement | null
			if (
				target?.closest(
					'.ptl-krita-brush-panel, .ptl-handwriting-search-panel, .ptl-youtube-playlist-panel, .ptl-youtube-custom-controls, .ptl-handwriting-predict-button, .ptl-krita-test-rect-button, .ptl-embed-pin-button, .ptl-anchor-sticker-overlay, .ptl-capture-stamp-button, .ptl-handwriting-batch-text-overlay, .tlui-toolbar, .tlui-menu, .tlui-style-panel'
				)
			) {
				return
			}

			activePointerIdRef.current = e.pointerId
			e.currentTarget.setPointerCapture(e.pointerId)

			const activeCanvas = activeCanvasRef.current
			if (!activeCanvas) return
			clearCanvas(activeCanvas)

			isDrawingRef.current = true
			const world = toWorldPoint(e.nativeEvent.offsetX, e.nativeEvent.offsetY)
			lastDabXRef.current = world.x
			lastDabYRef.current = world.y
			lastPressureRef.current = e.pressure || 0.5
			lastTimestampRef.current = e.timeStamp
			remainderDistRef.current = 0
		},
		[clearCanvas, editor, toWorldPoint]
	)

	const onCanvasPointerMoveCapture = React.useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (!editor) return
			if (editor.getCurrentToolId() !== 'pencil') return
			if (!isDrawingRef.current || activePointerIdRef.current !== e.pointerId) return

			const profile = activeBrushProfile.current
			const activeCanvas = activeCanvasRef.current
			if (!profile || !activeCanvas) return

			const activeCtx = activeCanvas.getContext('2d')
			if (!activeCtx) return

			const world = toWorldPoint(e.nativeEvent.offsetX, e.nativeEvent.offsetY)
			const x = world.x
			const y = world.y
			const p = e.pressure || 0.5

			let spacing = profile.baseSize * profile.spacingFactor
			spacing = Math.max(spacing, 1)

			const dx = x - lastDabXRef.current
			const dy = y - lastDabYRef.current
			const rawDist = Math.hypot(dx, dy)
			if (rawDist === 0) {
				lastPressureRef.current = p
				lastTimestampRef.current = e.timeStamp
				return
			}

			let totalDist = rawDist + remainderDistRef.current
			let travelled = spacing - remainderDistRef.current

			while (totalDist >= spacing) {
				const t = Math.max(0, Math.min(1, travelled / rawDist))
				const dabX = lastDabXRef.current + dx * t
				const dabY = lastDabYRef.current + dy * t
				const dabP = lastPressureRef.current + (p - lastPressureRef.current) * t
				stampDab(activeCtx, dabX, dabY, dabP)
				totalDist -= spacing
				travelled += spacing
			}

			remainderDistRef.current = totalDist
			lastDabXRef.current = x
			lastDabYRef.current = y
			lastPressureRef.current = p
			lastTimestampRef.current = e.timeStamp
		},
		[editor, stampDab, toWorldPoint]
	)

	const onCanvasPointerUpCapture = React.useCallback(
		(e: React.PointerEvent<HTMLDivElement>) => {
			if (!editor) return
			if (editor.getCurrentToolId() !== 'pencil') return
			const shouldRelease = e.currentTarget.hasPointerCapture?.(e.pointerId)
			if (shouldRelease) {
				e.currentTarget.releasePointerCapture(e.pointerId)
			}
			if (activePointerIdRef.current !== e.pointerId) return

			isDrawingRef.current = false
			activePointerIdRef.current = null

			const committedCanvas = committedCanvasRef.current
			const activeCanvas = activeCanvasRef.current
			if (committedCanvas && activeCanvas) {
				const committedCtx = committedCanvas.getContext('2d')
				if (committedCtx) {
					const dpr = window.devicePixelRatio || 1
					const cssWidth = activeCanvas.width / dpr
					const cssHeight = activeCanvas.height / dpr
					committedCtx.drawImage(
						activeCanvas,
						0,
						0,
						activeCanvas.width,
						activeCanvas.height,
						0,
						0,
						cssWidth,
						cssHeight
					)
				}
				clearCanvas(activeCanvas)
				scheduleCommittedCanvasSave()
			}

			// Keep draw-shape opacity unchanged so strokes remain visible.
			// Hiding vector strokes here can make "registered but invisible" behavior.
		},
		[clearCanvas, editor, scheduleCommittedCanvasSave]
	)

	const onCanvasPointerCancelCapture = React.useCallback((e: React.PointerEvent<HTMLDivElement>) => {
		if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
			e.currentTarget.releasePointerCapture(e.pointerId)
		}
		if (activePointerIdRef.current === e.pointerId) {
			isDrawingRef.current = false
			activePointerIdRef.current = null
		}
	}, [])

	const createCenterInkyRectangleStroke = React.useCallback(() => {
		if (!editor) return

		const viewportCenter = editor.getViewportPageBounds().center
		const center = { x: viewportCenter.x, y: viewportCenter.y }
		const width = 220
		const height = 140
		const brushPx = clampBrushPx(
			userSettings.handwritingRecognition?.pencilBrushSizePx ?? DEFAULT_PENCIL_BRUSH_PX
		)
		const scale = getPencilBrushScale(editor, brushPx)


		const perimeterStep = 12
		const localPoints: Array<{ x: number; y: number; z: number }> = []
		const pushEdgePoints = (x0: number, y0: number, x1: number, y1: number) => {
			const distance = Math.hypot(x1 - x0, y1 - y0)
			const count = Math.max(1, Math.ceil(distance / perimeterStep))
			for (let i = 0; i <= count; i++) {
				const t = i / count
				localPoints.push({
					x: x0 + (x1 - x0) * t,
					y: y0 + (y1 - y0) * t,
					z: 0.9,
				})
			}
		}

		pushEdgePoints(0, 0, width, 0)
		pushEdgePoints(width, 0, width, height)
		pushEdgePoints(width, height, 0, height)
		pushEdgePoints(0, height, 0, 0)

		editor.createShape({
			type: 'draw',
			x: center.x - width / 2,
			y: center.y - height / 2,
			props: {
				segments: [
					{
						type: 'free',
						points: localPoints,
					},
				],
				color: 'black',
				fill: 'none',
				dash: 'draw',
				size: 'm',
				isComplete: true,
				isClosed: false,
				isPen: false,
				scale,
			},
			meta: {
				ptlDebugShape: 'inky-rect',
			},
		} as never)

		console.log('[KritaBrush] created center inky rectangle stroke', {
			centerX: center.x,
			centerY: center.y,
			width,
			height,
			scale,
		})
	}, [editor, userSettings.handwritingRecognition?.pencilBrushSizePx])

	const createCenterRawRectangleStroke = React.useCallback(() => {
		if (!editor) return

		const viewportCenter = editor.getViewportPageBounds().center
		const center = { x: viewportCenter.x, y: viewportCenter.y }
		const width = 220
		const height = 140

		editor.createShape({
			type: 'geo',
			x: center.x - width / 2,
			y: center.y - height / 2,
			props: {
				w: width,
				h: height,
				geo: 'rectangle',
				color: 'black',
				fill: 'none',
				dash: 'solid',
				size: 'm',
			},
			meta: {
				ptlDebugShape: 'raw-geo-rect',
			},
		} as never)

		console.log('[KritaBrush] created center raw geo rectangle', {
			centerX: center.x,
			centerY: center.y,
			width,
			height,
		})
	}, [editor])

	React.useEffect(() => {
		const container = editorContainerRef.current
		if (!container) return

		let disposed = false
		let resizeInFlight = false
		let needsAnotherPass = false

		const resizeCanvases = async () => {
			if (resizeInFlight) {
				needsAnotherPass = true
				return
			}

			resizeInFlight = true
			do {
				needsAnotherPass = false
				if (disposed) break

				const committedCanvas = committedCanvasRef.current
				const activeCanvas = activeCanvasRef.current
				if (!committedCanvas || !activeCanvas) break

				const cssWidth = Math.max(1, container.offsetWidth)
				const cssHeight = Math.max(1, container.offsetHeight)
				const dpr = window.devicePixelRatio || 1
				const pixelWidth = Math.max(1, Math.floor(cssWidth * dpr))
				const pixelHeight = Math.max(1, Math.floor(cssHeight * dpr))

				let snapshot: ImageBitmap | null = null
				if (committedCanvas.width > 0 && committedCanvas.height > 0) {
					try {
						snapshot = await createImageBitmap(committedCanvas)
					} catch {
						snapshot = null
					}
				}

				for (const canvas of [committedCanvas, activeCanvas]) {
					canvas.width = pixelWidth
					canvas.height = pixelHeight
					const ctx = canvas.getContext('2d')
					if (!ctx) continue
					ctx.setTransform(1, 0, 0, 1, 0, 0)
					ctx.clearRect(0, 0, canvas.width, canvas.height)
					ctx.scale(dpr, dpr)
				}

				if (snapshot) {
					const committedCtx = committedCanvas.getContext('2d')
					if (committedCtx) {
						committedCtx.drawImage(snapshot, 0, 0, cssWidth, cssHeight)
					}
					snapshot.close()
				}
			} while (needsAnotherPass && !disposed)

			resizeInFlight = false
		}

		const observer = new ResizeObserver(() => {
			void resizeCanvases()
		})

		observer.observe(container)
		void resizeCanvases()

		return () => {
			disposed = true
			observer.disconnect()
		}
	}, [])

	React.useEffect(() => {
		if (!editor) return

		const applyCameraTransform = () => {
			const cam = editor.getCamera()
			for (const canvas of [committedCanvasRef.current, activeCanvasRef.current]) {
				if (!canvas) continue
				canvas.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`
				canvas.style.transformOrigin = '0 0'
			}
			// TODO: re-rasterize at new zoom for sharpness (future work)
		}

		applyCameraTransform()
		editor.on('change', applyCameraTransform)
		return () => {
			editor.off('change', applyCameraTransform)
		}
	}, [editor])

	React.useEffect(() => {
		let disposed = false

		const restoreSidecar = async () => {
			const canvas = committedCanvasRef.current
			if (!canvas) return
			const markdownPath = getCurrentCanvasMarkdownPath()
			if (!markdownPath) return

			const pngPath = markdownPath.replace(/\.md$/i, '.krita-strokes.png')
			const jpgPath = markdownPath.replace(/\.md$/i, '.krita-strokes.jpg')
			const path = (await plugin.app.vault.adapter.exists(pngPath))
				? pngPath
				: (await plugin.app.vault.adapter.exists(jpgPath))
					? jpgPath
					: undefined
			if (!path || disposed) return

			try {
				const bytes = await plugin.app.vault.adapter.readBinary(path)
				if (disposed) return
				const mimeType = path.endsWith('.jpg') ? 'image/jpeg' : 'image/png'
				const blob = new Blob([bytes], { type: mimeType })
				const bitmap = await createImageBitmap(blob)
				if (disposed) {
					bitmap.close()
					return
				}

				const ctx = canvas.getContext('2d')
				if (ctx) {
					const dpr = window.devicePixelRatio || 1
					const cssWidth = canvas.width / dpr
					const cssHeight = canvas.height / dpr
					ctx.drawImage(bitmap, 0, 0, cssWidth, cssHeight)
				}
				bitmap.close()
			} catch (error) {
				console.warn('[KritaBrush] failed restoring sidecar', { path, error })
			}
		}

		void restoreSidecar()

		return () => {
			disposed = true
		}
	}, [editor, getCurrentCanvasMarkdownPath, handwritingDocumentId, plugin])

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

			// Playlist links are always treated as embeds so they can be auto-imported.
			const isPlaylistLink = isYoutubePlaylistUrl(parsed.toString())

			let choice: 'iframe' | 'text' | 'cancel' = 'iframe'
			if (!isPlaylistLink) {
				choice = await requestUrlPasteChoice(parsed.toString(), point)
				if (choice === 'cancel') return
			}

			if (choice === 'text') {
				return editor.putExternalContent({ type: 'text', text: parsed.toString(), point })
			}

			const embedUtil = editor.getShapeUtil('embed') as unknown as
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
							(candidate): candidate is TLEmbedShape =>
								candidate.type === 'embed' &&
								typeof (candidate.props as { url?: unknown }).url === 'string' &&
								(candidate.props as { url: string }).url === embedInfo.url
						)
					shape = matches.at(-1) ?? null
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
				setPlaylistStatus(undefined)
				return
			}

			const selectedEmbedProps = selected.props as { url?: unknown }
			const url = typeof selectedEmbedProps.url === 'string' ? selectedEmbedProps.url : ''
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
			setPlaylistUrlInput(url)
		}

		syncSelectedYoutubeEmbed()
		const intervalId = window.setInterval(syncSelectedYoutubeEmbed, 250)
		return () => window.clearInterval(intervalId)
	}, [editor])

	React.useEffect(() => {
		if (!selectedYoutubeEmbed) {
			setIsPlaylistPanelOpen(false)
			setPlaylistHoverPreview(null)
			setPlaylistSearchQuery('')
			setEmbedPinToCamera(null)
			return
		}

		// Auto-open the sidebar when a playlist embed is selected.
		if (selectedYoutubeEmbed.playlistId) {
			setIsPlaylistPanelOpen(true)
		}
	}, [selectedYoutubeEmbed])

	React.useEffect(() => {
		if (!selectedYoutubeEmbed) return
		const intervalId = window.setInterval(() => {
			setOverlayRenderTick((tick) => tick + 1)
		}, 80)
		return () => window.clearInterval(intervalId)
	}, [selectedYoutubeEmbed])

	React.useEffect(() => {
		if (!editor || !embedPinToCamera) return

		const intervalId = window.setInterval(() => {
			const shape = editor.getShape(embedPinToCamera.shapeId)
			if (!shape || shape.type !== 'embed') {
				setEmbedPinToCamera(null)
				return
			}

			const containerRect = editor.getContainer().getBoundingClientRect()
			const targetPagePoint = editor.screenToPage({
				x: containerRect.left + embedPinToCamera.viewportX,
				y: containerRect.top + embedPinToCamera.viewportY,
			})

			const dx = Math.abs(shape.x - targetPagePoint.x)
			const dy = Math.abs(shape.y - targetPagePoint.y)
			if (dx < 0.5 && dy < 0.5) return

			editor.updateShapes([
				{
					id: shape.id,
					type: 'embed',
					x: targetPagePoint.x,
					y: targetPagePoint.y,
				},
			])
		}, 33)

		return () => window.clearInterval(intervalId)
	}, [editor, embedPinToCamera])

	React.useEffect(() => {
		if (!selectedYoutubeEmbed) return
		if (playlistEntriesByShapeId[selectedYoutubeEmbed.shapeId]) return

		const storageKey = buildPlaylistStorageKey(handwritingDocumentId, selectedYoutubeEmbed.shapeId)
		let nextEntries: YoutubePlaylistEntry[] = []
		try {
			const raw = window.localStorage.getItem(storageKey)
			if (raw) {
				const parsed = JSON.parse(raw)
				if (Array.isArray(parsed)) {
					nextEntries = parsed
						.map((entry): YoutubePlaylistEntry | undefined => {
							if (typeof entry === 'string') {
								return { url: entry }
							}
							if (!entry || typeof entry !== 'object') return
							const candidateUrl = (entry as { url?: unknown }).url
							if (typeof candidateUrl !== 'string' || candidateUrl.trim().length === 0) return
							const candidateTitle = (entry as { title?: unknown }).title
							return {
								url: candidateUrl,
								title: typeof candidateTitle === 'string' ? candidateTitle : undefined,
							}
						})
						.filter((entry): entry is YoutubePlaylistEntry => !!entry)
				}
			}
		} catch {
			nextEntries = []
		}

		if (nextEntries.length === 0 && selectedYoutubeEmbed.videoId) {
			nextEntries = [{
				url: buildYoutubeWatchUrl(selectedYoutubeEmbed.videoId, selectedYoutubeEmbed.playlistId),
			}]
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

			const lastOpenedKey = buildPlaylistLastOpenedStorageKey(
				handwritingDocumentId,
				selectedYoutubeEmbed.shapeId
			)
			window.localStorage.setItem(lastOpenedKey, nextUrl)

			editor.setSelectedShapes([selectedYoutubeEmbed.shapeId])
			editor.setEditingShape(selectedYoutubeEmbed.shapeId)
		},
		[editor, handwritingDocumentId, selectedYoutubeEmbed]
	)

	const importYoutubePlaylistFromUrl = React.useCallback(
		async (playlistSourceUrl: string) => {
			if (!selectedYoutubeEmbed) return

			const input = playlistSourceUrl.trim()
			if (!input) {
				setPlaylistStatus('Paste a YouTube playlist URL first.')
				return
			}

			setPlaylistLoading(true)
			setPlaylistStatus('Fetching playlist…')

			try {
				const result = await extractYoutubePlaylistVideoIds(input)
				const dedupedByUrl = new Map<string, YoutubePlaylistEntry>()
				for (const video of result.videos) {
					if (!dedupedByUrl.has(video.videoUrl)) {
						dedupedByUrl.set(video.videoUrl, {
							url: video.videoUrl,
							title: video.title,
						})
					}
				}
				const uniqueEntries = Array.from(dedupedByUrl.values())
				const storageKey = buildPlaylistStorageKey(handwritingDocumentId, selectedYoutubeEmbed.shapeId)
				const lastOpenedKey = buildPlaylistLastOpenedStorageKey(
					handwritingDocumentId,
					selectedYoutubeEmbed.shapeId
				)
				const lastOpenedUrl = window.localStorage.getItem(lastOpenedKey) ?? undefined

				window.localStorage.setItem(storageKey, JSON.stringify(uniqueEntries))
				setPlaylistEntriesByShapeId((current) => ({
					...current,
					[selectedYoutubeEmbed.shapeId]: uniqueEntries,
				}))

				const preferredUrl =
					lastOpenedUrl && uniqueEntries.some((entry) => entry.url === lastOpenedUrl)
						? lastOpenedUrl
						: uniqueEntries[0]?.url
				if (preferredUrl) {
					updateYoutubeEmbedVideo(preferredUrl)
				}
				setPlaylistStatus(
					uniqueEntries.length > 0
						? `Loaded ${uniqueEntries.length} videos from playlist ${result.playlistId}.`
						: 'Playlist loaded, but no videos were found.'
				)
			} catch (error) {
				console.error('[YouTube playlist] import failed', error)
				setPlaylistStatus(`Could not load playlist: ${String(error)}`)
			}
			setPlaylistLoading(false)
		},
		[handwritingDocumentId, selectedYoutubeEmbed, updateYoutubeEmbedVideo]
	)

	const refreshSelectedPlaylist = React.useCallback(() => {
		if (!selectedYoutubeEmbed) return
		void importYoutubePlaylistFromUrl(playlistUrlInput || selectedYoutubeEmbed.url)
	}, [importYoutubePlaylistFromUrl, playlistUrlInput, selectedYoutubeEmbed])

	const selectedYoutubeIds = React.useMemo(() => {
		if (!selectedYoutubeEmbed) return {}
		return parseYoutubeIds(selectedYoutubeEmbed.url)
	}, [selectedYoutubeEmbed])

	const filteredPlaylistEntries = React.useMemo(() => {
		if (!selectedYoutubeEmbed) return [] as YoutubePlaylistEntry[]
		const allEntries = playlistEntriesByShapeId[selectedYoutubeEmbed.shapeId] ?? []
		const query = playlistSearchQuery.trim().toLowerCase()
		if (!query) return allEntries

		return allEntries.filter((entry) => {
			const ids = parseYoutubeIds(entry.url)
			const label = entry.title?.trim() || ids.videoId || ''
			return (
				label.toLowerCase().includes(query) ||
				(ids.videoId ?? '').toLowerCase().includes(query) ||
				entry.url.toLowerCase().includes(query)
			)
		})
	}, [playlistEntriesByShapeId, playlistSearchQuery, selectedYoutubeEmbed])

	const selectedEmbedPinButtonPosition = React.useMemo(() => {
		if (!editor || !selectedYoutubeEmbed) return null
		const shape = editor.getShape(selectedYoutubeEmbed.shapeId)
		if (!shape || shape.type !== 'embed') return null

		const shapeWithSize = shape as { x: number; y: number; props?: { w?: number; h?: number } }
		const width =
			typeof shapeWithSize.props?.w === 'number' && Number.isFinite(shapeWithSize.props.w)
				? shapeWithSize.props.w
				: 320
		const viewportTopRight = editor.pageToViewport({
			x: shapeWithSize.x + width,
			y: shapeWithSize.y,
		})

		return {
			left: viewportTopRight.x + 8,
			top: viewportTopRight.y - 6,
			isPinned: embedPinToCamera?.shapeId === selectedYoutubeEmbed.shapeId,
		}
	}, [editor, embedPinToCamera, overlayRenderTick, selectedYoutubeEmbed])

	const youtubeControlsOverlayPosition = React.useMemo((): YoutubeControlsOverlayPosition | null => {
		if (!editor || !selectedYoutubeEmbed?.videoId) return null
		const shape = editor.getShape(selectedYoutubeEmbed.shapeId)
		if (!shape || shape.type !== 'embed') return null

		const { w, h } = getEmbedPageSize(shape)
		const topLeft = editor.pageToViewport({ x: shape.x, y: shape.y })
		const bottomRight = editor.pageToViewport({ x: shape.x + w, y: shape.y + h })
		const viewportWidth = Math.max(120, bottomRight.x - topLeft.x)
		const viewportHeight = Math.max(80, bottomRight.y - topLeft.y)
		const horizontalPadding = 12
		const availableWidth = Math.max(90, viewportWidth - horizontalPadding)
		const baseWidth = Math.max(220, Math.min(620, availableWidth))
		const scaleByWidth = availableWidth / baseWidth
		const scaleByHeight = Math.max(0.45, Math.min(1, viewportHeight / 52))
		const scale = Math.max(0.45, Math.min(1, Math.min(scaleByWidth, scaleByHeight)))
		const visualHeight = 44 * scale
		return {
			left: topLeft.x + 6,
			top: topLeft.y + Math.max(2, viewportHeight - visualHeight - 4),
			width: baseWidth,
			scale,
		}
	}, [editor, overlayRenderTick, selectedYoutubeEmbed])

	React.useEffect(() => {
		if (!editor || !selectedYoutubeEmbed) return
		const shape = editor.getShape(selectedYoutubeEmbed.shapeId)
		if (!shape || shape.type !== 'embed') return

		const currentUrl = (shape.props as { url?: string }).url
		if (typeof currentUrl !== 'string' || !currentUrl) return

		const ids = parseYoutubeIds(currentUrl)
		if (!ids.videoId) return

		const nextUrl = buildYoutubeApiEmbedUrl(currentUrl)
		if (nextUrl === currentUrl) return

		editor.updateShapes([
			{
				id: shape.id,
				type: 'embed',
				props: { url: nextUrl },
			},
		])
	}, [editor, selectedYoutubeEmbed])

	React.useEffect(() => {
		if (!editor || !selectedYoutubeEmbed?.videoId) {
			youtubeIframeRef.current = null
			return
		}

		const shape = editor.getShape(selectedYoutubeEmbed.shapeId)
		if (!shape || shape.type !== 'embed') {
			youtubeIframeRef.current = null
			return
		}

		const { w, h } = getEmbedPageSize(shape)
		const topLeft = editor.pageToViewport({ x: shape.x, y: shape.y })
		const bottomRight = editor.pageToViewport({ x: shape.x + w, y: shape.y + h })
		const centerX = (topLeft.x + bottomRight.x) / 2
		const centerY = (topLeft.y + bottomRight.y) / 2
		const iframes = editor.getContainer().querySelectorAll<HTMLIFrameElement>('iframe')

		let best: HTMLIFrameElement | null = null
		let bestDistance = Number.POSITIVE_INFINITY
		for (const iframe of Array.from(iframes)) {
			if (!iframe.src.includes('/embed/')) continue
			if (!iframe.src.includes(selectedYoutubeEmbed.videoId)) continue
			const rect = iframe.getBoundingClientRect()
			const dx = centerX - (rect.left + rect.width / 2)
			const dy = centerY - (rect.top + rect.height / 2)
			const distance = Math.hypot(dx, dy)
			if (distance < bestDistance) {
				bestDistance = distance
				best = iframe
			}
		}

		youtubeIframeRef.current = best
	}, [editor, overlayRenderTick, selectedYoutubeEmbed])

	const postYoutubeCommand = React.useCallback((func: string, args: unknown[] = []) => {
		const iframe = youtubeIframeRef.current
		if (!iframe?.contentWindow) return
		iframe.contentWindow.postMessage(
			JSON.stringify({
				event: 'command',
				func,
				args,
			}),
			'*'
		)
	}, [])

	React.useEffect(() => {
		if (!selectedYoutubeEmbed?.videoId) return

		const onMessage = (event: MessageEvent) => {
			const iframe = youtubeIframeRef.current
			if (!iframe?.contentWindow || event.source !== iframe.contentWindow) return

			let payload: unknown
			if (typeof event.data === 'string') {
				try {
					payload = JSON.parse(event.data)
				} catch {
					return
				}
			} else {
				payload = event.data
			}

			const data = payload as {
				event?: string
				info?: {
					currentTime?: number
					duration?: number
					playerState?: number
					muted?: boolean
					playbackRate?: number
					availablePlaybackRates?: number[]
					videoData?: { title?: string }
				}
			}

			if (data.event !== 'infoDelivery' || !data.info) return

			setYoutubePlayerHud((current) => ({
				currentTime:
					typeof data.info?.currentTime === 'number' ? data.info.currentTime : current.currentTime,
				duration: typeof data.info?.duration === 'number' ? data.info.duration : current.duration,
				playerState:
					typeof data.info?.playerState === 'number' ? data.info.playerState : current.playerState,
				title: data.info?.videoData?.title ?? current.title,
				muted: typeof data.info?.muted === 'boolean' ? data.info.muted : current.muted,
				playbackRate:
					typeof data.info?.playbackRate === 'number'
						? data.info.playbackRate
						: current.playbackRate,
				availablePlaybackRates:
					Array.isArray(data.info?.availablePlaybackRates) &&
					data.info.availablePlaybackRates.length > 0
						? data.info.availablePlaybackRates.filter(
							(rate): rate is number => typeof rate === 'number' && Number.isFinite(rate) && rate > 0
						)
						: current.availablePlaybackRates,
			}))
		}

		window.addEventListener('message', onMessage)
		const intervalId = window.setInterval(() => {
			const iframe = youtubeIframeRef.current
			if (!iframe?.contentWindow) return
			iframe.contentWindow.postMessage(JSON.stringify({ event: 'listening' }), '*')
			postYoutubeCommand('addEventListener', ['onStateChange'])
			postYoutubeCommand('getCurrentTime')
			postYoutubeCommand('getDuration')
			postYoutubeCommand('isMuted')
			postYoutubeCommand('getVideoData')
			postYoutubeCommand('getPlaybackRate')
			postYoutubeCommand('getAvailablePlaybackRates')
		}, 350)

		return () => {
			window.removeEventListener('message', onMessage)
			window.clearInterval(intervalId)
		}
	}, [postYoutubeCommand, selectedYoutubeEmbed?.videoId])

	const onYoutubeTogglePlay = React.useCallback(() => {
		if (youtubePlayerHud.playerState === 1) {
			postYoutubeCommand('pauseVideo')
			return
		}
		postYoutubeCommand('playVideo')
	}, [postYoutubeCommand, youtubePlayerHud.playerState])

	const onYoutubeToggleMute = React.useCallback(() => {
		if (youtubePlayerHud.muted) {
			postYoutubeCommand('unMute')
			return
		}
		postYoutubeCommand('mute')
	}, [postYoutubeCommand, youtubePlayerHud.muted])

	const onYoutubeSeek = React.useCallback(
		(fraction: number) => {
			const duration = youtubePlayerHud.duration
			if (!Number.isFinite(duration) || duration <= 0) return
			const targetSeconds = clampUnit(fraction) * duration
			postYoutubeCommand('seekTo', [targetSeconds, true])
		},
		[postYoutubeCommand, youtubePlayerHud.duration]
	)

	const playlistEntriesForSelectedEmbed = React.useMemo(() => {
		if (!selectedYoutubeEmbed) return [] as YoutubePlaylistEntry[]
		return playlistEntriesByShapeId[selectedYoutubeEmbed.shapeId] ?? []
	}, [playlistEntriesByShapeId, selectedYoutubeEmbed])

	const selectedYoutubePlaylistIndex = React.useMemo(() => {
		if (!selectedYoutubeIds.videoId || playlistEntriesForSelectedEmbed.length === 0) return -1
		return playlistEntriesForSelectedEmbed.findIndex((entry) => {
			const ids = parseYoutubeIds(entry.url)
			return ids.videoId === selectedYoutubeIds.videoId
		})
	}, [playlistEntriesForSelectedEmbed, selectedYoutubeIds.videoId])

	const canYoutubeStepPlaylist =
		playlistEntriesForSelectedEmbed.length > 1 || !!selectedYoutubeEmbed?.playlistId
	const youtubePlaybackRates =
		youtubePlayerHud.availablePlaybackRates.length > 0
			? youtubePlayerHud.availablePlaybackRates
			: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]

	const onYoutubePlaylistStep = React.useCallback(
		(direction: 1 | -1) => {
			if (playlistEntriesForSelectedEmbed.length > 0 && selectedYoutubePlaylistIndex >= 0) {
				const count = playlistEntriesForSelectedEmbed.length
				const nextIndex = (selectedYoutubePlaylistIndex + direction + count) % count
				const nextEntry = playlistEntriesForSelectedEmbed[nextIndex]
				if (nextEntry) updateYoutubeEmbedVideo(nextEntry.url)
				return
			}

			if (selectedYoutubeEmbed?.playlistId) {
				postYoutubeCommand(direction > 0 ? 'nextVideo' : 'previousVideo')
			}
		},
		[
			playlistEntriesForSelectedEmbed,
			postYoutubeCommand,
			selectedYoutubeEmbed?.playlistId,
			selectedYoutubePlaylistIndex,
			updateYoutubeEmbedVideo,
		]
	)

	const onYoutubeSetPlaybackRate = React.useCallback(
		(nextRate: number) => {
			if (!Number.isFinite(nextRate) || nextRate <= 0) return
			postYoutubeCommand('setPlaybackRate', [nextRate])
			setYoutubePlayerHud((current) => ({ ...current, playbackRate: nextRate }))
		},
		[postYoutubeCommand]
	)

	const toggleSelectedEmbedPinToCamera = React.useCallback(() => {
		if (!editor || !selectedYoutubeEmbed) return
		if (embedPinToCamera?.shapeId === selectedYoutubeEmbed.shapeId) {
			const shape = editor.getShape(selectedYoutubeEmbed.shapeId)
			if (shape && shape.type === 'embed') {
				editor.updateShapes([
					{
						id: shape.id,
						type: 'embed',
						props: {
							w: embedPinToCamera.originalW,
							h: embedPinToCamera.originalH,
						},
					},
				])
			}
			setEmbedPinToCamera(null)
			return
		}

		const shape = editor.getShape(selectedYoutubeEmbed.shapeId)
		if (!shape || shape.type !== 'embed') return
		const { w, h } = getEmbedPageSize(shape)
		const scale = getEditorViewportScale(editor)
		const viewportPoint = editor.pageToViewport({ x: shape.x, y: shape.y })

		setEmbedPinToCamera({
			shapeId: selectedYoutubeEmbed.shapeId,
			viewportX: viewportPoint.x,
			viewportY: viewportPoint.y,
			screenW: w * scale,
			screenH: h * scale,
			originalW: w,
			originalH: h,
		})
	}, [editor, embedPinToCamera, selectedYoutubeEmbed])

	const loadPlaylistFromInput = React.useCallback(() => {
		if (!selectedYoutubeEmbed) return

		const lines = playlistInput
			.split(/\r?\n/)
			.map((line) => normalizeYoutubeVideoEntry(line))
			.filter((entry): entry is string => !!entry)

		if (lines.length === 0) return

		const unique = Array.from(new Set(lines))
		const entries: YoutubePlaylistEntry[] = unique.map((url) => ({ url }))
		const storageKey = buildPlaylistStorageKey(handwritingDocumentId, selectedYoutubeEmbed.shapeId)
		const lastOpenedKey = buildPlaylistLastOpenedStorageKey(handwritingDocumentId, selectedYoutubeEmbed.shapeId)
		const lastOpenedUrl = window.localStorage.getItem(lastOpenedKey) ?? undefined
		window.localStorage.setItem(storageKey, JSON.stringify(entries))

		setPlaylistEntriesByShapeId((current) => ({
			...current,
			[selectedYoutubeEmbed.shapeId]: entries,
		}))

		const preferredUrl = lastOpenedUrl && unique.includes(lastOpenedUrl) ? lastOpenedUrl : unique[0]
		if (preferredUrl) {
			updateYoutubeEmbedVideo(preferredUrl)
		}
	}, [handwritingDocumentId, playlistInput, selectedYoutubeEmbed, updateYoutubeEmbedVideo])

	React.useEffect(() => {
		if (!selectedYoutubeEmbed) return
		const existingEntries = playlistEntriesByShapeId[selectedYoutubeEmbed.shapeId]
		if (existingEntries && existingEntries.length > 0) return

		const playlistId = getYoutubePlaylistIdFromUrl(selectedYoutubeEmbed.url)
		if (!playlistId) return

		const autoImportKey = `${selectedYoutubeEmbed.shapeId}:${selectedYoutubeEmbed.url}`
		if (playlistAutoImportKeyRef.current === autoImportKey) return
		playlistAutoImportKeyRef.current = autoImportKey

		void importYoutubePlaylistFromUrl(selectedYoutubeEmbed.url)
	}, [
		importYoutubePlaylistFromUrl,
		playlistEntriesByShapeId,
		selectedYoutubeEmbed,
	])

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
	const hasSelectedKritaPreset =
		!!userSettings.handwritingRecognition?.kritaSelectedPresetId || !!runtimeSelectedPresetId
	const isKritaStampShapeOverride = activeStampShapeModeState === 'circle' || activeStampShapeModeState === 'rectangle'
	const useKritaRasterPipeline = hasSelectedKritaPreset || isKritaStampShapeOverride
	const hasSelectedDrawShape = useValue(
		'has selected draw shape',
		() => {
			if (!editor) return false
			return editor.getSelectedShapes().some((shape) => shape.type === 'draw')
		},
		[editor]
	)
	const forceVisibleSelectedDrawDiagnostic = hasSelectedDrawShape

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
		const effectiveDefaultStrokeEnabled = forceVisibleSelectedDrawDiagnostic
			? true
			: useKritaRasterPipeline
				? false
				: pencilDefaultStrokeEnabled
		const effectiveBaseStrokeEnabled = forceVisibleSelectedDrawDiagnostic
			? true
			: useKritaRasterPipeline
				? false
				: pencilBaseStrokeEnabled
		const effectiveSampledOverlayEnabled = forceVisibleSelectedDrawDiagnostic
			? false
			: useKritaRasterPipeline
				? true
				: pencilSampledOverlayEnabled
		const effectiveFallbackStylingEnabled = forceVisibleSelectedDrawDiagnostic
			? true
			: useKritaRasterPipeline
				? false
				: pencilFallbackStylingEnabled

		setPencilDefaultStrokeEnabled(effectiveDefaultStrokeEnabled)
		setPencilBaseStrokeEnabled(effectiveBaseStrokeEnabled)
		setPencilSampledOverlayEnabled(effectiveSampledOverlayEnabled)
		setPencilFallbackStylingEnabled(effectiveFallbackStylingEnabled)
		// Apply all renderer toggles first, then invalidate once.
		console.log('[TldrawApp] Pencil renderer toggles updated', {
			forceVisibleSelectedDrawDiagnostic,
			hasSelectedDrawShape,
			useKritaRasterPipeline,
			pencilDefaultStrokeEnabled,
			pencilBaseStrokeEnabled,
			pencilSampledOverlayEnabled,
			pencilFallbackStylingEnabled,
			effectiveDefaultStrokeEnabled,
			effectiveBaseStrokeEnabled,
			effectiveSampledOverlayEnabled,
			effectiveFallbackStylingEnabled,
		})
		console.log('[TldrawApp] Pencil fallback styling toggled:', effectiveFallbackStylingEnabled)
		invalidateDrawShapeCache()
	}, [
		activeStampShapeModeState,
		forceVisibleSelectedDrawDiagnostic,
		hasSelectedKritaPreset,
		hasSelectedDrawShape,
		pencilBaseStrokeEnabled,
		pencilDefaultStrokeEnabled,
		pencilFallbackStylingEnabled,
		useKritaRasterPipeline,
		pencilSampledOverlayEnabled,
		runtimeSelectedPresetId,
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
			parent?: {
				transition: (state: string) => void
			}
			initialShape?: {
				id: TLShapeId
				type: 'draw'
				props?: {
					scale?: number
				}
			}
		}

		const drawingState = editor.getStateDescendant('pencil.drawing') as PencilDrawingStateLike | undefined
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
					const safeOriginalX = typeof originalX === 'number' ? originalX : baseX
					const safeOriginalY = typeof originalY === 'number' ? originalY : baseY
					pressureStore.appendPendingSessionPoint(activeShapeId, {
						x: baseX,
						y: baseY,
						pressure: rawPressure,
						velocityMagnitude: Math.hypot(baseX - safeOriginalX, baseY - safeOriginalY),
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
				drawingState.parent?.transition('idle')
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

			if (editor && userSettings.debugMode) {
				const shape = editor.getShape(result.shapeId)
				if (shape?.type === 'draw') {
					const drawProps = shape.props as TLDrawShape['props']
					const segmentPoints = drawProps.segments.flatMap((segment) => segment.points)
					const zValues = segmentPoints
						.map((point: { z?: number }) => (typeof point.z === 'number' ? point.z : null))
						.filter((value): value is number => value !== null)
					const minZ = zValues.length ? Math.min(...zValues) : 0
					const maxZ = zValues.length ? Math.max(...zValues) : 0
					const meanZ = zValues.length
						? zValues.reduce((sum: number, value: number) => sum + value, 0) / zValues.length
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
						segmentCount: drawProps.segments.length,
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
		(shapeIds: TLShapeId[]) => {
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

			if (payloads.length === 0) {
				clearCommittedCanvas()
				void removeCurrentSidecarFiles()
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
			clearCommittedCanvas,
			handwritingDocumentId,
			removeCurrentSidecarFiles,
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
		(shapeIds: TLShapeId[]) => {
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
		let createdShapeId: TLShapeId | undefined

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
		(shapeIds: TLShapeId[]) => {
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
			if (saveTimeoutRef.current) {
				clearTimeout(saveTimeoutRef.current)
				saveTimeoutRef.current = undefined
			}
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
		plugin.onTriggerCaptureSelectionStamp = () => {
			captureSelectedShapeAsStamp()
		}
		return () => {
			plugin.onTriggerHandwritingSearch = undefined
			plugin.onTriggerAnchorStickerAssign = undefined
			plugin.onTriggerCaptureSelectionStamp = undefined
		}
	}, [captureSelectedShapeAsStamp, plugin, triggerAnchorStickerAssign])

	const anchorStickerOverlays = React.useMemo<AnchorStickerOverlay[]>(() => {
		if (!editor) return []
		return getDocumentAnchorStickers(handwritingDocumentId)
			.map((sticker) => {
					const shapeId = sticker.shapeId as TLShapeId
					const shape = editor.getShape(shapeId)
				if (!shape) return null
				const viewportPoint = editor.pageToViewport({ x: shape.x, y: shape.y })
				return {
						shapeId,
					targetPath: sticker.targetPath,
					targetDisplay: sticker.targetDisplay,
					targetWikilink: sticker.targetWikilink,
					left: viewportPoint.x,
					top: viewportPoint.y,
				}
			})
			.filter((overlay): overlay is AnchorStickerOverlay => overlay !== null)
	}, [editor, handwritingDocumentId, overlayRenderTick])

	const captureStampButtonOverlay = useValue(
		'capture-stamp-button-overlay',
		() => {
			if (!editor) return null
			const selectionBounds = editor.getSelectionRotatedPageBounds()
			if (!selectionBounds) return null

			const center = editor.pageToViewport(selectionBounds.center)
			return {
				left: center.x,
				top: center.y - selectionBounds.height / 2 - 48,
			}
		},
		[editor]
	)

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
		(shapeId: TLShapeId) => {
			if (!editor) return
			editor.deleteShape(shapeId)
			setOverlayRenderTick((tick) => tick + 1)
		},
		[editor]
	)

	const onAnchorStickerContextMenu = React.useCallback(
		(event: React.MouseEvent<HTMLButtonElement>, shapeId: TLShapeId) => {
			event.preventDefault()
			event.stopPropagation()

			const menu = new Menu()
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

		keydownTarget.addEventListener('keydown', onKeyDown as EventListener, true)
		return () => {
			keydownTarget.removeEventListener('keydown', onKeyDown as EventListener, true)
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
		<KritaBrushRuntimeContext.Provider value={kritaBrushRuntimeContext}>
			<div
				className={`tldraw-view-root${userSettings.darkModeInvert ? ' ptl-dark-mode-invert' : ''}${
					pencilScrubHud.active ? ' ptl-pencil-scrubbing' : ''
				}`}
				style={
					pencilScrubHud.active
						? { position: 'relative', cursor: 'col-resize' }
						: { position: 'relative' }
				}
				// e.stopPropagation(); this line should solve the mobile swipe menus bug
				// The bug only happens on the mobile version of Obsidian.
				// When a user tries to interact with the tldraw canvas,
				// Obsidian thinks they're swiping down, left, or right so it opens various menus.
				// By preventing the event from propagating, we can prevent those actions menus from opening.
				onTouchStart={(e) => e.stopPropagation()}
				onPointerDownCapture={onCanvasPointerDownCapture}
				onPointerMoveCapture={onCanvasPointerMoveCapture}
				onPointerUpCapture={onCanvasPointerUpCapture}
				onPointerCancelCapture={onCanvasPointerCancelCapture}
				ref={editorContainerRef}
				onFocus={() => {
					setFocusedEditor(false, editor)
				}}
			>
				<canvas
					ref={committedCanvasRef}
					style={{
						position: 'absolute',
						inset: 0,
						pointerEvents: 'none',
						zIndex: 10,
					}}
				/>
				<canvas
					ref={activeCanvasRef}
					style={{
						position: 'absolute',
						inset: 0,
						pointerEvents: 'none',
						zIndex: 11,
					}}
				/>
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
			{captureStampButtonOverlay ? (
				<button
					type="button"
					className="ptl-capture-stamp-button"
					style={{
						transform: `translate(${captureStampButtonOverlay.left}px, ${captureStampButtonOverlay.top}px)`,
						position: 'absolute',
						padding: '8px 12px',
						backgroundColor: '#007acc',
						color: 'white',
						border: 'none',
						borderRadius: '4px',
						cursor: 'pointer',
						fontSize: '12px',
						fontWeight: 500,
						zIndex: 12,
						whiteSpace: 'nowrap',
					}}
					onClick={() => captureSelectedShapeAsStamp()}
					title="Use selection as brush stamp"
				>
					📌 Use as Stamp
				</button>
			) : null}
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
			<button
				type="button"
				className="ptl-krita-test-rect-button"
				style={{
					top: userSettings.handwritingRecognition?.manualPredictButton ? '84px' : '12px',
				}}
				onClick={createCenterRawRectangleStroke}
				title="Create an erasable raw rectangle stroke at camera center"
			>
				Create Raw Rect Stroke
			</button>
			<button
				type="button"
				className="ptl-krita-test-rect-button"
				style={{
					top: userSettings.handwritingRecognition?.manualPredictButton ? '120px' : '48px',
				}}
				onClick={createCenterInkyRectangleStroke}
				title="Create an erasable inky rectangle stroke at camera center"
			>
				Create Inky Rect Stroke
			</button>
			{selectedYoutubeEmbed ? (
				<button
					type="button"
					className="ptl-handwriting-predict-button"
					style={{ top: userSettings.handwritingRecognition?.manualPredictButton ? '156px' : '84px' }}
					onClick={() => setIsPlaylistPanelOpen((current) => !current)}
				>
					Playlist
				</button>
			) : null}
			{selectedEmbedPinButtonPosition ? (
				<button
					type="button"
					className={`ptl-embed-pin-button${selectedEmbedPinButtonPosition.isPinned ? ' is-pinned' : ''}`}
					style={{
						left: `${selectedEmbedPinButtonPosition.left}px`,
						top: `${selectedEmbedPinButtonPosition.top}px`,
					}}
					onClick={toggleSelectedEmbedPinToCamera}
					title={
						selectedEmbedPinButtonPosition.isPinned
							? 'Unpin from camera'
							: 'Pin to camera'
					}
				>
					{selectedEmbedPinButtonPosition.isPinned ? 'Unpin' : 'Pin'}
				</button>
			) : null}
			{youtubeControlsOverlayPosition && selectedYoutubeEmbed?.videoId ? (
				<div
					className="ptl-youtube-custom-controls"
					style={{
						left: `${youtubeControlsOverlayPosition.left}px`,
						top: `${youtubeControlsOverlayPosition.top}px`,
						width: `${youtubeControlsOverlayPosition.width}px`,
						transform: `scale(${youtubeControlsOverlayPosition.scale})`,
						transformOrigin: 'left top',
					}}
				>
					<button
						type="button"
						className="ptl-youtube-custom-controls-btn"
						onClick={() => onYoutubePlaylistStep(-1)}
						disabled={!canYoutubeStepPlaylist}
						title="Previous video"
					>
						{'<<'}
					</button>
					<button
						type="button"
						className="ptl-youtube-custom-controls-btn"
						onClick={onYoutubeTogglePlay}
						title={youtubePlayerHud.playerState === 1 ? 'Pause' : 'Play'}
					>
						{youtubePlayerHud.playerState === 1 ? 'II' : '>'}
					</button>
					<div
						className="ptl-youtube-custom-controls-track-wrap"
						onMouseLeave={() => setYoutubeScrubPreview(null)}
					>
						<input
							type="range"
							className="ptl-youtube-custom-controls-track"
							min={0}
							max={1000}
							value={Math.round(youtubePlaybackFraction * 1000)}
							onChange={(event) => {
								const nextFraction = Number(event.currentTarget.value) / 1000
								onYoutubeSeek(nextFraction)
							}}
							onMouseMove={(event) => {
								const rect = event.currentTarget.getBoundingClientRect()
								const fraction = clampUnit((event.clientX - rect.left) / rect.width)
								setYoutubeScrubPreview({
									active: true,
									fraction,
									left: fraction * rect.width,
								})
							}}
						/>
						{youtubeScrubPreview?.active ? (
							<div
								className="ptl-youtube-custom-controls-preview"
								style={{ left: `${youtubeScrubPreview.left}px` }}
							>
								{youtubePreviewThumbnailUrl ? (
									<img src={youtubePreviewThumbnailUrl} alt="Preview" />
								) : null}
								<div>{formatYoutubeTime(youtubePreviewTime)}</div>
							</div>
						) : null}
					</div>
					<div className="ptl-youtube-custom-controls-time">
						{formatYoutubeTime(youtubePlayerHud.currentTime)} / {formatYoutubeTime(youtubePlayerHud.duration)}
					</div>
					<button
						type="button"
						className="ptl-youtube-custom-controls-btn"
						onClick={onYoutubeToggleMute}
						title={youtubePlayerHud.muted ? 'Unmute' : 'Mute'}
					>
						{youtubePlayerHud.muted ? 'M' : 'V'}
					</button>
					<button
						type="button"
						className="ptl-youtube-custom-controls-btn"
						onClick={() => onYoutubePlaylistStep(1)}
						disabled={!canYoutubeStepPlaylist}
						title="Next video"
					>
						{'>>'}
					</button>
					<label className="ptl-youtube-custom-controls-speed" title="Playback speed">
						<span>Speed</span>
						<select
							value={youtubePlayerHud.playbackRate}
							onChange={(event) => onYoutubeSetPlaybackRate(Number(event.currentTarget.value))}
						>
							{youtubePlaybackRates.map((rate) => (
								<option key={rate} value={rate}>
									{rate}x
								</option>
							))}
						</select>
					</label>
				</div>
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
					<input
						className="ptl-youtube-playlist-input"
						type="text"
						placeholder="Paste YouTube playlist URL"
						value={playlistUrlInput}
						onChange={(event) => setPlaylistUrlInput(event.currentTarget.value)}
					/>
					<div className="ptl-youtube-playlist-actions">
						<button
							type="button"
							className="ptl-handwriting-search-nav-button"
							onClick={refreshSelectedPlaylist}
							disabled={playlistLoading}
						>
							{playlistLoading ? 'Loading…' : 'Import Playlist'}
						</button>
					</div>
					{playlistStatus ? <div className="ptl-youtube-playlist-status">{playlistStatus}</div> : null}
					<textarea
						className="ptl-youtube-playlist-manual-input"
						placeholder="Manual fallback: paste video URLs or IDs, one per line"
						value={playlistInput}
						onChange={(event) => setPlaylistInput(event.currentTarget.value)}
					/>
					<div className="ptl-youtube-playlist-actions">
						<button
							type="button"
							className="ptl-handwriting-search-nav-button"
							onClick={loadPlaylistFromInput}
							disabled={playlistLoading}
						>
							Load Manual List
						</button>
					</div>
					<input
						className="ptl-youtube-playlist-search-input"
						type="text"
						placeholder="Search videos..."
						value={playlistSearchQuery}
						onChange={(event) => setPlaylistSearchQuery(event.currentTarget.value)}
					/>
					<div className="ptl-youtube-playlist-videos">
						{filteredPlaylistEntries.length === 0 ? (
							<div className="ptl-youtube-playlist-status">No matching videos</div>
						) : null}
						{filteredPlaylistEntries.map((entry, index) => {
							const ids = parseYoutubeIds(entry.url)
							const label = entry.title?.trim() || ids.videoId || 'Video'
							const isActive = !!ids.videoId && ids.videoId === selectedYoutubeIds.videoId
							const thumbnailUrl = buildYoutubeThumbnailUrl(ids.videoId)
							const showHoverPreview = () => {
								if (!thumbnailUrl) return
								setPlaylistHoverPreview((current) => ({
									title: `${index + 1}. ${label}`,
									thumbnailUrl,
									left: current?.left ?? 0,
									top: current?.top ?? 0,
								}))
							}
							const updateHoverPreviewPosition = (event: React.MouseEvent<HTMLButtonElement>) => {
								if (!thumbnailUrl) return
								const previewWidth = 230
								const previewHeight = 170
								const gap = 12
								const viewportPadding = 8

								let nextLeft = event.clientX + gap
								if (nextLeft + previewWidth > window.innerWidth - viewportPadding) {
									nextLeft = event.clientX - previewWidth - gap
								}
								nextLeft = Math.max(viewportPadding, nextLeft)

								const nextTop = Math.max(
									viewportPadding,
									Math.min(event.clientY + gap, window.innerHeight - previewHeight - viewportPadding)
								)
								setPlaylistHoverPreview((current) =>
									current
										? {
											...current,
											left: nextLeft,
											top: nextTop,
									  }
										: {
											title: `${index + 1}. ${label}`,
											thumbnailUrl,
											left: nextLeft,
											top: nextTop,
									  }
								)
							}
							return (
								<button
									type="button"
									key={`${entry.url}-${index}`}
									className={`ptl-youtube-playlist-video${isActive ? ' is-active' : ''}`}
									aria-pressed={isActive}
									onClick={() => {
										setPlaylistHoverPreview(null)
										updateYoutubeEmbedVideo(entry.url)
									}}
									onMouseEnter={(event) => {
										showHoverPreview()
										updateHoverPreviewPosition(event)
									}}
									onMouseMove={updateHoverPreviewPosition}
									onMouseLeave={() => setPlaylistHoverPreview(null)}
								>
									<span className="ptl-youtube-playlist-video-label">
										{index + 1}. {label}
									</span>
								</button>
							)
						})}
					</div>
				</div>
			) : null}
			{playlistHoverPreviewOverlay}
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
		</KritaBrushRuntimeContext.Provider>
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
