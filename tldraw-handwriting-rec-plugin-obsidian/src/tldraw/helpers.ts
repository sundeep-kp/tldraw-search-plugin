import { TLDataDocument, TLDataDocumentStore, TldrawPluginMetaData } from 'src/utils/document'
import { TLStore, createTLStore } from 'tldraw'
import { PENCIL_SHAPE_UTILS } from 'src/tldraw/rendering/pencil-draw-shape-util'

export function processInitialData(initialData: TLDataDocument): TLDataDocumentStore {
	const {
		meta,
		store,
	}: {
		meta: TldrawPluginMetaData
		store: TLStore
	} = (() => {
		if (initialData.store) {
			return initialData
		}

		return {
			meta: initialData.meta,
			store: createTLStore({
				shapeUtils: PENCIL_SHAPE_UTILS,
				initialData: initialData.raw,
			}),
		}
	})()

	return { meta, store }
}
