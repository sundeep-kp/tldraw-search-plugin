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
				| 'googleImeNumOfReturn',
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
