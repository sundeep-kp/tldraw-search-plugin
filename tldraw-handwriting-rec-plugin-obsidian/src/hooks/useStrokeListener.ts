import * as React from 'react'
import { initializeStrokeListener } from 'src/handwriting/strokeListener'
import { StrokeListenerOptions } from 'src/handwriting/types'
import { Editor } from 'tldraw'

export function useStrokeListener(editor: Editor | undefined, options: StrokeListenerOptions) {
	const { debug = false, onStrokeExtracted, onShapesRemoved, onAnyShapesRemoved, onShapesMoved } = options

	React.useEffect(() => {
		if (!editor) return

		return initializeStrokeListener(editor, {
			debug,
			onStrokeExtracted,
			onShapesRemoved,
			onAnyShapesRemoved,
			onShapesMoved,
		})
	}, [debug, editor, onAnyShapesRemoved, onShapesMoved, onShapesRemoved, onStrokeExtracted])
}
