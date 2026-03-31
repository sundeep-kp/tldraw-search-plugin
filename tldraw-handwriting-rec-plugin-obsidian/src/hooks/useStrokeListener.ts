import * as React from 'react'
import { initializeStrokeListener } from 'src/handwriting/strokeListener'
import { StrokeListenerOptions } from 'src/handwriting/types'
import { Editor } from 'tldraw'

export function useStrokeListener(editor: Editor | undefined, options: StrokeListenerOptions) {
	const { debug = false, onStrokeExtracted, onShapesRemoved, onShapesMoved } = options

	React.useEffect(() => {
		if (!editor) return

		return initializeStrokeListener(editor, {
			debug,
			onStrokeExtracted,
			onShapesRemoved,
			onShapesMoved,
		})
	}, [debug, editor, onShapesMoved, onShapesRemoved, onStrokeExtracted])
}
