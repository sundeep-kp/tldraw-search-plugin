export function initializeStrokeListener(editor: any) {
    console.log("Stroke listener initialized")

	const processedShapes = new Set<string>()

	editor.store.listen((update: any) => {
        
		const added = update?.changes?.added

		if (!added || Object.keys(added).length === 0) return
            console.log("ADDED RECORDS", added)

		for (const record of Object.values(added) as any[]) {

			if (
				record.type === "draw" &&
				record.props?.isComplete
			) {

				if (!processedShapes.has(record.id)) {

					processedShapes.add(record.id)

					console.log("Stroke detected:", record.id)

				}

			}

		}

	})
}