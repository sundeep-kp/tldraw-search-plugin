import { requestUrl } from 'obsidian'

export type YoutubePlaylistExtractionResult = {
	playlistId: string
	playlistUrl: string
	videos: Array<{ videoId: string; videoUrl: string; title?: string }>
	videoIds: string[]
	videoUrls: string[]
	title?: string
}

const YT_INITIAL_DATA_MARKERS = [
	'var ytInitialData = ',
	'window["ytInitialData"] = ',
	'window[\'ytInitialData\'] = ',
	'ytInitialData = ',
]

function safeParseUrl(value: string): URL | undefined {
	try {
		return new URL(value)
	} catch {
		return undefined
	}
}

export function getYoutubePlaylistIdFromUrl(inputUrl: string): string | undefined {
	const parsed = safeParseUrl(inputUrl)
	if (!parsed) return
	const listId = parsed.searchParams.get('list') ?? undefined
	if (listId) return listId

	const trimmed = inputUrl.trim()
	if (/^[A-Za-z0-9_-]{18,40}$/.test(trimmed)) return trimmed
	return
}

export function buildYoutubePlaylistUrl(playlistId: string): string {
	return `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`
}

function buildYoutubeWatchUrl(videoId: string, playlistId?: string): string {
	const url = new URL('https://www.youtube.com/watch')
	url.searchParams.set('v', videoId)
	if (playlistId) url.searchParams.set('list', playlistId)
	return url.toString()
}

function extractRegexGroup(source: string, regex: RegExp): string | undefined {
	const match = source.match(regex)
	return match?.[1]
}

function extractJsonLiteralAfterMarker(source: string, marker: string): unknown | undefined {
	const markerIndex = source.indexOf(marker)
	if (markerIndex < 0) return

	const startIndex = source.indexOf('{', markerIndex)
	if (startIndex < 0) return

	let depth = 0
	let inString = false
	let escaped = false
	let quote = ''

	for (let i = startIndex; i < source.length; i++) {
		const char = source[i]

		if (inString) {
			if (escaped) {
				escaped = false
				continue
			}
			if (char === '\\') {
				escaped = true
				continue
			}
			if (char === quote) {
				inString = false
				quote = ''
			}
			continue
		}

		if (char === '"' || char === "'") {
			inString = true
			quote = char
			continue
		}

		if (char === '{') {
			depth += 1
			continue
		}

		if (char === '}') {
			depth -= 1
			if (depth === 0) {
				const literal = source.slice(startIndex, i + 1)
				try {
					return JSON.parse(literal)
				} catch {
					return
				}
			}
		}
	}

	return
}

function extractInnertubeConfig(html: string): { apiKey?: string; clientVersion?: string } {
	return {
		apiKey:
			extractRegexGroup(html, /"INNERTUBE_API_KEY":"([^"]+)"/) ??
			extractRegexGroup(html, /INNERTUBE_API_KEY\s*[:=]\s*"([^"]+)"/),
		clientVersion:
			extractRegexGroup(html, /"INNERTUBE_CLIENT_VERSION":"([^"]+)"/) ??
			extractRegexGroup(html, /INNERTUBE_CLIENT_VERSION\s*[:=]\s*"([^"]+)"/),
	}
}

function extractVisitorData(html: string): string | undefined {
	return (
		extractRegexGroup(html, /"VISITOR_DATA":"([^"]+)"/) ??
		extractRegexGroup(html, /VISITOR_DATA\s*[:=]\s*"([^"]+)"/)
	)
}

type ContinuationRequest = {
	token: string
	clickTrackingParams?: string
}

function upsertContinuationRequest(
	requestsByToken: Map<string, ContinuationRequest>,
	tokenCandidate: unknown,
	clickTrackingParamsCandidate?: unknown
) {
	if (typeof tokenCandidate !== 'string' || tokenCandidate.length === 0) return
	const existing = requestsByToken.get(tokenCandidate)
	if (existing?.clickTrackingParams) return

	const clickTrackingParams =
		typeof clickTrackingParamsCandidate === 'string' && clickTrackingParamsCandidate.length > 0
			? clickTrackingParamsCandidate
			: undefined

	requestsByToken.set(tokenCandidate, {
		token: tokenCandidate,
		clickTrackingParams: existing?.clickTrackingParams ?? clickTrackingParams,
	})
}

