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
import { groupNormalizedStrokePayloads } from 'src/handwriting/strokeGrouping'
import {
	acquireDocumentStrokePayloadScope,
	getAllNormalizedStrokePayloads,
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
	type TLDefaultSizeStyle,
	TLComponents,
	Tldraw,
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
	useEditor,
	useIsToolSelected,
	useRelevantStyles,
	useTranslation,
	useActions,
	useTools,
} from 'tldraw'
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

function PluginStylePanel(props: TLUiStylePanelProps) {
	const styles = useRelevantStyles()

	if (!styles) {
		return <DefaultStylePanel isMobile={props.isMobile} />
	}

	return (
		<DefaultStylePanel isMobile={props.isMobile}>
			<>
				<PencilBrushSizeSlider />
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
	const [searchQuery, setSearchQuery] = React.useState('')
	const [selectedSearchResultIndex, setSelectedSearchResultIndex] = React.useState(-1)
	const [activeSearchGroupId, setActiveSearchGroupId] = React.useState<string | undefined>(undefined)
	const searchInputRef = React.useRef<HTMLInputElement>(null)
	const searchPanelRef = React.useRef<HTMLDivElement>(null)
	const searchResultsRef = React.useRef<HTMLDivElement>(null)
	const previousNormalizedSearchQueryRef = React.useRef('')
	const recognizerRef = React.useRef(createHandwritingRecognizer({ engine: 'stub' }))
	const recognitionDebounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const recognitionRunVersionRef = React.useRef(0)
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

		if (userSettings.debugMode) {
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
						if (
							(existing?.fingerprint === fingerprint && existing.status === 'success') ||
							existingByFingerprint?.status === 'success'
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
								if (userSettings.debugMode) {
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

							if (userSettings.debugMode) {
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
							if (userSettings.debugMode) {
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

					if (userSettings.debugMode) {
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

						if (userSettings.debugMode) {
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
		const originalOnExit = drawingState.onExit?.bind(drawingState)

		const scrubState = {
			active: false,
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
			persistBrushPx(scrubState.brushPx)
		}

		drawingState.onEnter = (info: PointerInfoLike) => {
			if (!originalOnEnter) return
			const point = info?.point
			if (!point || typeof point.z !== 'number') {
				originalOnEnter(info)
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

			const brushPx = clampBrushPx(
				userSettings.handwritingRecognition?.pencilBrushSizePx ?? DEFAULT_PENCIL_BRUSH_PX
			)
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

		drawingState.updateDrawingShape = () => {
			const currentPoint = editor.inputs.currentPagePoint as { x: number; y: number; z?: number }
			const isStylusContact = typeof currentPoint?.z === 'number' && currentPoint.z > 0

			// Handle Alt+stylus scrubbing for brush size
			const wasActive = scrubState.active
			if (editor.inputs.altKey && isStylusContact) {
				if (!scrubState.active) {
					scrubState.active = true
					scrubState.anchorX = currentPoint.x
					scrubState.startBrushPx = scrubState.brushPx
				}

				const dx = currentPoint.x - scrubState.anchorX
				scrubState.brushPx = clampBrushPx(
					scrubState.startBrushPx + dx * PENCIL_SCRUB_PX_PER_SCREEN_PIXEL
				)
			} else {
				maybeFinishScrub()
			}

			// Only update shape scale if we're scrubbing (to avoid interfering with normal draw)
			if (scrubState.active || wasActive !== scrubState.active) {
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

			// Apply pressure texture and coordinate jitter, then call original draw logic.
			const point = editor.inputs.currentPagePoint as { x?: number; y?: number; z?: number }
			if (!point || typeof point.z !== 'number') {
				originalUpdateDrawingShape()
				return
			}

			const originalX = point.x
			const originalY = point.y
			const originalZ = point.z
			const baseX = typeof point.x === 'number' ? point.x : currentPoint.x
			const baseY = typeof point.y === 'number' ? point.y : currentPoint.y
			const { dx, dy } = getPencilTextureOffset(
				textureEnabled,
				textureIntensity,
				baseX,
				baseY
			)
			point.x = baseX + dx
			point.y = baseY + dy
			point.z = applyPencilTexturePressure(
				point.z,
				pressureSensitivity,
				textureEnabled,
				textureIntensity,
				baseX,
				baseY
			)
			try {
				originalUpdateDrawingShape()
			} finally {
				point.x = originalX
				point.y = originalY
				point.z = originalZ
			}
		}

		drawingState.onExit = () => {
			maybeFinishScrub()
			originalOnExit?.()
		}

		return () => {
			maybeFinishScrub()
			if (originalOnEnter) {
				drawingState.onEnter = originalOnEnter
			}
			drawingState.updateDrawingShape = originalUpdateDrawingShape
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

	const onStrokeExtracted = React.useCallback(
		(result: StrokeExtractionResult) => {
			const rawPointsCount = result.strokes.reduce((count, segment) => count + segment.length, 0)
			const pressureData = pressureStore.consumePendingSessionForStroke(result.shapeId, rawPointsCount)

			if (userSettings.debugMode && pressureData) {
				console.log('[pencil] mapped pressure session to shape', {
					documentId: handwritingDocumentId,
					shapeId: result.shapeId,
					rawPointsCount,
					pressurePointsCount: pressureData.points.length,
				})
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
			className={`tldraw-view-root${userSettings.darkModeInvert ? ' ptl-dark-mode-invert' : ''}`}
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
			<Tldraw // This component is responsible for rendering the canvas.
				{...storeProps}
				assetUrls={assetUrls.current}
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
