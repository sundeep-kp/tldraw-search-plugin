/**
 * Pressure and velocity data store for pencil tool strokes.
 * Stores pressure readings captured during drawing, indexed by shape ID.
 */

export type PressurePoint = {
	/** X coordinate in page space */
	x: number
	/** Y coordinate in page space */
	y: number
	/** Pressure value from PointerEvent, range [0, 1]. 1 = full pressure. */
	pressure: number
	/** Velocity magnitude (pixels per tick) */
	velocityMagnitude: number
}

export type PressureStrokeData = {
	/** Raw pressure points captured during drawing */
	points: PressurePoint[]
	/** Timestamp when stroke was completed */
	timestamp: number
}

export type PendingPressureSession = {
	shapeId: string
	points: PressurePoint[]
	startedAt: number
	endedAt?: number
}

type PendingSessionMatchOptions = {
	maxAgeMs?: number
}

/**
 * Global store for pressure data. Maps shape ID to pressure stroke data.
 * This is kept separate from tldraw's shape store since tldraw shapes don't support custom properties.
 */
class PressureDataStore {
	private store = new Map<string, PressureStrokeData>()
	private pendingSessions = new Map<string, PendingPressureSession>()

	createPendingSession(shapeId: string, seedPoint?: PressurePoint): string {
		const existing = this.pendingSessions.get(shapeId)
		if (existing) return shapeId
		const now = Date.now()
		this.pendingSessions.set(shapeId, {
			shapeId,
			points: seedPoint ? [seedPoint] : [],
			startedAt: now,
		})
		return shapeId
	}

	appendPendingSessionPoint(shapeId: string, point: PressurePoint): void {
		const session = this.pendingSessions.get(shapeId)
		if (!session) return
		session.points.push(point)
	}

	endPendingSession(shapeId: string): void {
		const session = this.pendingSessions.get(shapeId)
		if (!session) return
		session.endedAt = Date.now()
	}

	cancelPendingSession(shapeId: string): void {
		this.pendingSessions.delete(shapeId)
	}

	getPendingSessions(): PendingPressureSession[] {
		return Array.from(this.pendingSessions.values())
	}

	consumePendingSessionForStroke(
		shapeId: string,
		rawStrokePointsCount: number,
		options: PendingSessionMatchOptions = {}
	): PressureStrokeData | undefined {
		const now = Date.now()
		const maxAgeMs = options.maxAgeMs ?? 5_000
		const session = this.pendingSessions.get(shapeId)
		if (!session || !session.endedAt) return undefined
		if (now - session.endedAt > maxAgeMs) {
			this.pendingSessions.delete(shapeId)
			return undefined
		}
		if (session.points.length === 0) {
			this.pendingSessions.delete(shapeId)
			return undefined
		}

		const resolved: PressureStrokeData = {
			points: session.points,
			timestamp: session.endedAt ?? now,
		}

		this.pendingSessions.delete(shapeId)
		this.store.set(shapeId, resolved)
		return resolved
	}

	/**
	 * Store pressure data for a completed shape.
	 */
	setPressureData(shapeId: string, data: PressureStrokeData): void {
		this.store.set(shapeId, data)
	}

	/**
	 * Get pressure data for a shape, if it exists.
	 */
	getPressureData(shapeId: string): PressureStrokeData | undefined {
		const resolved = this.store.get(shapeId)
		if (resolved) return resolved

		const session = this.pendingSessions.get(shapeId)
		if (!session || session.points.length === 0) return undefined

		return {
			points: session.points,
			timestamp: session.endedAt ?? session.startedAt,
		}
	}

	/**
	 * Check if a shape has pressure data.
	 */
	hasPressureData(shapeId: string): boolean {
		return this.store.has(shapeId)
	}

	/**
	 * Remove pressure data for a shape (e.g., when shape is deleted).
	 */
	removePressureData(shapeId: string): void {
		this.store.delete(shapeId)
	}

	/**
	 * Clear all pressure data.
	 */
	clear(): void {
		this.store.clear()
		this.pendingSessions.clear()
	}

	/**
	 * Get all stored pressure data.
	 */
	getAll(): Map<string, PressureStrokeData> {
		return new Map(this.store)
	}
}

// Export singleton instance
export const pressureStore = new PressureDataStore()
