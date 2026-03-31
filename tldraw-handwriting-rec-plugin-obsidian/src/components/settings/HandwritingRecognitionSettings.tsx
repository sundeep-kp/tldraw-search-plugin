import { Dropdown, ExtraButton, Text, Toggle } from '@obsidian-plugin-toolkit/react/components'
import { Group, Setting } from '@obsidian-plugin-toolkit/react/components/setting/group'
import React, { useCallback, useMemo } from 'react'
import useSettingsManager from 'src/hooks/useSettingsManager'
import useUserPluginSettings from 'src/hooks/useUserPluginSettings'
import { isOnlineHtrModelConfigReady, resolveOnlineHtrModelConfig } from 'src/handwriting/modelConfig'
import { DEFAULT_SETTINGS } from 'src/obsidian/TldrawSettingsTab'

function HandwritingRecognitionSettingsGroup() {
	const settingsManager = useSettingsManager()
	const settings = useUserPluginSettings(settingsManager)

	const normalizedConfig = useMemo(() => {
		return resolveOnlineHtrModelConfig(settings.handwritingRecognition)
	}, [settings.handwritingRecognition])

	const updateSettings = useCallback(async () => {
		await settingsManager.updateSettings(settingsManager.settings)
	}, [settingsManager])

	const updateRecognitionField = useCallback(
		async (
			field:
				| 'backend'
				| 'manualPredictButton'
				| 'searchZoomMinSizePx'
				| 'pressureSensitivity'
				| 'pencilTextureIntensity'
				| 'pencilTextureEnabled'
				| 'showRecognizedBatchTextOverlay'
				| 'recognitionDebounceMs'
				| 'strokeGroupingMaxTimeDeltaMs'
				| 'strokeGroupingAdaptiveGapMultiplier'
				| 'modelUrl'
				| 'alphabet'
				| 'inputName'
				| 'outputName'
				| 'blankIndex'
				| 'singleShapeMode'
				| 'allowedCharacters'
				| 'maxOutputChars'
				| 'googleImeLanguage'
				| 'googleImeNumOfWords'
				| 'googleImeNumOfReturn'
				| 'googleImeBatchMaxWidthPx'
				| 'googleImeBatchMaxHeightPx'
				| 'googleImeBatchMaxGroups'
				| 'googleImeBatchMaxStrokes'
				| 'googleImeBatchMaxPoints'
				| 'googleImeBatchBoundaryTimeGapMs'
				| 'googleImeBatchIdleFlushMs'
				| 'googleImeBatchHardMaxAgeMs',
			value: string | number | boolean
		) => {
			const current = settingsManager.settings.handwritingRecognition ?? {}
			settingsManager.settings.handwritingRecognition = {
				...current,
				[field]: value,
			}
			await updateSettings()
		},
		[settingsManager, updateSettings]
	)

	const resetModelField = useCallback(
		async (
			field:
				| 'backend'
				| 'manualPredictButton'
				| 'searchZoomMinSizePx'
				| 'pressureSensitivity'
				| 'pencilTextureIntensity'
				| 'pencilTextureEnabled'
				| 'showRecognizedBatchTextOverlay'
				| 'recognitionDebounceMs'
				| 'strokeGroupingMaxTimeDeltaMs'
				| 'strokeGroupingAdaptiveGapMultiplier'
				| 'modelUrl'
				| 'alphabet'
				| 'inputName'
				| 'outputName'
				| 'blankIndex'
				| 'singleShapeMode'
				| 'allowedCharacters'
				| 'maxOutputChars'
				| 'googleImeLanguage'
				| 'googleImeNumOfWords'
				| 'googleImeNumOfReturn'
				| 'googleImeBatchMaxWidthPx'
				| 'googleImeBatchMaxHeightPx'
				| 'googleImeBatchMaxGroups'
				| 'googleImeBatchMaxStrokes'
				| 'googleImeBatchMaxPoints'
				| 'googleImeBatchBoundaryTimeGapMs'
				| 'googleImeBatchIdleFlushMs'
				| 'googleImeBatchHardMaxAgeMs'
		) => {
			const defaults = DEFAULT_SETTINGS.handwritingRecognition
			const current = settingsManager.settings.handwritingRecognition ?? {}
			settingsManager.settings.handwritingRecognition = {
				...current,
				[field]: defaults[field],
			}
			await updateSettings()
		},
		[settingsManager, updateSettings]
	)

	const onModelUrlChange = useCallback(
		async (value: string) => {
			await updateRecognitionField('modelUrl', value)
		},
		[updateRecognitionField]
	)

	const onAlphabetChange = useCallback(
		async (value: string) => {
			await updateRecognitionField('alphabet', value)
		},
		[updateRecognitionField]
	)

	const onInputNameChange = useCallback(
		async (value: string) => {
			await updateRecognitionField('inputName', value)
		},
		[updateRecognitionField]
	)

	const onOutputNameChange = useCallback(
		async (value: string) => {
			await updateRecognitionField('outputName', value)
		},
		[updateRecognitionField]
	)

	const onBlankIndexChange = useCallback(
		async (value: string) => {
			const parsed = Number.parseInt(value, 10)
			if (Number.isNaN(parsed)) return
			await updateRecognitionField('blankIndex', parsed)
		},
		[updateRecognitionField]
	)

	const onSingleShapeModeChange = useCallback(
		async (value: boolean) => {
			await updateRecognitionField('singleShapeMode', value)
		},
		[updateRecognitionField]
	)

	const onAllowedCharactersChange = useCallback(
		async (value: string) => {
			await updateRecognitionField('allowedCharacters', value)
		},
		[updateRecognitionField]
	)

	const onMaxOutputCharsChange = useCallback(
		async (value: string) => {
			const parsed = Number.parseInt(value, 10)
			if (Number.isNaN(parsed)) return
			await updateRecognitionField('maxOutputChars', parsed)
		},
		[updateRecognitionField]
	)

	const onBackendChange = useCallback(
		async (value: string) => {
			await updateRecognitionField('backend', value)
		},
		[updateRecognitionField]
	)

	const onManualPredictButtonChange = useCallback(
		async (value: boolean) => {
			await updateRecognitionField('manualPredictButton', value)
		},
		[updateRecognitionField]
	)

	const onPressureSensitivityChange = useCallback(
		async (value: string) => {
			const parsed = Number.parseFloat(value)
			if (Number.isNaN(parsed)) return
			const clamped = Math.max(0.5, Math.min(5, parsed))
			await updateRecognitionField('pressureSensitivity', +clamped.toFixed(2))
		},
		[updateRecognitionField]
	)

	const onSearchZoomMinSizeChange = useCallback(
		async (value: string) => {
			const parsed = Number.parseFloat(value)
			if (Number.isNaN(parsed)) return
			const clamped = Math.max(32, Math.min(512, parsed))
			await updateRecognitionField('searchZoomMinSizePx', Math.round(clamped))
		},
		[updateRecognitionField]
	)

	const onPencilTextureIntensityChange = useCallback(
		async (value: string) => {
			const parsed = Number.parseFloat(value)
			if (Number.isNaN(parsed)) return
			const clamped = Math.max(0, Math.min(1, parsed))
			await updateRecognitionField('pencilTextureIntensity', +clamped.toFixed(3))
		},
		[updateRecognitionField]
	)

	const onPencilTextureEnabledChange = useCallback(
		async (value: boolean) => {
			await updateRecognitionField('pencilTextureEnabled', value)
		},
		[updateRecognitionField]
	)

	const onShowRecognizedBatchTextOverlayChange = useCallback(
		async (value: boolean) => {
			await updateRecognitionField('showRecognizedBatchTextOverlay', value)
		},
		[updateRecognitionField]
	)

	const onGoogleImeLanguageChange = useCallback(
		async (value: string) => {
			await updateRecognitionField('googleImeLanguage', value)
		},
		[updateRecognitionField]
	)

	const onGoogleImeNumOfWordsChange = useCallback(
		async (value: string) => {
			const parsed = Number.parseInt(value, 10)
			if (Number.isNaN(parsed)) return
			await updateRecognitionField('googleImeNumOfWords', parsed)
		},
		[updateRecognitionField]
	)

	const onGoogleImeNumOfReturnChange = useCallback(
		async (value: string) => {
			const parsed = Number.parseInt(value, 10)
			if (Number.isNaN(parsed)) return
			await updateRecognitionField('googleImeNumOfReturn', parsed)
		},
		[updateRecognitionField]
	)

	const onRecognitionDebounceMsChange = useCallback(
		async (value: string) => {
			const parsed = Number.parseInt(value, 10)
			if (Number.isNaN(parsed)) return
			await updateRecognitionField('recognitionDebounceMs', parsed)
		},
		[updateRecognitionField]
	)

	const onStrokeGroupingMaxTimeDeltaMsChange = useCallback(
		async (value: string) => {
			const parsed = Number.parseInt(value, 10)
			if (Number.isNaN(parsed)) return
			await updateRecognitionField('strokeGroupingMaxTimeDeltaMs', parsed)
		},
		[updateRecognitionField]
	)

	const onStrokeGroupingAdaptiveGapMultiplierChange = useCallback(
		async (value: string) => {
			const parsed = Number.parseFloat(value)
			if (Number.isNaN(parsed)) return
			const clamped = Math.min(2, Math.max(0.5, parsed))
			await updateRecognitionField('strokeGroupingAdaptiveGapMultiplier', clamped)
		},
		[updateRecognitionField]
	)

	const onGoogleImeBatchMaxWidthPxChange = useCallback(
		async (value: string) => {
			const parsed = Number.parseInt(value, 10)
			if (Number.isNaN(parsed)) return
			await updateRecognitionField('googleImeBatchMaxWidthPx', parsed)
		},
		[updateRecognitionField]
	)

	const onGoogleImeBatchMaxHeightPxChange = useCallback(
		async (value: string) => {
			const parsed = Number.parseInt(value, 10)
			if (Number.isNaN(parsed)) return
			await updateRecognitionField('googleImeBatchMaxHeightPx', parsed)
		},
		[updateRecognitionField]
	)

	const onGoogleImeBatchMaxGroupsChange = useCallback(
		async (value: string) => {
			const parsed = Number.parseInt(value, 10)
			if (Number.isNaN(parsed)) return
			await updateRecognitionField('googleImeBatchMaxGroups', parsed)
		},
		[updateRecognitionField]
	)

	const onGoogleImeBatchMaxStrokesChange = useCallback(
		async (value: string) => {
			const parsed = Number.parseInt(value, 10)
			if (Number.isNaN(parsed)) return
			await updateRecognitionField('googleImeBatchMaxStrokes', parsed)
		},
		[updateRecognitionField]
	)

	const onGoogleImeBatchMaxPointsChange = useCallback(
		async (value: string) => {
			const parsed = Number.parseInt(value, 10)
			if (Number.isNaN(parsed)) return
			await updateRecognitionField('googleImeBatchMaxPoints', parsed)
		},
		[updateRecognitionField]
	)

	const onGoogleImeBatchBoundaryTimeGapMsChange = useCallback(
		async (value: string) => {
			const parsed = Number.parseInt(value, 10)
			if (Number.isNaN(parsed)) return
			await updateRecognitionField('googleImeBatchBoundaryTimeGapMs', parsed)
		},
		[updateRecognitionField]
	)

	const onGoogleImeBatchIdleFlushMsChange = useCallback(
		async (value: string) => {
			const parsed = Number.parseInt(value, 10)
			if (Number.isNaN(parsed)) return
			await updateRecognitionField('googleImeBatchIdleFlushMs', parsed)
		},
		[updateRecognitionField]
	)

	const onGoogleImeBatchHardMaxAgeMsChange = useCallback(
		async (value: string) => {
			const parsed = Number.parseInt(value, 10)
			if (Number.isNaN(parsed)) return
			await updateRecognitionField('googleImeBatchHardMaxAgeMs', parsed)
		},
		[updateRecognitionField]
	)

	const alphabetText = useMemo(() => {
		const configured = settings.handwritingRecognition?.alphabet
		if (Array.isArray(configured)) return configured.join(',')
		if (typeof configured === 'string') return configured
		return ''
	}, [settings.handwritingRecognition?.alphabet])

	const allowedCharactersText = useMemo(() => {
		const configured = settings.handwritingRecognition?.allowedCharacters
		if (Array.isArray(configured)) return configured.join(',')
		if (typeof configured === 'string') return configured
		return ''
	}, [settings.handwritingRecognition?.allowedCharacters])

	const pressureSensitivity = useMemo(() => {
		const configured = settings.handwritingRecognition?.pressureSensitivity
		if (typeof configured !== 'number' || !Number.isFinite(configured)) {
			return DEFAULT_SETTINGS.handwritingRecognition.pressureSensitivity
		}
		return Math.max(0.5, Math.min(5, configured))
	}, [settings.handwritingRecognition?.pressureSensitivity])

	const searchZoomMinSize = useMemo(() => {
		const configured = settings.handwritingRecognition?.searchZoomMinSizePx
		if (typeof configured !== 'number' || !Number.isFinite(configured)) {
			return DEFAULT_SETTINGS.handwritingRecognition.searchZoomMinSizePx
		}
		return Math.max(32, Math.min(512, configured))
	}, [settings.handwritingRecognition?.searchZoomMinSizePx])

	const pencilTextureIntensity = useMemo(() => {
		const configured = settings.handwritingRecognition?.pencilTextureIntensity
		if (typeof configured !== 'number' || !Number.isFinite(configured)) {
			return DEFAULT_SETTINGS.handwritingRecognition.pencilTextureIntensity
		}
		return Math.max(0, Math.min(1, configured))
	}, [settings.handwritingRecognition?.pencilTextureIntensity])

	const pencilTextureEnabled = useMemo(() => {
		const configured = settings.handwritingRecognition?.pencilTextureEnabled
		if (typeof configured === 'boolean') return configured
		return DEFAULT_SETTINGS.handwritingRecognition.pencilTextureEnabled
	}, [settings.handwritingRecognition?.pencilTextureEnabled])

	return (
		<>
			<Setting
				slots={{
					name: 'Recognizer backend',
					desc: 'Select recognition backend. Auto preserves current behavior: ONNX when model config is ready, otherwise stub.',
					control: (
						<>
							<Dropdown
								options={{
									auto: 'Auto (existing behavior)',
									'onnx-web': 'ONNX (local model)',
									'google-ime-js': 'Google IME (handwriting.js style)',
								}}
								value={settings.handwritingRecognition?.backend ?? 'auto'}
								onChange={onBackendChange}
							/>
							<ExtraButton icon="reset" tooltip="reset" onClick={() => resetModelField('backend')} />
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Manual predict button',
					desc: 'When enabled, recognition runs only when you click Predict now in the canvas. When disabled, recognition runs automatically after each new stroke.',
					control: (
						<>
							<Toggle
								value={settings.handwritingRecognition?.manualPredictButton ?? true}
								onChange={onManualPredictButtonChange}
							/>
							<ExtraButton
								icon="reset"
								tooltip="reset"
								onClick={() => resetModelField('manualPredictButton')}
							/>
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Search zoom minimum size',
					desc: 'Controls how far search focuses on recognized text. Increase this to zoom out more for short words.',
					control: (
						<>
							<div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '240px' }}>
								<input
									type='range'
									min='32'
									max='512'
									step='8'
									value={searchZoomMinSize}
									onChange={(event) => onSearchZoomMinSizeChange(event.currentTarget.value)}
									style={{ flex: 1 }}
								/>
								<span style={{ width: '56px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
									{Math.round(searchZoomMinSize)}px
								</span>
							</div>
							<ExtraButton
								icon='reset'
								tooltip='reset'
								onClick={() => resetModelField('searchZoomMinSizePx')}
							/>
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Pencil pressure sensitivity',
					desc: 'Controls how strongly pressure differences affect pencil stroke variation. Increase this if pressure changes are barely visible.',
					control: (
						<>
							<div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '240px' }}>
								<input
									type='range'
									min='0.5'
									max='5'
									step='0.1'
									value={pressureSensitivity}
									onChange={(event) => onPressureSensitivityChange(event.currentTarget.value)}
									style={{ flex: 1 }}
								/>
								<span style={{ width: '44px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
									{pressureSensitivity.toFixed(1)}x
								</span>
							</div>
							<ExtraButton
								icon='reset'
								tooltip='reset'
								onClick={() => resetModelField('pressureSensitivity')}
							/>
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Pencil grain texture',
					desc: 'Enable subtle grain texture on pencil strokes for a more realistic, hand-drawn appearance.',
					control: (
						<>
							<Toggle
								value={pencilTextureEnabled}
								onChange={onPencilTextureEnabledChange}
							/>
							<ExtraButton
								icon="reset"
								tooltip="reset"
								onClick={() => resetModelField('pencilTextureEnabled')}
							/>
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Pencil texture intensity',
					desc: 'Controls the strength of the grain texture effect. Higher values make the texture more prominent.',
					control: (
						<>
							<div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '240px' }}>
								<input
									type='range'
									min='0'
									max='1'
									step='0.01'
									value={pencilTextureIntensity}
									onChange={(event) => onPencilTextureIntensityChange(event.currentTarget.value)}
									style={{ flex: 1 }}
									disabled={!pencilTextureEnabled}
								/>
								<span style={{ width: '44px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
									{(pencilTextureIntensity * 100).toFixed(0)}%
								</span>
							</div>
							<ExtraButton
								icon='reset'
								tooltip='reset'
								onClick={() => resetModelField('pencilTextureIntensity')}
							/>
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Show recognized batch text overlay',
					desc: 'Display recognized text over each handwriting batch bounding area on the canvas.',
					control: (
						<>
							<Toggle
								value={!!settings.handwritingRecognition?.showRecognizedBatchTextOverlay}
								onChange={onShowRecognizedBatchTextOverlayChange}
							/>
							<ExtraButton
								icon="reset"
								tooltip="reset"
								onClick={() => resetModelField('showRecognizedBatchTextOverlay')}
							/>
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Recognition debounce (ms)',
					desc: 'Delay before recognition requests are sent. Higher values reduce API burst risk.',
					control: (
						<>
							<Text
								value={`${settings.handwritingRecognition?.recognitionDebounceMs ?? ''}`}
								placeholder={`${DEFAULT_SETTINGS.handwritingRecognition.recognitionDebounceMs}`}
								onChange={onRecognitionDebounceMsChange}
							/>
							<ExtraButton
								icon="reset"
								tooltip="reset"
								onClick={() => resetModelField('recognitionDebounceMs')}
							/>
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Stroke grouping max time delta (ms)',
					desc: 'Maximum time gap between consecutive strokes to keep them in the same character/word group before Google batching.',
					control: (
						<>
							<Text
								value={`${settings.handwritingRecognition?.strokeGroupingMaxTimeDeltaMs ?? ''}`}
								placeholder={`${DEFAULT_SETTINGS.handwritingRecognition.strokeGroupingMaxTimeDeltaMs}`}
								onChange={onStrokeGroupingMaxTimeDeltaMsChange}
							/>
							<ExtraButton
								icon="reset"
								tooltip="reset"
								onClick={() => resetModelField('strokeGroupingMaxTimeDeltaMs')}
							/>
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Adaptive stroke gap multiplier',
					desc: 'Fine-tune adaptive grouping based on stroke size. Lower values are stricter, higher values are more permissive.',
					control: (
						<>
							<Text
								value={`${settings.handwritingRecognition?.strokeGroupingAdaptiveGapMultiplier ?? ''}`}
								placeholder={`${DEFAULT_SETTINGS.handwritingRecognition.strokeGroupingAdaptiveGapMultiplier}`}
								onChange={onStrokeGroupingAdaptiveGapMultiplierChange}
							/>
							<ExtraButton
								icon="reset"
								tooltip="reset"
								onClick={() => resetModelField('strokeGroupingAdaptiveGapMultiplier')}
							/>
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Google IME language',
					desc: 'Language code for Google IME requests (e.g. en, ja, zh_TW). Used only by Google IME backend.',
					control: (
						<>
							<Text
								value={settings.handwritingRecognition?.googleImeLanguage ?? 'en'}
								placeholder={DEFAULT_SETTINGS.handwritingRecognition.googleImeLanguage}
								onChange={onGoogleImeLanguageChange}
							/>
							<ExtraButton
								icon="reset"
								tooltip="reset"
								onClick={() => resetModelField('googleImeLanguage')}
							/>
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Google IME numOfWords',
					desc: 'Optional length filter for Google IME candidates. 0 disables filtering.',
					control: (
						<>
							<Text
								value={`${settings.handwritingRecognition?.googleImeNumOfWords ?? ''}`}
								placeholder={`${DEFAULT_SETTINGS.handwritingRecognition.googleImeNumOfWords}`}
								onChange={onGoogleImeNumOfWordsChange}
							/>
							<ExtraButton
								icon="reset"
								tooltip="reset"
								onClick={() => resetModelField('googleImeNumOfWords')}
							/>
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Google IME numOfReturn',
					desc: 'Maximum number of returned Google IME candidates. 0 means no explicit cap.',
					control: (
						<>
							<Text
								value={`${settings.handwritingRecognition?.googleImeNumOfReturn ?? ''}`}
								placeholder={`${DEFAULT_SETTINGS.handwritingRecognition.googleImeNumOfReturn}`}
								onChange={onGoogleImeNumOfReturnChange}
							/>
							<ExtraButton
								icon="reset"
								tooltip="reset"
								onClick={() => resetModelField('googleImeNumOfReturn')}
							/>
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Google IME batch max width (px)',
					desc: 'Maximum merged batch width for auto Google mode before flushing a new request.',
					control: (
						<>
							<Text
								value={`${settings.handwritingRecognition?.googleImeBatchMaxWidthPx ?? ''}`}
								placeholder={`${DEFAULT_SETTINGS.handwritingRecognition.googleImeBatchMaxWidthPx}`}
								onChange={onGoogleImeBatchMaxWidthPxChange}
							/>
							<ExtraButton
								icon="reset"
								tooltip="reset"
								onClick={() => resetModelField('googleImeBatchMaxWidthPx')}
							/>
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Google IME batch max height (px)',
					desc: 'Maximum merged batch height for auto Google mode before flushing a new request.',
					control: (
						<>
							<Text
								value={`${settings.handwritingRecognition?.googleImeBatchMaxHeightPx ?? ''}`}
								placeholder={`${DEFAULT_SETTINGS.handwritingRecognition.googleImeBatchMaxHeightPx}`}
								onChange={onGoogleImeBatchMaxHeightPxChange}
							/>
							<ExtraButton
								icon="reset"
								tooltip="reset"
								onClick={() => resetModelField('googleImeBatchMaxHeightPx')}
							/>
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Google IME batch max groups',
					desc: 'Maximum grouped candidates per merged Google batch.',
					control: (
						<>
							<Text
								value={`${settings.handwritingRecognition?.googleImeBatchMaxGroups ?? ''}`}
								placeholder={`${DEFAULT_SETTINGS.handwritingRecognition.googleImeBatchMaxGroups}`}
								onChange={onGoogleImeBatchMaxGroupsChange}
							/>
							<ExtraButton
								icon="reset"
								tooltip="reset"
								onClick={() => resetModelField('googleImeBatchMaxGroups')}
							/>
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Google IME batch max strokes',
					desc: 'Maximum raw stroke count allowed in one merged Google batch.',
					control: (
						<>
							<Text
								value={`${settings.handwritingRecognition?.googleImeBatchMaxStrokes ?? ''}`}
								placeholder={`${DEFAULT_SETTINGS.handwritingRecognition.googleImeBatchMaxStrokes}`}
								onChange={onGoogleImeBatchMaxStrokesChange}
							/>
							<ExtraButton
								icon="reset"
								tooltip="reset"
								onClick={() => resetModelField('googleImeBatchMaxStrokes')}
							/>
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Google IME batch max points',
					desc: 'Maximum total point count in one merged batch before flushing.',
					control: (
						<>
							<Text
								value={`${settings.handwritingRecognition?.googleImeBatchMaxPoints ?? ''}`}
								placeholder={`${DEFAULT_SETTINGS.handwritingRecognition.googleImeBatchMaxPoints}`}
								onChange={onGoogleImeBatchMaxPointsChange}
							/>
							<ExtraButton
								icon="reset"
								tooltip="reset"
								onClick={() => resetModelField('googleImeBatchMaxPoints')}
							/>
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Google IME batch boundary gap (ms)',
					desc: 'Flush batch if the next group starts after this time gap.',
					control: (
						<>
							<Text
								value={`${settings.handwritingRecognition?.googleImeBatchBoundaryTimeGapMs ?? ''}`}
								placeholder={`${DEFAULT_SETTINGS.handwritingRecognition.googleImeBatchBoundaryTimeGapMs}`}
								onChange={onGoogleImeBatchBoundaryTimeGapMsChange}
							/>
							<ExtraButton
								icon="reset"
								tooltip="reset"
								onClick={() => resetModelField('googleImeBatchBoundaryTimeGapMs')}
							/>
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Google IME batch idle flush (ms)',
					desc: 'Reserved for idle-triggered flushing in follow-up wiring.',
					control: (
						<>
							<Text
								value={`${settings.handwritingRecognition?.googleImeBatchIdleFlushMs ?? ''}`}
								placeholder={`${DEFAULT_SETTINGS.handwritingRecognition.googleImeBatchIdleFlushMs}`}
								onChange={onGoogleImeBatchIdleFlushMsChange}
							/>
							<ExtraButton
								icon="reset"
								tooltip="reset"
								onClick={() => resetModelField('googleImeBatchIdleFlushMs')}
							/>
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Google IME batch hard max age (ms)',
					desc: 'Flush batch if accumulated batch age exceeds this limit.',
					control: (
						<>
							<Text
								value={`${settings.handwritingRecognition?.googleImeBatchHardMaxAgeMs ?? ''}`}
								placeholder={`${DEFAULT_SETTINGS.handwritingRecognition.googleImeBatchHardMaxAgeMs}`}
								onChange={onGoogleImeBatchHardMaxAgeMsChange}
							/>
							<ExtraButton
								icon="reset"
								tooltip="reset"
								onClick={() => resetModelField('googleImeBatchHardMaxAgeMs')}
							/>
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Model URL',
					desc: 'Path or URL to the OnlineHTR ONNX model file used for recognition.',
					control: (
						<>
							<Text
								value={settings.handwritingRecognition?.modelUrl ?? ''}
								placeholder={DEFAULT_SETTINGS.handwritingRecognition.modelUrl}
								onChange={onModelUrlChange}
							/>
							<ExtraButton icon="reset" tooltip="reset" onClick={() => resetModelField('modelUrl')} />
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Alphabet',
					desc: 'Comma-separated labels (e.g. a,b,c), plain character sequence (e.g. abc), or JSON array for special tokens (e.g. [" ",",","a"]).',
					control: (
						<>
							<Text
								value={alphabetText}
								placeholder='[" ",",","a","b"]'
								onChange={onAlphabetChange}
							/>
							<ExtraButton icon="reset" tooltip="reset" onClick={() => resetModelField('alphabet')} />
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Input tensor name',
					desc: 'Optional override for the ONNX model input name.',
					control: (
						<>
							<Text
								value={settings.handwritingRecognition?.inputName ?? ''}
								placeholder={DEFAULT_SETTINGS.handwritingRecognition.inputName}
								onChange={onInputNameChange}
							/>
							<ExtraButton icon="reset" tooltip="reset" onClick={() => resetModelField('inputName')} />
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Output tensor name',
					desc: 'Optional override for the ONNX model output name.',
					control: (
						<>
							<Text
								value={settings.handwritingRecognition?.outputName ?? ''}
								placeholder={DEFAULT_SETTINGS.handwritingRecognition.outputName}
								onChange={onOutputNameChange}
							/>
							<ExtraButton icon="reset" tooltip="reset" onClick={() => resetModelField('outputName')} />
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Blank index',
					desc: 'CTC blank class index. Defaults to 0 for current decoder wiring.',
					control: (
						<>
							<Text
								value={`${settings.handwritingRecognition?.blankIndex ?? ''}`}
								placeholder={`${DEFAULT_SETTINGS.handwritingRecognition.blankIndex}`}
								onChange={onBlankIndexChange}
							/>
							<ExtraButton icon="reset" tooltip="reset" onClick={() => resetModelField('blankIndex')} />
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Single shape recognition mode',
					desc: 'Treat each newly drawn shape as a standalone recognition candidate (disables multi-shape grouping). Useful for per-character benchmarking.',
					control: (
						<>
							<Toggle
								value={!!settings.handwritingRecognition?.singleShapeMode}
								onChange={onSingleShapeModeChange}
							/>
							<ExtraButton
								icon="reset"
								tooltip="reset"
								onClick={() => resetModelField('singleShapeMode')}
							/>
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Allowed characters',
					desc: 'Optional decode constraint. Use comma-separated labels, plain sequence, or JSON array (e.g. a,b,c or abc or ["a","b","c"]). Empty disables filtering.',
					control: (
						<>
							<Text value={allowedCharactersText} placeholder='a,b,c,1,2,3' onChange={onAllowedCharactersChange} />
							<ExtraButton icon="reset" tooltip="reset" onClick={() => resetModelField('allowedCharacters')} />
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Max output chars',
					desc: 'Limit decoded output length. Set 1 for single-character recognition. Set 0 for no cap.',
					control: (
						<>
							<Text
								value={`${settings.handwritingRecognition?.maxOutputChars ?? ''}`}
								placeholder={`${DEFAULT_SETTINGS.handwritingRecognition.maxOutputChars}`}
								onChange={onMaxOutputCharsChange}
							/>
							<ExtraButton icon="reset" tooltip="reset" onClick={() => resetModelField('maxOutputChars')} />
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Resolver status',
					desc: 'Preview of ONNX config readiness. Auto backend uses this to choose ONNX or stub.',
					control: (
						<Text
							readonly
							value={isOnlineHtrModelConfigReady(normalizedConfig) ? 'ready (onnx-web)' : 'not-ready (stub)'}
						/>
					),
				}}
			/>
		</>
	)
}

export default function HandwritingRecognitionSettings() {
	return (
		<Group heading="Handwriting recognition model">
			<HandwritingRecognitionSettingsGroup />
		</Group>
	)
}