function upsertContinuationFromObject(
	requestsByToken: Map<string, ContinuationRequest>,
	value: unknown,
	fallbackClickTrackingParams?: unknown
) {
	if (!value || typeof value !== 'object') return
	const obj = value as Record<string, unknown>

	upsertContinuationRequest(
		requestsByToken,
		obj.token,
		obj.clickTrackingParams ?? fallbackClickTrackingParams
	)
	upsertContinuationRequest(
		requestsByToken,
		obj.continuation,
		obj.clickTrackingParams ?? fallbackClickTrackingParams
	)

	const webCommandMetadata = obj.webCommandMetadata as Record<string, unknown> | undefined
	const url = typeof webCommandMetadata?.url === 'string' ? webCommandMetadata.url : undefined
	if (url) {
		try {
			const parsed = new URL(url, 'https://www.youtube.com')
			const continuation = parsed.searchParams.get('continuation')
			upsertContinuationRequest(
				requestsByToken,
				continuation,
				obj.clickTrackingParams ?? fallbackClickTrackingParams
			)
		} catch {
			// ignore malformed urls
		}
	}
}

function addTokenFromCandidate(value: unknown, tokens: Set<string>) {
	if (typeof value === 'string' && value.length > 0) {
		tokens.add(value)
	}
}

function extractText(value: unknown): string | undefined {
	if (!value || typeof value !== 'object') return
	const obj = value as Record<string, unknown>
	if (typeof obj.simpleText === 'string' && obj.simpleText.trim().length > 0) {
		return obj.simpleText.trim()
	}

	if (Array.isArray(obj.runs)) {
		const text = obj.runs
			.map((run) => {
				if (!run || typeof run !== 'object') return ''
				const runText = (run as Record<string, unknown>).text
				return typeof runText === 'string' ? runText : ''
			})
			.join('')
			.trim()
		if (text.length > 0) return text
	}

	return
}

function collectPlaylistArtifacts(
	value: unknown,
	videosById: Map<string, string | undefined>,
	requestsByToken: Map<string, ContinuationRequest>
): void {
	if (!value || typeof value !== 'object') return
	if (Array.isArray(value)) {
		for (const item of value) collectPlaylistArtifacts(item, videosById, requestsByToken)
		return
	}

	const obj = value as Record<string, unknown>

	const playlistVideoRenderer = obj.playlistVideoRenderer as Record<string, unknown> | undefined
	if (playlistVideoRenderer) {
		addPlaylistRendererVideo(playlistVideoRenderer, videosById)
	}

	const playlistPanelVideoRenderer = obj.playlistPanelVideoRenderer as Record<string, unknown> | undefined
	if (playlistPanelVideoRenderer) {
		addPlaylistRendererVideo(playlistPanelVideoRenderer, videosById)
	}

	const videoRenderer = obj.videoRenderer as Record<string, unknown> | undefined
	if (videoRenderer && typeof videoRenderer.videoId === 'string') {
		// fallback for some playlist response structures
		const title =
			extractText(videoRenderer.title) ??
			extractText(videoRenderer.headline) ??
			extractText(videoRenderer.descriptionSnippet)
		const existing = videosById.get(videoRenderer.videoId)
		videosById.set(videoRenderer.videoId, existing ?? title)
	}

	const continuationItemRenderer = obj.continuationItemRenderer as Record<string, unknown> | undefined
	if (continuationItemRenderer) {
		const continuationEndpoint = continuationItemRenderer.continuationEndpoint as
			| Record<string, unknown>
			| undefined
		const continuationCommand = continuationEndpoint?.continuationCommand as
			| Record<string, unknown>
			| undefined
		const endpointClickTrackingParams = continuationEndpoint?.clickTrackingParams
		upsertContinuationRequest(
			requestsByToken,
			continuationCommand?.token,
			endpointClickTrackingParams
		)
		const reloadContinuationData = continuationItemRenderer.reloadContinuationData as
			| Record<string, unknown>
			| undefined
		upsertContinuationRequest(
			requestsByToken,
			reloadContinuationData?.continuation,
			reloadContinuationData?.clickTrackingParams
		)
	}

	const nextContinuationData = obj.nextContinuationData as Record<string, unknown> | undefined
	if (nextContinuationData) {
		upsertContinuationRequest(
			requestsByToken,
			nextContinuationData.continuation,
			nextContinuationData.clickTrackingParams
		)
	}

	const continuationEndpoint = obj.continuationEndpoint as Record<string, unknown> | undefined
	if (continuationEndpoint) {
		const continuationCommand = continuationEndpoint.continuationCommand as Record<string, unknown> | undefined
		if (continuationCommand) {
			upsertContinuationRequest(
				requestsByToken,
				continuationCommand.token,
				continuationEndpoint.clickTrackingParams
			)
		}

		upsertContinuationFromObject(
			requestsByToken,
			continuationCommand,
			continuationEndpoint.clickTrackingParams
		)

		const commandExecutorCommand = continuationEndpoint.commandExecutorCommand as
			| Record<string, unknown>
			| undefined
		if (commandExecutorCommand) {
			upsertContinuationFromObject(
				requestsByToken,
				commandExecutorCommand,
				continuationEndpoint.clickTrackingParams
			)
			if (Array.isArray(commandExecutorCommand.commands)) {
				for (const command of commandExecutorCommand.commands) {
					upsertContinuationFromObject(
						requestsByToken,
						command,
						continuationEndpoint.clickTrackingParams
					)
				}
			}
		}
	}

	// Some responses expose continuation command objects without a continuationEndpoint wrapper.
	upsertContinuationFromObject(requestsByToken, obj.continuationCommand, obj.clickTrackingParams)
	upsertContinuationFromObject(requestsByToken, obj.reloadContinuationData, obj.clickTrackingParams)
	upsertContinuationFromObject(requestsByToken, obj.commandExecutorCommand, obj.clickTrackingParams)

	for (const nestedValue of Object.values(obj)) {
		collectPlaylistArtifacts(nestedValue, videosById, requestsByToken)
	}
}

