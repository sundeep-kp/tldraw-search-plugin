import { Platform } from 'obsidian'
import TldrawPlugin from 'src/main'
import {
	downloadBlob,
	getSaveFileCopyAction,
	getSaveFileCopyInVaultAction,
	importFileAction,
	OPEN_FILE_ACTION,
	SAVE_FILE_COPY_ACTION,
	SAVE_FILE_COPY_IN_VAULT_ACTION,
} from 'src/utils/file'
import {
	Editor,
	TLExportType,
	TLImageExportOptions,
	TLUiActionItem,
	TLUiActionsContextType,
	TLUiEventContextType,
	TLUiEventSource,
	TLUiOverrideHelpers,
	TLUiOverrides,
	useUiEvents,
} from 'tldraw'

const DEFAULT_CAMERA_STEPS = [0.1, 0.25, 0.5, 1, 2, 4, 8]

export const PLUGIN_ACTION_TOGGLE_ZOOM_LOCK = 'toggle-zoom-lock'
export const PLUGIN_ACTION_HANDWRITING_SEARCH = 'handwriting-search'
export const PLUGIN_ACTION_ASSIGN_ANCHOR_STICKER = 'assign-anchor-sticker'
export const PLUGIN_ACTION_OPEN_EMBED_IN_NEW_TAB = 'open-embed-in-new-tab'
export const PLUGIN_ACTION_CAPTURE_SELECTION_STAMP = 'capture-selection-stamp'

export function uiOverrides(plugin: TldrawPlugin): TLUiOverrides {
	const trackEvent = useUiEvents()
	return {
		tools(editor, tools, helpers) {
				tools.pencil = {
					...tools.draw,
					id: 'pencil',
					label: 'tool.draw',
					icon: 'tool-pencil',
					kbd: 'shift+p',
					onSelect(source) {
						editor.setCurrentTool('pencil')
						trackEvent('select-tool', { source, id: 'pencil' })
					},
				}
			return tools
		},
		actions: (editor, actions, { msg, addDialog, addToast, paste }) => {
			const defaultDocumentName = msg('document.default-name')
			if (!Platform.isMobile) {
				actions[SAVE_FILE_COPY_ACTION] = getSaveFileCopyAction(editor, defaultDocumentName)
			}

			actions[SAVE_FILE_COPY_IN_VAULT_ACTION] = getSaveFileCopyInVaultAction(
				editor,
				defaultDocumentName,
				plugin
			)

			actions[OPEN_FILE_ACTION] = importFileAction(plugin, addDialog)

			;(['jpeg', 'png', 'svg', 'webp'] satisfies TLExportType[]).map((e) =>
				exportAllAsOverride(editor, actions, plugin, {
					exportOptions: {
						format: e,
					},
					defaultDocumentName,
					trackEvent,
				})
			)

			actions['paste'] = pasteFromClipboardOverride(editor, { msg, paste, addToast })

			/**
			 * https://tldraw.dev/examples/editor-api/lock-camera-zoom
			 */
			actions[PLUGIN_ACTION_TOGGLE_ZOOM_LOCK] = {
				id: PLUGIN_ACTION_TOGGLE_ZOOM_LOCK,
				label: {
					default: 'Toggle zoom lock',
				},
				icon: PLUGIN_ACTION_TOGGLE_ZOOM_LOCK,
				kbd: '!k',
				readonlyOk: true,
				onSelect() {
					const isCameraZoomLockedAlready = editor.getCameraOptions().zoomSteps.length === 1
					editor.setCameraOptions({
						zoomSteps: isCameraZoomLockedAlready ? DEFAULT_CAMERA_STEPS : [editor.getZoomLevel()],
					})
				},
			}

			actions[PLUGIN_ACTION_HANDWRITING_SEARCH] = {
				id: PLUGIN_ACTION_HANDWRITING_SEARCH,
				label: {
					default: 'Search handwriting',
				},
				icon: 'search',
				kbd: '$f',
				readonlyOk: false,
				onSelect() {
					if (plugin.onTriggerHandwritingSearch) {
						plugin.onTriggerHandwritingSearch()
					}
				},
			}

			actions[PLUGIN_ACTION_ASSIGN_ANCHOR_STICKER] = {
				id: PLUGIN_ACTION_ASSIGN_ANCHOR_STICKER,
				label: {
					default: 'Assign anchor sticker',
				},
				icon: 'link',
				kbd: '$shift+a',
				readonlyOk: false,
				onSelect() {
					plugin.onTriggerAnchorStickerAssign?.()
				},
			}

			actions[PLUGIN_ACTION_OPEN_EMBED_IN_NEW_TAB] = {
				id: PLUGIN_ACTION_OPEN_EMBED_IN_NEW_TAB,
				label: {
					default: 'Open embed URL in new tab',
				},
				icon: 'external-link',
				kbd: '$shift+o',
				readonlyOk: true,
				onSelect() {
					const selectedShape = editor.getOnlySelectedShape()
					if (!selectedShape || selectedShape.type !== 'embed') return

					const url = selectedShape.props?.url
					if (typeof url !== 'string' || url.length === 0) return

					window.open(url, '_blank', 'noopener,noreferrer')
				},
			}

			actions[PLUGIN_ACTION_CAPTURE_SELECTION_STAMP] = {
				id: PLUGIN_ACTION_CAPTURE_SELECTION_STAMP,
				label: {
					default: 'Use selection as brush stamp',
				},
				icon: 'tool-pencil',
				readonlyOk: false,
				disabled() {
					return editor.getSelectedShapeIds().size === 0
				},
				onSelect() {
					plugin.onTriggerCaptureSelectionStamp?.()
				},
			}

			return actions
		},
		// toolbar(editor, toolbar, { tools }) {
		// 	// console.log(toolbar);
		// 	// toolbar.splice(4, 0, toolbarItem(tools.card))
		// 	return toolbar;
		// },
		// keyboardShortcutsMenu(editor, keyboardShortcutsMenu, { tools }) {
		// 	// console.log(keyboardShortcutsMenu);
		// 	// const toolsGroup = keyboardShortcutsMenu.find(
		// 	// 	(group) => group.id === 'shortcuts-dialog.tools'
		// 	// ) as TLUiMenuGroup
		// 	// toolsGroup.children.push(menuItem(tools.card))
		// 	return keyboardShortcutsMenu;
		// },
		// contextMenu(editor, schema, helpers) {
		// 	// console.log({ schema });
		// 	// console.log(JSON.stringify(schema[0]));
		// 	return schema;
		// },
	}
}

