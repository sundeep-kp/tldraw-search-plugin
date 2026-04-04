import { App, Modal, Notice, Setting } from 'obsidian'
import TldrawPlugin from 'src/main'
import { importKritaBundleFile, isKritaBundleFileName } from 'src/obsidian/krita/krita-bundle'

export default class KritaBundleImportModal extends Modal {
	constructor(
		app: App,
		private readonly plugin: TldrawPlugin
	) {
		super(app)
	}

	onOpen(): void {
		super.onOpen()
		this.contentEl.empty()
		this.titleEl.createEl('header', { text: 'Import Krita brush bundle' })

		this.contentEl.createEl('p', {
			text: 'Select a Krita .bundle or .zip archive. The plugin will store the original bundle in your vault and index the brush preset metadata.',
		})

		const fileInput = this.contentEl.createEl('input', {
			type: 'file',
			attr: {
				accept: '.bundle,.zip,application/zip',
			},
		})

		let statusEl = this.contentEl.createEl('p', { text: 'No bundle selected.' })

		new Setting(this.contentEl).addButton((button) => {
			button.setButtonText('Import selected bundle').setCta().onClick(async () => {
				const file = fileInput.files?.[0]
				if (!file) {
					new Notice('Select a Krita bundle first.')
					return
				}
				if (!isKritaBundleFileName(file.name)) {
					new Notice('The selected file does not look like a Krita bundle.')
					return
				}

				statusEl.setText('Importing bundle...')
				try {
					const record = await importKritaBundleFile(this.plugin, file)
					statusEl.setText(
						`Imported ${record.name} with ${record.summary.presetEntries.length} brush preset(s).`
					)
					new Notice(`Imported Krita bundle: ${record.name}`)
				} catch (error) {
					console.error('[KritaBundleImportModal] import failed', error)
					statusEl.setText('Import failed. See console for details.')
					new Notice('Failed to import Krita bundle.')
				}
			})
		})

		fileInput.addEventListener('change', () => {
			const file = fileInput.files?.[0]
			statusEl.setText(file ? `Selected: ${file.name}` : 'No bundle selected.')
		})
	}
}
