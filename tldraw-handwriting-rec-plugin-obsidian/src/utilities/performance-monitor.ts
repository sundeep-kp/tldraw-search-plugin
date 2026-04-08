/**
 * Performance monitoring utility for tracking rendering and interaction metrics.
 * Useful for profiling zoom lag and optimization effectiveness.
 */

interface PerformanceMetrics {
	/** Timestamp when measurement started */
	startTime: number
	/** Cumulative rendering time (ms) */
	renderTime: number
	/** Number of frames rendered */
	frameCount: number
	/** Peak frame time (ms) */
	peakFrameTime: number
	/** Average frame time (ms) */
	avgFrameTime: number
	/** Frames per second */
	fps: number
}

class PerformanceMonitor {
	private metrics: PerformanceMetrics | null = null
	private frameStartTime = 0
	private enabled = false
	private frameTimestamps: number[] = []
	private maxTimestamps = 60 // Keep last 60 frames for rolling average
	private rafId: number | null = null
	private lastRafTimestamp: number | null = null

	/**
	 * Start monitoring performance metrics
	 */
	startMeasurement(): void {
		this.stopContinuous()
		this.metrics = {
			startTime: performance.now(),
			renderTime: 0,
			frameCount: 0,
			peakFrameTime: 0,
			avgFrameTime: 0,
			fps: 0,
		}
		this.enabled = true
		this.frameTimestamps = []
		this.frameStartTime = performance.now()
	}

	/**
	 * Record frame completion
	 */
	recordFrame(): void {
		if (!this.metrics) return

		const now = performance.now()
		const frameTime = now - this.frameStartTime

		this.metrics.renderTime += frameTime
		this.metrics.frameCount += 1
		this.metrics.peakFrameTime = Math.max(this.metrics.peakFrameTime, frameTime)
		this.metrics.avgFrameTime = this.metrics.renderTime / this.metrics.frameCount

		// Track last 60 frame times for rolling average
		this.frameTimestamps.push(frameTime)
		if (this.frameTimestamps.length > this.maxTimestamps) {
			this.frameTimestamps.shift()
		}

		// Calculate FPS based on measurement duration
		const elapsedSeconds = (now - this.metrics.startTime) / 1000
		if (elapsedSeconds > 0) {
			this.metrics.fps = this.metrics.frameCount / elapsedSeconds
		}

		this.frameStartTime = now
	}

	/**
	 * Stop measurement and return results
	 */
	stopMeasurement(): PerformanceMetrics | null {
		if (!this.enabled || !this.metrics) return null

		this.enabled = false
		const results = { ...this.metrics }

		if (process.env.NODE_ENV !== 'production') {
			console.log('[Performance] Measurement Results:', {
				duration: `${results.renderTime.toFixed(2)}ms`,
				frames: results.frameCount,
				avgFrameTime: `${results.avgFrameTime.toFixed(2)}ms`,
				peakFrameTime: `${results.peakFrameTime.toFixed(2)}ms`,
				fps: `${results.fps.toFixed(1)}`,
			})
		}

		return results
	}

	/**
	 * Check if monitoring is active
	 */
	isMonitoring(): boolean {
		return this.enabled
	}

	/**
	 * Get current metrics snapshot (without stopping)
	 */
	getSnapshot(): PerformanceMetrics | null {
		return this.metrics ? { ...this.metrics } : null
	}

	/**
	 * Get rolling frame time metrics (last 60 frames)
	 */
	getRollingMetrics(): { avgFrameTime: number; currentFps: number } {
		if (this.frameTimestamps.length === 0) {
			return { avgFrameTime: 0, currentFps: 0 }
		}

		const avgFrameTime = this.frameTimestamps.reduce((a, b) => a + b, 0) / this.frameTimestamps.length
		const currentFps = avgFrameTime > 0 ? 1000 / avgFrameTime : 0

		return {
			avgFrameTime,
			currentFps,
		}
	}

	/**
	 * Start continuous monitoring (always track frames)
	 */
	startContinuous(): void {
		this.stopContinuous()
		this.metrics = {
			startTime: performance.now(),
			renderTime: 0,
			frameCount: 0,
			peakFrameTime: 0,
			avgFrameTime: 0,
			fps: 0,
		}
		this.enabled = true
		this.frameTimestamps = []
		this.frameStartTime = performance.now()
		this.lastRafTimestamp = null

		const tick = (timestamp: number) => {
			if (!this.enabled || !this.metrics) return

			if (this.lastRafTimestamp !== null) {
				const frameTime = timestamp - this.lastRafTimestamp
				// Ignore very large deltas (tab switches/suspends) that skew readings.
				if (frameTime > 0 && frameTime < 250) {
					this.metrics.renderTime += frameTime
					this.metrics.frameCount += 1
					this.metrics.peakFrameTime = Math.max(this.metrics.peakFrameTime, frameTime)
					this.metrics.avgFrameTime = this.metrics.renderTime / this.metrics.frameCount

					this.frameTimestamps.push(frameTime)
					if (this.frameTimestamps.length > this.maxTimestamps) {
						this.frameTimestamps.shift()
					}

					const elapsedSeconds = (timestamp - this.metrics.startTime) / 1000
					if (elapsedSeconds > 0) {
						this.metrics.fps = this.metrics.frameCount / elapsedSeconds
					}
				}
			}

			this.lastRafTimestamp = timestamp
			this.rafId = requestAnimationFrame(tick)
		}

		this.rafId = requestAnimationFrame(tick)
	}

	/**
	 * Stop continuous monitoring loop.
	 */
	stopContinuous(): void {
		this.enabled = false
		this.lastRafTimestamp = null
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId)
			this.rafId = null
		}
	}
}

export const performanceMonitor = new PerformanceMonitor()