function exportAllAsOverride(
	editor: Editor,
	actions: TLUiActionsContextType,
	plugin: TldrawPlugin,
	options: {
		exportOptions?: TLImageExportOptions
		trackEvent: TLUiEventContextType
		defaultDocumentName: string
	}
) {
	const format = options.exportOptions?.format ?? 'png'
	const key = `export-all-as-${format}` as const
	actions[key] = {
		...actions[key],
		async onSelect(source) {
			const ids = Array.from(editor.getCurrentPageShapeIds().values())
			if (ids.length === 0) return

			options.trackEvent('export-all-as', {
				// @ts-ignore
				format,
				source,
			})

			const blob = (await editor.toImage(ids, options.exportOptions)).blob

			const res = await downloadBlob(blob, `${options.defaultDocumentName}.${format}`, plugin)

			if (typeof res === 'object') {
				res.showResultModal()
			}
		},
	}
}

/**
 * Obsidian doesn't allow manual access to the clipboard API on mobile,
 * so we add a fallback when an error occurs on the initial clipboard read.
 */
function pasteFromClipboardOverride(
	editor: Editor,
	{ addToast, msg, paste }: Pick<TLUiOverrideHelpers, 'addToast' | 'msg' | 'paste'>
): TLUiActionItem {
	const pasteClipboard = (source: TLUiEventSource, items: ClipboardItem[]) =>
		paste(items, source, source === 'context-menu' ? editor.inputs.currentPagePoint : undefined)

	return {
		id: 'paste',
		label: 'action.paste',
		kbd: '$v',
		onSelect(source) {
			// Adapted from src/lib/ui/context/actions.tsx of the tldraw library
			navigator.clipboard
				?.read()
				.then((clipboardItems) => {
					pasteClipboard(source, clipboardItems)
				})
				.catch((e) => {
					// Fallback to reading the clipboard as plain text.
					navigator.clipboard
						?.readText()
						.then((val) => {
							pasteClipboard(source, [
								new ClipboardItem({
									'text/plain': new Blob([val], { type: 'text/plain' }),
								}),
							])
						})
						.catch((ee) => {
							console.error({ e, ee })
							addToast({
								title: msg('action.paste-error-title'),
								description: msg('action.paste-error-description'),
								severity: 'error',
							})
						})
				})
		},
	}
}
