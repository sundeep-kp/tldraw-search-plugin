import { Platform } from 'obsidian'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { lockZoomIcon } from 'src/assets/data-icons'
import { TldrawInObsidianPluginProvider } from 'src/contexts/plugin'
import { useClickAwayListener } from 'src/hooks/useClickAwayListener'
import useUserPluginSettings from 'src/hooks/useUserPluginSettings'
import { DEFAULT_ONLINE_HTR_MODEL_CONFIG } from 'src/handwriting/modelConfig'
import { processExtractedStroke } from 'src/handwriting/pipeline'
import { createHandwritingRecognizer } from 'src/handwriting/recognizer'
import {
	acquireDocumentRecognitionScope,
	getDocumentRecognitionResults,
	getRecognitionResult,
	releaseDocumentRecognitionScope,
	upsertRecognitionResult,
} from 'src/handwriting/recognitionResultsStore'
import { groupNormalizedStrokePayloads } from 'src/handwriting/strokeGrouping'
import {
	acquireDocumentStrokePayloadScope,
	getAllNormalizedStrokePayloads,
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
import { StrokeExtractionResult } from 'src/handwriting/types'
import { useStrokeListener } from 'src/hooks/useStrokeListener'
import { useTldrawAppEffects } from 'src/hooks/useTldrawAppHook'
import TldrawPlugin from 'src/main'
import { PLUGIN_ACTION_TOGGLE_ZOOM_LOCK, uiOverrides } from 'src/tldraw/ui-overrides'
import { TLDataDocumentStore } from 'src/utils/document'
import { PTLEditorBlockBlur } from 'src/utils/dom-attributes'
import {
	OPEN_FILE_ACTION,
	SAVE_FILE_COPY_ACTION,
	SAVE_FILE_COPY_IN_VAULT_ACTION,
} from 'src/utils/file'
import { isObsidianThemeDark } from 'src/utils/utils'
import {
	DefaultMainMenu,
	DefaultMainMenuContent,
	Editor,
	TLComponents,
	Tldraw,
	TldrawEditorStoreProps,
	TldrawUiMenuItem,
	TldrawUiMenuSubmenu,
	TLStateNodeConstructor,
	TLStoreSnapshot,
	TLUiAssetUrlOverrides,
	TLUiEventHandler,
	TLUiOverrides,
	useActions,
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
	KeyboardShortcutsDialog: PluginKeyboardShortcutsDialog,
	QuickActions: PluginQuickActions,
})

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
	const recognizerRef = React.useRef(createHandwritingRecognizer({ engine: 'stub' }))
	const recognitionDebounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
	const recognitionRunVersionRef = React.useRef(0)
	const handwritingDocumentId = React.useMemo(() => {
		if (store && 'plugin' in store && store.plugin) {
			return store.plugin.meta.uuid
		}
		return 'volatile-document'
	}, [store])

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
		return DEFAULT_ONLINE_HTR_MODEL_CONFIG
	}, [])

	const recognizerEngine = React.useMemo(() => {
		const hasModelUrl = typeof onnxModelConfig.modelUrl === 'string' && onnxModelConfig.modelUrl.length > 0
		const hasAlphabet =
			Array.isArray(onnxModelConfig.alphabet) && onnxModelConfig.alphabet.length > 0
		return hasModelUrl && hasAlphabet ? 'onnx-web' : 'stub'
	}, [onnxModelConfig])

	React.useEffect(() => {
		const previousRecognizer = recognizerRef.current
		recognizerRef.current = createHandwritingRecognizer({
			engine: recognizerEngine,
			onnxModelConfig,
		})
		recognitionRunVersionRef.current += 1

		if (userSettings.debugMode) {
			console.log('[handwriting] recognizer engine selected', {
				documentId: handwritingDocumentId,
				engine: recognizerEngine,
				hasModelUrl: onnxModelConfig.modelUrl.length > 0,
				hasAlphabet: onnxModelConfig.alphabet.length > 0,
			})
		}

		void previousRecognizer.dispose()
	}, [handwritingDocumentId, onnxModelConfig, recognizerEngine, userSettings.debugMode])

	const buildGroupFingerprint = React.useCallback((group: StrokeGroupCandidate) => {
		return `${group.id}:${group.endedAt}:${group.shapeIds.join(',')}`
	}, [])

	const scheduleRecognition = React.useCallback(
		(candidates: StrokeGroupCandidate[]) => {
			if (recognitionDebounceTimerRef.current) {
				clearTimeout(recognitionDebounceTimerRef.current)
			}

			recognitionDebounceTimerRef.current = setTimeout(() => {
				const runVersion = ++recognitionRunVersionRef.current
				const runStartedAt = Date.now()

				void (async () => {
					let recognizedCount = 0

					for (const candidate of candidates) {
						const fingerprint = buildGroupFingerprint(candidate)
						const existing = getRecognitionResult(handwritingDocumentId, candidate.id)
						if (existing?.fingerprint === fingerprint && existing.status === 'success') {
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
							recognizedCount += 1
						} catch (error) {
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
						}
					}

					if (userSettings.debugMode) {
						console.log('[handwriting] recognition run complete', {
							documentId: handwritingDocumentId,
							queuedCandidates: candidates.length,
							recognizedCandidates: recognizedCount,
							totalStoredResults: getDocumentRecognitionResults(handwritingDocumentId).length,
							latencyMs: Date.now() - runStartedAt,
						})
					}
				})()
			}, 250)
		},
		[buildGroupFingerprint, handwritingDocumentId, userSettings.debugMode]
	)

	const onStrokeExtracted = React.useCallback(
		(result: StrokeExtractionResult) => {
			const payload = processExtractedStroke(result)
			if (!payload) return

			upsertNormalizedStrokePayload(handwritingDocumentId, payload)
			const payloads = getAllNormalizedStrokePayloads(handwritingDocumentId)
			const groupedCandidates = groupNormalizedStrokePayloads(payloads)
			setDocumentWordCandidates(handwritingDocumentId, groupedCandidates)
			scheduleRecognition(groupedCandidates)

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
					storedWordCandidates: getDocumentWordCandidates(handwritingDocumentId).length,
					bounds: payload.bounds,
					worldBounds: payload.worldBounds,
					scale: payload.scale,
					timestamp: payload.timestamp,
				})

				if (groupedCandidates.length > 0) {
					const latestGroup = groupedCandidates[groupedCandidates.length - 1]
					console.log('[handwriting] grouped stroke candidate', {
						documentId: handwritingDocumentId,
						groupId: latestGroup.id,
						shapeIds: latestGroup.shapeIds,
						boundingBox: latestGroup.boundingBox,
						startedAt: latestGroup.startedAt,
						endedAt: latestGroup.endedAt,
					})
				}
			}
		},
		[handwritingDocumentId, scheduleRecognition, userSettings.debugMode]
	)

	React.useEffect(() => {
		acquireDocumentStrokePayloadScope(handwritingDocumentId)
		acquireDocumentWordCandidateScope(handwritingDocumentId)
		acquireDocumentRecognitionScope(handwritingDocumentId)

		return () => {
			if (recognitionDebounceTimerRef.current) {
				clearTimeout(recognitionDebounceTimerRef.current)
				recognitionDebounceTimerRef.current = undefined
			}
			recognitionRunVersionRef.current += 1

			releaseDocumentStrokePayloadScope(handwritingDocumentId)
			releaseDocumentWordCandidateScope(handwritingDocumentId)
			releaseDocumentRecognitionScope(handwritingDocumentId)
		}
	}, [handwritingDocumentId])

	React.useEffect(() => {
		return () => {
			void recognizerRef.current.dispose()
		}
	}, [])

	useStrokeListener(editor, {
		debug: userSettings.debugMode,
		onStrokeExtracted,
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
			className="tldraw-view-root"
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
