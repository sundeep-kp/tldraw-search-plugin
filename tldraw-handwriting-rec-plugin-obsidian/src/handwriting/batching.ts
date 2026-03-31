// src/handwriting/batching.ts
import { StrokeGroupCandidate } from 'src/handwriting/strokeGrouping'

export type BatchPolicy = {
  maxBatchWidthPx: number
  maxBatchHeightPx: number
  maxGroupsPerBatch: number
  maxStrokesPerBatch: number
  maxPointsPerBatch: number
  boundaryTimeGapMs: number
  idleFlushMs: number
  hardMaxBatchAgeMs: number
}

export const DEFAULT_BATCH_POLICY: BatchPolicy = {
  maxBatchWidthPx: 700,
  maxBatchHeightPx: 700,
  maxGroupsPerBatch: 8,
  maxStrokesPerBatch: 50,
  maxPointsPerBatch: 3500,
  boundaryTimeGapMs: 1100,
  idleFlushMs: 1400,
  hardMaxBatchAgeMs: 7000,
}

type BatchMetrics = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  groups: number
  strokes: number
  points: number
  startedAt: number
  endedAt: number
}

function pointsInGroup(group: StrokeGroupCandidate): number {
  return group.payloads.reduce(
    (sum, payload) => sum + payload.rawStrokes.reduce((n, s) => n + s.length, 0),
    0
  )
}

function strokesInGroup(group: StrokeGroupCandidate): number {
  return group.payloads.reduce((sum, payload) => sum + payload.rawStrokes.length, 0)
}

function initMetrics(group: StrokeGroupCandidate): BatchMetrics {
  const b = group.boundingBox
  return {
    minX: b.minX,
    minY: b.minY,
    maxX: b.maxX,
    maxY: b.maxY,
    groups: 1,
    strokes: strokesInGroup(group),
    points: pointsInGroup(group),
    startedAt: group.startedAt,
    endedAt: group.endedAt,
  }
}

function project(metrics: BatchMetrics, next: StrokeGroupCandidate): BatchMetrics {
  const b = next.boundingBox
  return {
    minX: Math.min(metrics.minX, b.minX),
    minY: Math.min(metrics.minY, b.minY),
    maxX: Math.max(metrics.maxX, b.maxX),
    maxY: Math.max(metrics.maxY, b.maxY),
    groups: metrics.groups + 1,
    strokes: metrics.strokes + strokesInGroup(next),
    points: metrics.points + pointsInGroup(next),
    startedAt: Math.min(metrics.startedAt, next.startedAt),
    endedAt: Math.max(metrics.endedAt, next.endedAt),
  }
}

function width(m: BatchMetrics): number {
  return m.maxX - m.minX
}

function height(m: BatchMetrics): number {
  return m.maxY - m.minY
}

export function shouldFlushBatch(
  currentMetrics: BatchMetrics | null,
  nextGroup: StrokeGroupCandidate,
  nowMs: number,
  policy: BatchPolicy = DEFAULT_BATCH_POLICY
): boolean {
  if (!currentMetrics) return false

  const projected = project(currentMetrics, nextGroup)

  if (projected.groups > policy.maxGroupsPerBatch) return true
  if (projected.strokes > policy.maxStrokesPerBatch) return true
  if (projected.points > policy.maxPointsPerBatch) return true
  if (width(projected) > policy.maxBatchWidthPx) return true
  if (height(projected) > policy.maxBatchHeightPx) return true

  const gapMs = Math.max(0, nextGroup.startedAt - currentMetrics.endedAt)
  if (gapMs > policy.boundaryTimeGapMs) return true

  const ageMs = nowMs - currentMetrics.startedAt
  if (ageMs > policy.hardMaxBatchAgeMs) return true

  return false
}

export function shouldIdleFlush(
  currentMetrics: BatchMetrics | null,
  nowMs: number,
  policy: BatchPolicy = DEFAULT_BATCH_POLICY
): boolean {
  if (!currentMetrics) return false
  return nowMs - currentMetrics.endedAt > policy.idleFlushMs
}

export function appendGroup(
  currentMetrics: BatchMetrics | null,
  group: StrokeGroupCandidate
): BatchMetrics {
  return currentMetrics ? project(currentMetrics, group) : initMetrics(group)
}

function mergeBatchGroups(batchId: string, groups: StrokeGroupCandidate[]): StrokeGroupCandidate {
  const sortedGroups = [...groups].sort((a, b) => {
    if (a.startedAt !== b.startedAt) return a.startedAt - b.startedAt
    return a.id.localeCompare(b.id)
  })

  const payloads = sortedGroups
    .flatMap((group) => group.payloads)
    .sort((a, b) => a.timestamp - b.timestamp)

  const uniqueShapeIds = Array.from(new Set(sortedGroups.flatMap((group) => group.shapeIds)))

  const bounds = sortedGroups.reduce(
    (acc, group) => {
      const b = group.boundingBox
      return {
        minX: Math.min(acc.minX, b.minX),
        minY: Math.min(acc.minY, b.minY),
        maxX: Math.max(acc.maxX, b.maxX),
        maxY: Math.max(acc.maxY, b.maxY),
      }
    },
    {
      minX: sortedGroups[0].boundingBox.minX,
      minY: sortedGroups[0].boundingBox.minY,
      maxX: sortedGroups[0].boundingBox.maxX,
      maxY: sortedGroups[0].boundingBox.maxY,
    }
  )

  return {
    id: batchId,
    shapeIds: uniqueShapeIds,
    payloads,
    boundingBox: {
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
    },
    startedAt: sortedGroups[0].startedAt,
    endedAt: sortedGroups[sortedGroups.length - 1].endedAt,
  }
}

export function buildBatchedStrokeCandidates(
  groups: StrokeGroupCandidate[],
  policy: BatchPolicy = DEFAULT_BATCH_POLICY,
  idPrefix = 'batch'
): StrokeGroupCandidate[] {
  if (!Array.isArray(groups) || groups.length === 0) return []

  const orderedGroups = [...groups].sort((a, b) => {
    if (a.startedAt !== b.startedAt) return a.startedAt - b.startedAt
    return a.id.localeCompare(b.id)
  })

  const batched: StrokeGroupCandidate[] = []
  let pendingGroups: StrokeGroupCandidate[] = []
  let pendingMetrics: BatchMetrics | null = null
  let batchIndex = 0

  for (const group of orderedGroups) {
    if (shouldFlushBatch(pendingMetrics, group, group.startedAt, policy) && pendingGroups.length > 0) {
      batched.push(mergeBatchGroups(`${idPrefix}-${batchIndex}`, pendingGroups))
      batchIndex += 1
      pendingGroups = []
      pendingMetrics = null
    }

    pendingGroups.push(group)
    pendingMetrics = appendGroup(pendingMetrics, group)
  }

  if (pendingGroups.length > 0) {
    batched.push(mergeBatchGroups(`${idPrefix}-${batchIndex}`, pendingGroups))
  }

  return batched
}