function addPlaylistRendererVideo(
	renderer: Record<string, unknown>,
	videosById: Map<string, string | undefined>
) {
	if (typeof renderer.videoId === 'string' && renderer.videoId.length > 0) {
		const title =
			extractText(renderer.title) ??
			extractText(renderer.headline) ??
			extractText(renderer.descriptionSnippet) ??
			extractText(renderer.shortBylineText)
		const existing = videosById.get(renderer.videoId)
		videosById.set(renderer.videoId, existing ?? title)
	}
}

async function fetchBrowseContinuation(
	apiKey: string,
	clientVersion: string,
	request: ContinuationRequest,
	visitorData?: string
): Promise<unknown> {
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		'x-youtube-client-name': '1',
		'x-youtube-client-version': clientVersion,
		origin: 'https://www.youtube.com',
		referer: 'https://www.youtube.com/',
	}

	if (visitorData) {
		headers['x-goog-visitor-id'] = visitorData
	}

	const context: Record<string, unknown> = {
		client: {
			clientName: 'WEB',
			clientVersion,
		},
	}

	if (request.clickTrackingParams) {
		context.clickTracking = {
			clickTrackingParams: request.clickTrackingParams,
		}
	}

	const response = await requestUrl({
		url: `https://www.youtube.com/youtubei/v1/browse?key=${encodeURIComponent(apiKey)}`,
		method: 'POST',
		headers,
		body: JSON.stringify({
			context,
			continuation: request.token,
		}),
	})

	try {
		return JSON.parse(response.text)
	} catch {
		return undefined
	}
}

async function fetchBrowseByPlaylistId(
	apiKey: string,
	clientVersion: string,
	playlistId: string,
	visitorData?: string
): Promise<unknown> {
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		'x-youtube-client-name': '1',
		'x-youtube-client-version': clientVersion,
		origin: 'https://www.youtube.com',
		referer: 'https://www.youtube.com/',
	}

	if (visitorData) {
		headers['x-goog-visitor-id'] = visitorData
	}

	const response = await requestUrl({
		url: `https://www.youtube.com/youtubei/v1/browse?key=${encodeURIComponent(apiKey)}`,
		method: 'POST',
		headers,
		body: JSON.stringify({
			context: {
				client: {
					clientName: 'WEB',
					clientVersion,
				},
			},
			browseId: `VL${playlistId}`,
		}),
	})

	try {
		return JSON.parse(response.text)
	} catch {
		return undefined
	}
}

