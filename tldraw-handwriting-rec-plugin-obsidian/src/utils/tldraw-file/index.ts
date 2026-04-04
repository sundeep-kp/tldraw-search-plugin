import { createTLStore, TldrawFile, TLStore } from 'tldraw'
import { PENCIL_SHAPE_UTILS } from 'src/tldraw/rendering/pencil-draw-shape-util'

/**
 *
 * @param store The store to create a file from. Leave this undefined to create a blank tldraw file.
 * @returns
 */
export function createRawTldrawFile(store?: TLStore): TldrawFile {
	store ??= createTLStore({ shapeUtils: PENCIL_SHAPE_UTILS })
	return {
		tldrawFileFormatVersion: 1,
		schema: store.schema.serialize(),
		records: store.allRecords(),
	}
}
