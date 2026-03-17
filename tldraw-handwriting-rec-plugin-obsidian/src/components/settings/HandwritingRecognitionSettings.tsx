import { ExtraButton, Text } from '@obsidian-plugin-toolkit/react/components'
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
			field: 'modelUrl' | 'alphabet' | 'inputName' | 'outputName' | 'blankIndex',
			value: string | number
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
		async (field: 'modelUrl' | 'alphabet' | 'inputName' | 'outputName' | 'blankIndex') => {
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

	const alphabetText = useMemo(() => {
		const configured = settings.handwritingRecognition?.alphabet
		if (Array.isArray(configured)) return configured.join(',')
		if (typeof configured === 'string') return configured
		return ''
	}, [settings.handwritingRecognition?.alphabet])

	return (
		<>
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
					desc: 'Comma-separated labels (e.g. a,b,c) or plain character sequence (e.g. abc).',
					control: (
						<>
							<Text
								value={alphabetText}
								placeholder="a,b,c"
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
					name: 'Resolver status',
					desc: 'Preview of normalized config readiness used by recognizer engine selection.',
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
