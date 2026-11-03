import type { PodGoal, PodWorkBucket, PodWorkOverview } from "@mafw/sdk"

export interface WorkspaceSection {
  bucket: PodWorkBucket
  goals: PodGoal[]
  count: number
}

const BUCKET_ORDER: PodWorkBucket[] = [
  "needs_you",
  "queued",
  "in_progress",
  "result_ready",
  "ended",
]

/**
 * Single projection for the Overview list and its badges. Counts are never
 * stored separately from the visible array, so a count can always be opened.
 */
export function workspaceSections(overview: PodWorkOverview): WorkspaceSection[] {
  const groups = (overview?.groups ?? {}) as Partial<Record<PodWorkBucket, PodGoal[]>>
  return BUCKET_ORDER.map((bucket) => {
    const goals = Array.isArray(groups[bucket]) ? groups[bucket]! : []
    return { bucket, goals, count: goals.length }
  })
}
