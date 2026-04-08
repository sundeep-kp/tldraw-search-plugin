import React, { useCallback, useState } from 'react'
import useSettingsManager from 'src/hooks/useSettingsManager'
import useUserPluginSettings from 'src/hooks/useUserPluginSettings'
import { ThemePreference } from 'src/obsidian/TldrawSettingsTab'
import { themePreferenceRecord } from 'src/obsidian/settings/constants'
import { Setting, Group } from '@obsidian-plugin-toolkit/react/components/setting/group'
import { Dropdown, Toggle } from '@obsidian-plugin-toolkit/react/components'
import './DebugSettings.css'

function StartUpSettingsGroup() {
	const settingsManager = useSettingsManager()
	const settings = useUserPluginSettings(settingsManager)
	const [showDebugModal, setShowDebugModal] = useState(false)
	const updateSettings = useCallback(
		() => settingsManager.updateSettings(settingsManager.settings),
		[settingsManager]
	)

	const onThemePreferenceChange = useCallback(
		async (value: string) => {
			settingsManager.settings.themeMode = value as ThemePreference
			await updateSettings()
		},
		[settingsManager, updateSettings]
	)

	const onDefaultToolChange = useCallback(
		async (value: string) => {
			settingsManager.settings.toolSelected = value
			await updateSettings()
		},
		[settingsManager, updateSettings]
	)

	const onGridModeChange = useCallback(
		async (value: boolean) => {
			settingsManager.settings.gridMode = value
			await updateSettings()
		},
		[settingsManager, updateSettings]
	)

	const onSnapModeChange = useCallback(
		async (value: boolean) => {
			settingsManager.settings.snapMode = value
			await updateSettings()
		},
		[settingsManager, updateSettings]
	)

	const onFocusModeChange = useCallback(
		async (value: boolean) => {
			settingsManager.settings.focusMode = value
			await updateSettings()
		},
		[settingsManager, updateSettings]
	)

	const onDebugModeChange = useCallback(
		async (value: boolean) => {
			settingsManager.settings.debugMode = value
			await updateSettings()
		},
		[settingsManager, updateSettings]
	)

	const onDebugLogChange = useCallback(
		async (category: keyof typeof settingsManager.settings.debugLogs, value: boolean) => {
			if (!settingsManager.settings.debugLogs) {
				settingsManager.settings.debugLogs = {}
			}
			settingsManager.settings.debugLogs[category] = value
			await updateSettings()
		},
		[settingsManager, updateSettings]
	)

	return (
		<>
			<Setting
				slots={{
					name: 'Theme',
					desc: 'When opening a tldraw file, this setting decides what theme should be applied.',
					control: (
						<>
							<Dropdown
								options={themePreferenceRecord}
								value={settings.themeMode}
								onChange={onThemePreferenceChange}
							/>
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Default tool',
					desc: 'When opening a tldraw file, this setting decides which tool should be selected.',
					control: (
						<>
							<Dropdown
								options={{
									select: 'Select',
									hand: 'Hand',
									draw: 'Draw',
									text: 'Text',
									eraser: 'Eraser',
									highlight: 'Highlight',
									rectangle: 'Rectangle',
									ellipse: 'Ellipse',
								}}
								value={settings.toolSelected}
								onChange={onDefaultToolChange}
							/>
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Grid mode',
					desc: 'When opening tldraw files, this setting determines whether grid mode is enabled. Keep in mind that enabling grid mode will both show a grid and enforce snap-to-grid functionality.',
					control: (
						<>
							<Toggle value={settings.gridMode} onChange={onGridModeChange} />
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Snap mode',
					desc: 'When opening tldraw files, this setting determines whether snap mode is enabled. Snap mode is a feature that places guides on shapes as you move them, ensuring they align with specific points or positions for precise placement.',
					control: (
						<>
							<Toggle value={settings.snapMode} onChange={onSnapModeChange} />
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Focus mode',
					desc: 'When opening tldraw files, this setting determines whether to launch tldraw in focus mode. Great if you like to use tldraw to quickly jot something down.',
					control: (
						<>
							<Toggle value={settings.focusMode} onChange={onFocusModeChange} />
						</>
					),
				}}
			/>
			<Setting
				slots={{
					name: 'Debug mode',
					desc: 'When opening tldraw files, this setting toggles the tldraw debug mode. Debug mode is useful for the developer.',
					control: (
						<div className="debug-mode-control">
							<Toggle value={settings.debugMode} onChange={onDebugModeChange} />
							{settings.debugMode && (
								<>
									<button
										className="debug-gear-button"
										onClick={() => setShowDebugModal(!showDebugModal)}
										title="Configure debug logs"
										aria-label="Configure debug logs"
									>
										⚙️
									</button>
									{showDebugModal && (
										<div className="debug-modal-overlay" onClick={() => setShowDebugModal(false)}>
											<div className="debug-modal" onClick={e => e.stopPropagation()}>
												<div className="debug-modal-header">
													<h3>Debug Log Categories</h3>
													<button
														className="debug-modal-close"
														onClick={() => setShowDebugModal(false)}
														aria-label="Close"
													>
														✕
													</button>
												</div>
												<div className="debug-modal-content">
													<label className="debug-checkbox-label">
														<input
															type="checkbox"
															checked={settings.debugLogs?.recognitionEngine ?? true}
															onChange={e =>
																onDebugLogChange('recognitionEngine', e.target.checked)
															}
														/>
														<span>Recognition Engine</span>
													</label>
													<label className="debug-checkbox-label">
														<input
															type="checkbox"
															checked={settings.debugLogs?.recognitionEvents ?? true}
															onChange={e =>
																onDebugLogChange('recognitionEvents', e.target.checked)
															}
														/>
														<span>Recognition Events</span>
													</label>
													<label className="debug-checkbox-label">
														<input
															type="checkbox"
															checked={settings.debugLogs?.handwritingSearch ?? true}
															onChange={e =>
																onDebugLogChange('handwritingSearch', e.target.checked)
															}
														/>
														<span>Handwriting Search</span>
													</label>
													<label className="debug-checkbox-label">
														<input
															type="checkbox"
															checked={settings.debugLogs?.opacityOverwriteCheck ?? true}
															onChange={e =>
																onDebugLogChange('opacityOverwriteCheck', e.target.checked)
															}
														/>
														<span>Opacity overwrite check</span>
													</label>
													<label className="debug-checkbox-label">
														<input
															type="checkbox"
															checked={settings.debugLogs?.pencilDefaultStroke ?? true}
															onChange={e => onDebugLogChange('pencilDefaultStroke', e.target.checked)}
														/>
														<span>Pencil default stroke</span>
													</label>
													<label className="debug-checkbox-label">
														<input
															type="checkbox"
															checked={settings.debugLogs?.pencilBaseStroke ?? true}
															onChange={e => onDebugLogChange('pencilBaseStroke', e.target.checked)}
														/>
														<span>Pencil base stroke</span>
													</label>
													<label className="debug-checkbox-label">
														<input
															type="checkbox"
															checked={settings.debugLogs?.pencilSampledOverlay ?? false}
															onChange={e => onDebugLogChange('pencilSampledOverlay', e.target.checked)}
														/>
														<span>Pencil sampled overlay</span>
													</label>
													<label className="debug-checkbox-label">
														<input
															type="checkbox"
															checked={settings.debugLogs?.pencilFallbackStyling ?? false}
															onChange={e => onDebugLogChange('pencilFallbackStyling', e.target.checked)}
														/>
														<span>Pencil fallback styling</span>
													</label>
														<label className="debug-checkbox-label">
															<input
																type="checkbox"
																checked={settings.debugLogs?.pencilRectangleStamp ?? false}
																onChange={e => onDebugLogChange('pencilRectangleStamp', e.target.checked)}
															/>
															<span>Pencil rectangle stamp (debug)</span>
														</label>
												</div>
											</div>
										</div>
									)}
								</>
							)}
						</div>
					),
				}}
			/>
		</>
	)
}

export default function StartUpSettings() {
	return (
		<>
			<Group heading='Start up'>
				<StartUpSettingsGroup />
			</Group>
		</>
	)
}
