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
	id: string
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

	createPendingSession(seedPoint?: PressurePoint): string {
		const now = Date.now()
		const id = `pencil-session-${now}-${Math.random().toString(16).slice(2, 8)}`
		this.pendingSessions.set(id, {
			id,
			points: seedPoint ? [seedPoint] : [],
			startedAt: now,
		})
		return id
	}

	appendPendingSessionPoint(sessionId: string, point: PressurePoint): void {
		const session = this.pendingSessions.get(sessionId)
		if (!session) return
		session.points.push(point)
	}

	endPendingSession(sessionId: string): void {
		const session = this.pendingSessions.get(sessionId)
		if (!session) return
		session.endedAt = Date.now()
	}

	cancelPendingSession(sessionId: string): void {
		this.pendingSessions.delete(sessionId)
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
		let bestMatch: PendingPressureSession | undefined
		let bestScore = Number.POSITIVE_INFINITY

		for (const session of this.pendingSessions.values()) {
			if (!session.endedAt) continue
			if (now - session.endedAt > maxAgeMs) continue
			if (session.points.length === 0) continue

			const pointDelta = Math.abs(rawStrokePointsCount - session.points.length)
			const agePenalty = Math.max(0, now - session.endedAt) / 1000
			const score = pointDelta + agePenalty

			if (score < bestScore) {
				bestScore = score
				bestMatch = session
			}
		}

		if (!bestMatch) return undefined

		const resolved: PressureStrokeData = {
			points: bestMatch.points,
			timestamp: bestMatch.endedAt ?? now,
		}

		this.pendingSessions.delete(bestMatch.id)
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
		return this.store.get(shapeId)
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