export async function extractYoutubePlaylistVideoIds(inputUrl: string): Promise<YoutubePlaylistExtractionResult> {
	const playlistId = getYoutubePlaylistIdFromUrl(inputUrl)
	if (!playlistId) {
		throw new Error('No YouTube playlist id found in the URL.')
	}

	const playlistUrl = buildYoutubePlaylistUrl(playlistId)
	const pageResponse = await requestUrl({
		url: playlistUrl,
		method: 'GET',
		headers: {
			accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
			'accept-language': 'en-US,en;q=0.9',
			referer: 'https://www.youtube.com/',
		},
	})

	const html = pageResponse.text ?? ''
	const initialData =
		extractJsonLiteralAfterMarker(html, YT_INITIAL_DATA_MARKERS[0]) ??
		extractJsonLiteralAfterMarker(html, YT_INITIAL_DATA_MARKERS[1]) ??
		extractJsonLiteralAfterMarker(html, YT_INITIAL_DATA_MARKERS[2]) ??
		extractJsonLiteralAfterMarker(html, YT_INITIAL_DATA_MARKERS[3])

	const { apiKey, clientVersion } = extractInnertubeConfig(html)
	const visitorData = extractVisitorData(html)
	if (!apiKey || !clientVersion) {
		throw new Error('Could not read YouTube internal API config from the playlist page.')
	}

	const videosById = new Map<string, string | undefined>()
	const requestsByToken = new Map<string, ContinuationRequest>()

	collectPlaylistArtifacts(initialData, videosById, requestsByToken)

	const seenTokens = new Set<string>()
	const MAX_CONTINUATIONS = 1000
	while (requestsByToken.size > 0) {
		if (seenTokens.size >= MAX_CONTINUATIONS) {
			break
		}
		const nextToken = requestsByToken.keys().next().value as string | undefined
		if (!nextToken) break
		const nextRequest = requestsByToken.get(nextToken)
		requestsByToken.delete(nextToken)
		if (!nextRequest) continue
		if (seenTokens.has(nextToken)) continue
		seenTokens.add(nextToken)

		const continuationJson = await fetchBrowseContinuation(
			apiKey,
			clientVersion,
			nextRequest,
			visitorData
		)
		collectPlaylistArtifacts(continuationJson, videosById, requestsByToken)
	}

	// Fallback "scroll and accumulate" pass: use playlist browseId directly.
	// This covers cases where page-derived data stalls around the first chunk.
	if (videosById.size <= 100) {
		const beforeFallbackCount = videosById.size
		const browseByIdJson = await fetchBrowseByPlaylistId(apiKey, clientVersion, playlistId, visitorData)
		collectPlaylistArtifacts(browseByIdJson, videosById, requestsByToken)

		while (requestsByToken.size > 0) {
			if (seenTokens.size >= MAX_CONTINUATIONS) {
				break
			}
			const nextToken = requestsByToken.keys().next().value as string | undefined
			if (!nextToken) break
			const nextRequest = requestsByToken.get(nextToken)
			requestsByToken.delete(nextToken)
			if (!nextRequest) continue
			if (seenTokens.has(nextToken)) continue
			seenTokens.add(nextToken)

			const continuationJson = await fetchBrowseContinuation(
				apiKey,
				clientVersion,
				nextRequest,
				visitorData
			)
			collectPlaylistArtifacts(continuationJson, videosById, requestsByToken)
		}

		// If fallback did not add anything, continue gracefully with what we have.
		if (videosById.size === beforeFallbackCount) {
			// no-op
		}
	}

	const videos = Array.from(videosById.entries()).map(([videoId, title]) => ({
		videoId,
		videoUrl: buildYoutubeWatchUrl(videoId, playlistId),
		title,
	}))
	const videoIds = videos.map((video) => video.videoId)
	const videoUrls = videos.map((video) => video.videoUrl)

	return {
		playlistId,
		playlistUrl,
		videos,
		videoIds,
		videoUrls,
	}
}
